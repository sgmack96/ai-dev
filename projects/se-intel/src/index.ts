/**
 * src/index.ts
 *
 * Worker entry point for se-intel.
 *
 * Routes:
 *   POST /api/v1/account        → AccountIntelAgent DO
 *   POST /api/v1/enablement     → EnablementAgent DO
 *   GET  /api/v1/history/:agent → conversation history from DO
 *   GET  /health                → health check
 *   POST /dev/token             → generate test JWT (portfolio only)
 *
 * Middleware (applied to all /api/* routes):
 *   1. extractUserContext() — JWT validation, builds UserContext
 *   2. checkRateLimit()     — per-user sliding window, role-based limits
 *
 * DO dispatch:
 *   Each user gets their own DO instance (keyed by userId).
 *   AccountIntelAgent and EnablementAgent are separate DO classes,
 *   so Alice's account context is isolated from her enablement context,
 *   and completely isolated from Bob's.
 */

import { Hono } from "hono";
import { extractUserContext, generateDevToken } from "./auth/context.js";
import { checkRateLimit } from "./auth/ratelimit.js";
import { getUIHtml } from "./ui.js";
import { LongTermMemory } from "./memory/long-term.js";
import { kbSearchRaw } from "./tools/kb-search.js";
import { getOrgHealth, SLO } from "./observability/metrics.js";
import type { Env, Role } from "./types/index.js";

// Re-export DO classes so wrangler can find them
export { AccountIntelAgent } from "./agents/account-intel.js";
export { EnablementAgent } from "./agents/enablement.js";
export { TranscriptAgent } from "./agents/transcript.js";

// KB seed utility
import { seedVectorize } from "../scripts/seed-kb.js";

const app = new Hono<{ Bindings: Env }>();

// ── Cloudflare Access JWT guard ───────────────────────────────────────────────
// Rejects requests that don't come through Access (no JWT header).
// This closes the backdoor at the raw workers.dev URL.
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Allow health check and Cloudflare internals without Access JWT
  if (path === "/health" || path.startsWith("/cdn-cgi/")) {
    return next();
  }

  const jwt = c.req.header("CF-Access-Jwt-Assertion");
  if (!jwt) {
    return c.json(
      { error: "Unauthorized — access via se-intel.macksportreport.com" },
      401
    );
  }

  return next();
});

// ── Chat UI ───────────────────────────────────────────────────────────────────
app.get("/", (c) => {
  return c.html(getUIHtml());
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "se-intel",
    version: "1.0.0",
    agents: ["account", "enablement", "transcript"],
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  });
});

// ── Dev token endpoint (portfolio only) ───────────────────────────────────────
// Generates a test JWT for demoing different roles.
// Disabled in production.
app.post("/dev/token", async (c) => {
  if (c.env.ENVIRONMENT === "production") {
    return c.json({ error: "Not available in production" }, { status: 403 });
  }

  const secret = c.env.JWT_SECRET;
  if (!secret) {
    return c.json({ error: "JWT_SECRET not configured" }, { status: 500 });
  }

  let body: { userId?: string; role?: string; name?: string; orgId?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, role, name, orgId } = body;
  if (!userId || !role || !name) {
    return c.json(
      { error: "Required: userId, role, name. Optional: orgId" },
      { status: 400 }
    );
  }

  const validRoles: Role[] = ["ae", "se", "csm", "tam", "sales_manager"];
  if (!validRoles.includes(role as Role)) {
    return c.json(
      { error: `role must be one of: ${validRoles.join(", ")}` },
      { status: 400 }
    );
  }

  const token = await generateDevToken(
    userId,
    role as Role,
    name,
    orgId ?? "portfolio-org",
    secret
  );

  return c.json({
    token,
    expiresIn: "24h",
    usage: `Authorization: Bearer ${token}`,
    note: "This endpoint is disabled in production.",
  });
});

