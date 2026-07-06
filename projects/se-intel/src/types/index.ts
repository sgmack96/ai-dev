// ── Roles ─────────────────────────────────────────────────────────────────────
// Five roles matching the real Cloudflare revenue org structure.
// Each role maps to a different set of tools and KB namespaces.
export type Role = "ae" | "se" | "csm" | "tam" | "sales_manager";

// ── User Context ──────────────────────────────────────────────────────────────
// Built from a verified JWT at the Worker router layer.
// Passed into every Durable Object request so agents never trust user input
// for identity — they only trust what the Worker verified.
export interface UserContext {
  userId: string;        // sub claim from JWT — stable per-user identifier
  role: Role;            // custom:role claim — drives tool access and KB namespaces
  orgId: string;         // custom:org_id claim — scopes shared KB queries
  name: string;          // name claim — used in responses and audit log
  email: string;         // email claim — audit trail
}

// ── Agent Types ───────────────────────────────────────────────────────────────
export type AgentType = "account" | "enablement" | "transcript";

// ── Message ───────────────────────────────────────────────────────────────────
// Single conversation turn stored in DO SQLite.
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[] | undefined;
}

// ── Tool Call ─────────────────────────────────────────────────────────────────
// Recorded alongside messages for eval harness and audit trail.
export interface ToolCall {
  toolName: string;
  orgId: string;         // tenant the tool ran under — proves org isolation in the audit trail
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

// ── Agent Request ─────────────────────────────────────────────────────────────
// What the Worker sends to the Durable Object.
export interface AgentRequest {
  message: string;
  threadId: string;      // conversation session ID — user can have many threads
  userContext: UserContext;
  debugMode?: boolean;   // when true, the agent returns the raw KB chunks it retrieved (eval harness only)
}

// ── Retrieved Chunk (debug/eval only) ───────────────────────────────────────────
// A flattened view of a KB chunk that was retrieved for a request.
// Returned only when debugMode=true so the eval harness can run a deterministic
// faithfulness check: "did the response actually use the chunks we retrieved?"
export interface RetrievedChunk {
  namespace: string;
  orgId: string;
  content: string;
  score: number;
}

// ── Agent Response ────────────────────────────────────────────────────────────
export interface AgentResponse {
  response: string;
  threadId: string;
  model: string;
  latencyMs: number;
  toolsUsed: string[];
  retrievedChunks?: RetrievedChunk[];  // present only when the request set debugMode=true
}

// ── Audit Event ───────────────────────────────────────────────────────────────
// Written to D1 for every request — who asked what, when, with what result.
export interface AuditEvent {
  id: string;
  timestamp: number;
  userId: string;
  role: Role;
  orgId: string;
  agentType: AgentType;
  threadId: string;
  messagePreview: string;   // first 100 chars of user message
  toolsUsed: string[];
  responseLatencyMs: number;
  model: string;
  blocked: boolean;
  blockReason?: string;
}

// ── Cloudflare Worker Env ─────────────────────────────────────────────────────
// Bindings declared in wrangler.toml, injected by the runtime.
export interface Env {
  // Durable Objects
  ACCOUNT_AGENT: DurableObjectNamespace;
  ENABLEMENT_AGENT: DurableObjectNamespace;
  TRANSCRIPT_AGENT: DurableObjectNamespace;

  // KV
  RATE_LIMIT_KV: KVNamespace;
  USER_MEMORY_KV: KVNamespace;

  // D1
  DB: D1Database;

  // Vectorize
  VECTORIZE: VectorizeIndex;

  // Workers AI
  AI: Ai;

  // Vars
  ENVIRONMENT: string;
  JWT_AUDIENCE: string;
  JWT_SECRET?: string;   // set via wrangler secret
}

// ── Metric Row ────────────────────────────────────────────────────────────────
// Shape of a row in the request_metrics D1 table.
export interface MetricRow {
  id: string;
  timestamp: number;
  orgId: string;
  userId: string;
  agentType: AgentType;
  latencyMs: number;
  kbChunksUsed: number;
  toolsCalled: string[];
  status: "success" | "error" | "rate_limited";
  errorType?: string;
}

// ── Rate Limit Result ─────────────────────────────────────────────────────────
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// ── KB Namespace ──────────────────────────────────────────────────────────────
// Maps roles to the Vectorize namespaces they can query.
export type KBNamespace = "public" | "se_only" | "manager_only";

export const ROLE_KB_ACCESS: Record<Role, KBNamespace[]> = {
  ae:            ["public"],
  csm:           ["public"],
  se:            ["public", "se_only"],
  tam:           ["public", "se_only"],
  sales_manager: ["public", "se_only", "manager_only"],
};
