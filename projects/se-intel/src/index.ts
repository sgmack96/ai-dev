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
import type { Env, Role } from "./types/index.js";

// Re-export DO classes so wrangler can find them
export { AccountIntelAgent } from "./agents/account-intel.js";
export { EnablementAgent } from "./agents/enablement.js";

// KB seed utility
import { seedVectorize } from "../scripts/seed-kb.js";

const app = new Hono<{ Bindings: Env }>();

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
    agents: ["account", "enablement"],
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

  // Get (or create) DO stub for this user
  const doId = c.env.ACCOUNT_AGENT.idFromName(userContext!.userId);
  const stub = c.env.ACCOUNT_AGENT.get(doId);

  // Forward to DO
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

  const doId = c.env.ENABLEMENT_AGENT.idFromName(userContext!.userId);
  const stub = c.env.ENABLEMENT_AGENT.get(doId);

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
  const doId = c.env.ACCOUNT_AGENT.idFromName(userContext!.userId);
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
  const doId = c.env.ENABLEMENT_AGENT.idFromName(userContext!.userId);
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

  const ltm = new LongTermMemory(userContext!.userId, c.env);
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

// ── Conversation history ───────────────────────────────────────────────────────
app.get("/api/v1/history/:agent", async (c) => {
  const userContext = c.get("userContext" as never) as Awaited<
    ReturnType<typeof extractUserContext>
  >;
  const agent = c.req.param("agent");
  const threadId = c.req.query("threadId");

  if (agent !== "account" && agent !== "enablement") {
    return c.json(
      { error: "agent must be 'account' or 'enablement'" },
      { status: 400 }
    );
  }

  const ns =
    agent === "account" ? c.env.ACCOUNT_AGENT : c.env.ENABLEMENT_AGENT;
  const doId = ns.idFromName(userContext!.userId);
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

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.notFound((c) => {
  return c.json(
    {
      error: "Not found",
      availableRoutes: [
        "POST /api/v1/account",
        "POST /api/v1/enablement",
        "GET  /api/v1/history/:agent?threadId=<id>",
        "GET  /health",
        "POST /dev/token       (portfolio only)",
        "POST /admin/seed      (requires JWT_SECRET bearer)",
        "GET  /admin/seed/status",
      ],
    },
    404
  );
});

export default app;