// ── Auth + rate limit middleware for all API routes ───────────────────────────
app.use("/api/*", async (c, next) => {
  // 1. Extract and verify user identity
  const userContext = await extractUserContext(c.req.raw, c.env);
  if (!userContext) {
    return c.json(
      {
        error: "Unauthorized",
        hint:
          c.env.ENVIRONMENT === "portfolio"
            ? "POST /dev/token to get a test JWT, then pass as Authorization: Bearer <token>"
            : "Valid Cloudflare Access JWT required",
      },
      { status: 401 }
    );
  }

  // 2. Rate limit check
  const rl = await checkRateLimit(userContext.userId, userContext.role, c.env);
  if (!rl.allowed) {
    return c.json(
      {
        error: "Rate limit exceeded",
        resetAt: new Date(rl.resetAt).toISOString(),
        retryAfterMs: rl.resetAt - Date.now(),
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rl.resetAt),
        },
      }
    );
  }

  // Attach to context for use in route handlers
  c.set("userContext" as never, userContext);
  c.set("rateLimitRemaining" as never, rl.remaining);

  return next();
});

// ── Account Intel Agent ───────────────────────────────────────────────────────
app.post("/api/v1/account", async (c) => {
  const userContext = c.get("userContext" as never) as Awaited<
    ReturnType<typeof extractUserContext>
  >;

  let body: { message?: string; threadId?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, threadId } = body;
  if (!message) {
    return c.json({ error: "message is required" }, { status: 400 });
  }

  const tid = threadId ?? crypto.randomUUID();
  const debugMode = c.req.query("debug") === "true";

  // Get (or create) DO stub for this user
  const doId = c.env.ACCOUNT_AGENT.idFromName(`${userContext!.orgId}:${userContext!.userId}`);
  const stub = c.env.ACCOUNT_AGENT.get(doId);

  // Forward to DO
  const doResp = await stub.fetch(
    new Request("https://do-internal/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, threadId: tid, userContext, debugMode }),
    })
  );

  const result = await doResp.json();
  return c.json(result, doResp.status as 200 | 400 | 500);
});

// ── Enablement Agent ──────────────────────────────────────────────────────────
app.post("/api/v1/enablement", async (c) => {
  const userContext = c.get("userContext" as never) as Awaited<
    ReturnType<typeof extractUserContext>
  >;

  let body: { message?: string; threadId?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, threadId } = body;
  if (!message) {
    return c.json({ error: "message is required" }, { status: 400 });
  }

  const tid = threadId ?? crypto.randomUUID();
  const debugMode = c.req.query("debug") === "true";

  const doId = c.env.ENABLEMENT_AGENT.idFromName(`${userContext!.orgId}:${userContext!.userId}`);
  const stub = c.env.ENABLEMENT_AGENT.get(doId);

  const doResp = await stub.fetch(
    new Request("https://do-internal/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, threadId: tid, userContext, debugMode }),
    })
  );

  const result = await doResp.json();
  return c.json(result, doResp.status as 200 | 400 | 500);
});

// ── Streaming: Account Intel Agent ───────────────────────────────────────────
// Returns Server-Sent Events. Client reads token-by-token.
// SSE events: {type:"tools",...} | {type:"token","text":"..."} | {type:"done",...} | {type:"error",...}
app.post("/api/v1/account/stream", async (c) => {
  const userContext = c.get("userContext" as never) as Awaited<
    ReturnType<typeof extractUserContext>
  >;

  let body: { message?: string; threadId?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, threadId } = body;
  if (!message) {
    return c.json({ error: "message is required" }, { status: 400 });
  }

  const tid = threadId ?? crypto.randomUUID();
  const doId = c.env.ACCOUNT_AGENT.idFromName(`${userContext!.orgId}:${userContext!.userId}`);
  const stub = c.env.ACCOUNT_AGENT.get(doId);

  // Forward to DO /stream — pass the response straight through (don't buffer)
  const doResp = await stub.fetch(
    new Request("https://do-internal/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, threadId: tid, userContext }),
    })
  );

  // Return the DO's ReadableStream directly — this is what enables true streaming
  return new Response(doResp.body, {
    status: doResp.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// ── Transcript Agent ──────────────────────────────────────────────────────────
app.post("/api/v1/transcript", async (c) => {
  const userContext = c.get("userContext" as never) as Awaited<
    ReturnType<typeof extractUserContext>
  >;

  let body: { message?: string; threadId?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, threadId } = body;
  if (!message) {
    return c.json({ error: "message is required — paste your call transcript or notes" }, { status: 400 });
  }

  const tid = threadId ?? crypto.randomUUID();
  const doId = c.env.TRANSCRIPT_AGENT.idFromName(`${userContext!.orgId}:${userContext!.userId}`);
  const stub = c.env.TRANSCRIPT_AGENT.get(doId);

  const doResp = await stub.fetch(
    new Request("https://do-internal/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, threadId: tid, userContext }),
    })
  );

  const result = await doResp.json();
  return c.json(result, doResp.status as 200 | 400 | 500);
});

// ── Streaming: Transcript Agent ──────────────────────────────────────────────
app.post("/api/v1/transcript/stream", async (c) => {
  const userContext = c.get("userContext" as never) as Awaited<
    ReturnType<typeof extractUserContext>
  >;

  let body: { message?: string; threadId?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, threadId } = body;
  if (!message) {
    return c.json({ error: "message is required" }, { status: 400 });
  }

  const tid = threadId ?? crypto.randomUUID();
  const doId = c.env.TRANSCRIPT_AGENT.idFromName(`${userContext!.orgId}:${userContext!.userId}`);
  const stub = c.env.TRANSCRIPT_AGENT.get(doId);

  const doResp = await stub.fetch(
    new Request("https://do-internal/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, threadId: tid, userContext }),
    })
  );

  return new Response(doResp.body, {
    status: doResp.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// ── Streaming: Enablement Agent ───────────────────────────────────────────────
app.post("/api/v1/enablement/stream", async (c) => {
  const userContext = c.get("userContext" as never) as Awaited<
    ReturnType<typeof extractUserContext>
  >;

  let body: { message?: string; threadId?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, threadId } = body;
  if (!message) {
    return c.json({ error: "message is required" }, { status: 400 });
  }

  const tid = threadId ?? crypto.randomUUID();
  const doId = c.env.ENABLEMENT_AGENT.idFromName(`${userContext!.orgId}:${userContext!.userId}`);
  const stub = c.env.ENABLEMENT_AGENT.get(doId);

  const doResp = await stub.fetch(
    new Request("https://do-internal/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, threadId: tid, userContext }),
    })
  );

  return new Response(doResp.body, {
    status: doResp.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// ── User memory ───────────────────────────────────────────────────────────────
// Returns the long-term memory facts stored for the authenticated user.
// Used by the UI to show "what the agent remembers about you."
app.get("/api/v1/memory", async (c) => {
  const userContext = c.get("userContext" as never) as Awaited<
    ReturnType<typeof extractUserContext>
  >;

  const ltm = new LongTermMemory(userContext!.userId, userContext!.orgId, c.env);
  const facts = await ltm.recall();

  return c.json({
    userId: userContext!.userId,
    factCount: facts.length,
    facts: facts.map((f) => ({
      id: f.id,
      content: f.content,
      source: f.source,
      timestamp: new Date(f.timestamp).toISOString(),
    })),
  });
});

// ── Audit log (org-scoped, role-split) ─────────────────────────────────────────
// Returns audit rows for the caller's org, scoped by role:
//   - sales_manager: sees all rows for their org (team review)
//   - everyone else: sees only their own rows
// orgId comes from the JWT — callers cannot request another org's data.
//   GET /api/v1/audit?limit=50&agentType=account
app.get("/api/v1/audit", async (c) => {
  const userContext = c.get("userContext" as never) as Awaited<
    ReturnType<typeof extractUserContext>
  >;

  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const agentType = c.req.query("agentType"); // optional filter

  const isManager = userContext!.role === "sales_manager";

  // Build the query — org_id always comes from the JWT, never from the request
  let query = `SELECT id, timestamp, user_id, role, agent_type, thread_id,
       message_preview, tools_used, response_latency_ms, model, blocked
     FROM audit_log
     WHERE org_id = ?`;
  const params: (string | number)[] = [userContext!.orgId];

  // Non-managers can only see their own rows
  if (!isManager) {
    query += ` AND user_id = ?`;
    params.push(userContext!.userId);
  }

  // Optional agent type filter
  if (agentType && ["account", "enablement", "transcript"].includes(agentType)) {
    query += ` AND agent_type = ?`;
    params.push(agentType);
  }

  query += ` ORDER BY timestamp DESC LIMIT ?`;
  params.push(limit);

  const result = await c.env.DB.prepare(query).bind(...params).all();

  return c.json({
    orgId: userContext!.orgId,
    userId: userContext!.userId,
    role: userContext!.role,
    scope: isManager ? "org" : "own",
    rowCount: result.results.length,
    rows: result.results.map((row) => ({
      ...row,
      timestamp: new Date(row.timestamp as number).toISOString(),
      toolsUsed: row.tools_used ? JSON.parse(row.tools_used as string) : [],
    })),
  });
});

// ── Conversation history ───────────────────────────────────────────────────────
app.get("/api/v1/history/:agent", async (c) => {
  const userContext = c.get("userContext" as never) as Awaited<
    ReturnType<typeof extractUserContext>
  >;
  const agent = c.req.param("agent");
  const threadId = c.req.query("threadId");

  if (agent !== "account" && agent !== "enablement" && agent !== "transcript") {
    return c.json(
      { error: "agent must be 'account', 'enablement', or 'transcript'" },
      { status: 400 }
    );
  }

  const ns =
    agent === "account"
      ? c.env.ACCOUNT_AGENT
      : agent === "enablement"
        ? c.env.ENABLEMENT_AGENT
        : c.env.TRANSCRIPT_AGENT;
  const doId = ns.idFromName(`${userContext!.orgId}:${userContext!.userId}`);
  const stub = ns.get(doId);

  const url = new URL("https://do-internal/history");
  if (threadId) url.searchParams.set("threadId", threadId);

  const doResp = await stub.fetch(new Request(url.toString()));
  const result = await doResp.json();
  return c.json(result, doResp.status as 200 | 400);
});

// ── Admin: seed Vectorize KB ──────────────────────────────────────────────────
// Trigger with: curl -X POST https://<worker>/admin/seed
// Protected by a simple bearer check against JWT_SECRET so it can't be
// accidentally triggered in production by an unauthenticated caller.
app.post("/admin/seed", async (c) => {
  const secret = c.env.JWT_SECRET;
  if (secret) {
    const auth = c.req.header("Authorization");
    if (!auth || auth !== `Bearer ${secret}`) {
      return c.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await seedVectorize({
      AI: c.env.AI,
      VECTORIZE: c.env.VECTORIZE,
    });

    return c.json({
      status: result.errors.length === 0 ? "ok" : "partial",
      chunksSeeded: result.total,
      embeddingBatches: result.batches,
      errors: result.errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Seed failed: ${msg}` }, { status: 500 });
  }
});

// ── Admin: seed status ────────────────────────────────────────────────────────
app.get("/admin/seed/status", async (c) => {
  try {
    // Query a dummy vector to check if the index has data
    const dummyVector = new Array(768).fill(0.01) as number[];
    const result = await c.env.VECTORIZE.query(dummyVector, {
      topK: 1,
      returnMetadata: "all",
    });
    return c.json({
      status: "ok",
      indexHasData: result.matches.length > 0,
      sampleChunk: result.matches[0]?.metadata ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, { status: 500 });
  }
});

// ── Admin: KB isolation probe ─────────────────────────────────────────────────
// Deterministic multi-tenancy test. Runs the REAL retrieval path (kbSearchRaw)
// and returns the raw chunks with their orgId — NO LLM in the path, so the
// result can't be masked by hallucination. Used to prove cross-org isolation.
//   curl -X POST .../admin/kb-probe -H "Authorization: Bearer <SECRET>" \
//     -d '{"query":"negotiated discount","role":"se","orgId":"acme"}'
app.post("/admin/kb-probe", async (c) => {
  const secret = c.env.JWT_SECRET;
  if (secret) {
    const auth = c.req.header("Authorization");
    if (!auth || auth !== `Bearer ${secret}`) {
      return c.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: { query?: string; role?: string; orgId?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { query, role, orgId } = body;
  if (!query || !role || !orgId) {
    return c.json({ error: "Required: query, role, orgId" }, { status: 400 });
  }

  const validRoles: Role[] = ["ae", "se", "csm", "tam", "sales_manager"];
  if (!validRoles.includes(role as Role)) {
    return c.json({ error: `role must be one of: ${validRoles.join(", ")}` }, { status: 400 });
  }

  const results = await kbSearchRaw(query, role as Role, orgId, c.env);

  // Surface exactly what the filter returned, plus a leak check:
  // any returned chunk whose orgId is neither the caller's org nor "global" is a leak.
  const foreignChunks = results.filter((r) => r.orgId !== orgId && r.orgId !== "global");

  return c.json({
    query,
    role,
    orgId,
    matchCount: results.length,
    isolationOk: foreignChunks.length === 0,
    leakedChunks: foreignChunks.length,
    matches: results.map((r) => ({
      orgId: r.orgId,
      namespace: r.namespace,
      score: Number(r.score.toFixed(3)),
      preview: r.content.slice(0, 80),
    })),
  });
});

// ── Admin: Memory isolation probe ─────────────────────────────────────────────
// Deterministic multi-tenancy test for long-term memory (KV).
// Writes a test fact as orgA/user, then reads as orgB/user — asserts 0 facts.
// No LLM involved — same principle as /admin/kb-probe.
//   curl -X POST .../admin/memory-probe -H "Authorization: Bearer <SECRET>" \
//     -d '{"userId":"probe-user","orgA":"acme","orgB":"portfolio-org"}'
app.post("/admin/memory-probe", async (c) => {
  const secret = c.env.JWT_SECRET;
  if (secret) {
    const auth = c.req.header("Authorization");
    if (!auth || auth !== `Bearer ${secret}`) {
      return c.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: { userId?: string; orgA?: string; orgB?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, orgA, orgB } = body;
  if (!userId || !orgA || !orgB) {
    return c.json({ error: "Required: userId, orgA, orgB" }, { status: 400 });
  }
  if (orgA === orgB) {
    return c.json({ error: "orgA and orgB must be different" }, { status: 400 });
  }

  // Step 1: Write a test fact under orgA
  const ltmA = new LongTermMemory(userId, orgA, c.env);
  const testFact = await ltmA.remember({
    content: `[PROBE] test fact for ${orgA} at ${Date.now()}`,
    source: "agent_inferred",
  });

  // Step 2: Read facts under orgA — should find the test fact
  const factsA = await ltmA.recall();
  const foundInA = factsA.some((f) => f.id === testFact.id);

  // Step 3: Read facts under orgB for the SAME userId — should find 0 of orgA's facts
  const ltmB = new LongTermMemory(userId, orgB, c.env);
  const factsB = await ltmB.recall();
  const leakedToB = factsB.some((f) => f.id === testFact.id);

  // Step 4: Clean up the test fact
  await c.env.USER_MEMORY_KV.delete(`ltm:${orgA}:${userId}:${testFact.id}`);
  // Update the index to remove the test fact
  const indexKey = `ltm:${orgA}:${userId}:__index`;
  const indexRaw = await c.env.USER_MEMORY_KV.get(indexKey);
  if (indexRaw) {
    const index = JSON.parse(indexRaw) as string[];
    const cleaned = index.filter((id) => id !== testFact.id);
    if (cleaned.length > 0) {
      await c.env.USER_MEMORY_KV.put(indexKey, JSON.stringify(cleaned));
    } else {
      await c.env.USER_MEMORY_KV.delete(indexKey);
    }
  }

  return c.json({
    userId,
    orgA,
    orgB,
    testFactId: testFact.id,
    orgACanRead: foundInA,
    orgBCanRead: leakedToB,
    isolationOk: foundInA && !leakedToB,
    orgAFactCount: factsA.length,
    orgBFactCount: factsB.length,
  });
});

// ── Admin: Audit isolation probe ──────────────────────────────────────────────
// Deterministic multi-tenancy test for audit log (D1).
// Counts rows per org, then confirms a query scoped to orgB returns 0 of orgA's rows.
// No fake data written — uses existing audit rows. Pure query isolation proof.
//   curl -X POST .../admin/audit-probe -H "Authorization: Bearer <SECRET>" \
//     -d '{"orgA":"acme","orgB":"portfolio-org"}'
app.post("/admin/audit-probe", async (c) => {
  const secret = c.env.JWT_SECRET;
  if (secret) {
    const auth = c.req.header("Authorization");
    if (!auth || auth !== `Bearer ${secret}`) {
      return c.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: { orgA?: string; orgB?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { orgA, orgB } = body;
  if (!orgA || !orgB) {
    return c.json({ error: "Required: orgA, orgB" }, { status: 400 });
  }
  if (orgA === orgB) {
    return c.json({ error: "orgA and orgB must be different" }, { status: 400 });
  }

  // Count rows per org
  const countA = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM audit_log WHERE org_id = ?`
  ).bind(orgA).first<{ cnt: number }>();

  const countB = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM audit_log WHERE org_id = ?`
  ).bind(orgB).first<{ cnt: number }>();

  // Confirm no orgA rows appear in a query scoped to orgB
  // Fetch orgA's most recent row ID (if any), then check if orgB's scoped query returns it
  let leakedRowFound = false;
  if ((countA?.cnt ?? 0) > 0) {
    const orgARow = await c.env.DB.prepare(
      `SELECT id FROM audit_log WHERE org_id = ? ORDER BY timestamp DESC LIMIT 1`
    ).bind(orgA).first<{ id: string }>();

    if (orgARow) {
      const leaked = await c.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM audit_log WHERE org_id = ? AND id = ?`
      ).bind(orgB, orgARow.id).first<{ cnt: number }>();
      leakedRowFound = (leaked?.cnt ?? 0) > 0;
    }
  }

  return c.json({
    orgA,
    orgB,
    orgARowCount: countA?.cnt ?? 0,
    orgBRowCount: countB?.cnt ?? 0,
    crossOrgLeaked: leakedRowFound ? 1 : 0,
    isolationOk: !leakedRowFound,
  });
});

// ── Account health scorecard (self-service) ───────────────────────────────────
// Returns SLO metrics for the caller's org over the last 24h.
// sales_manager sees all orgs; everyone else sees only their own.
//   GET /api/v1/health?window=24
app.get("/api/v1/health", async (c) => {
  const userContext = c.get("userContext" as never) as Awaited<
    ReturnType<typeof extractUserContext>
  >;

  const windowHours = Math.min(parseInt(c.req.query("window") ?? "24"), 168); // max 7d
  const isManager = userContext!.role === "sales_manager";

  // Managers see all orgs, everyone else is scoped to their own
  const orgFilter = isManager ? null : userContext!.orgId;
  const data = await getOrgHealth(orgFilter, windowHours, c.env);

  return c.json({
    callerOrgId: userContext!.orgId,
    callerRole: userContext!.role,
    scope: isManager ? "all_orgs" : "own_org",
    windowHours,
    sloTargets: {
      p95LatencyMs: SLO.P95_LATENCY_MS,
      errorRatePct: SLO.ERROR_RATE_PCT,
    },
    orgs: data,
  });
});

// ── Admin health scorecard (all orgs, no auth scoping) ────────────────────────
// Requires JWT_SECRET bearer — used by ops/TAM for cross-org visibility.
//   GET /admin/health-scorecard?window=24
app.get("/admin/health-scorecard", async (c) => {
  const secret = c.env.JWT_SECRET;
  if (secret) {
    const auth = c.req.header("Authorization");
    if (!auth || auth !== `Bearer ${secret}`) {
      return c.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const windowHours = Math.min(parseInt(c.req.query("window") ?? "24"), 168);
  const data = await getOrgHealth(null, windowHours, c.env);

  const allPassing = data.every(
    (d) => d.slos.latency.passing && d.slos.errorRate.passing
  );

  return c.json({
    status: allPassing ? "healthy" : "degraded",
    windowHours,
    sloTargets: {
      p95LatencyMs: SLO.P95_LATENCY_MS,
      errorRatePct: SLO.ERROR_RATE_PCT,
    },
    orgCount: data.length,
    orgs: data,
  });
});

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.notFound((c) => {
  return c.json(
    {
      error: "Not found",
      availableRoutes: [
        "POST /api/v1/account",
        "POST /api/v1/enablement",
        "GET  /api/v1/audit",
        "GET  /api/v1/health",
        "GET  /api/v1/history/:agent?threadId=<id>",
        "GET  /health",
        "POST /dev/token              (portfolio only)",
        "POST /admin/seed             (requires JWT_SECRET bearer)",
        "GET  /admin/seed/status",
        "GET  /admin/health-scorecard (requires JWT_SECRET bearer)",
        "POST /admin/kb-probe         (requires JWT_SECRET bearer)",
        "POST /admin/memory-probe     (requires JWT_SECRET bearer)",
        "POST /admin/audit-probe      (requires JWT_SECRET bearer)",
      ],
    },
    404
  );
});

export default app;
