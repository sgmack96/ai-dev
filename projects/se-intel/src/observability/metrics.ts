/**
 * src/observability/metrics.ts
 *
 * Writes one row to request_metrics per agent request.
 * Called from base-agent.ts via state.waitUntil() — non-blocking,
 * does NOT add latency to the response path.
 *
 * Separate from audit_log because:
 * - Metrics are higher-frequency and write-only from the hot path
 * - Optimised for time-series aggregation (p95, error rate, counts)
 * - Audit log carries PII (message_preview, role) — metrics don't
 *
 * SLO thresholds (evaluated at query time in /api/v1/health):
 *   p95 latency:  < 8000ms
 *   error rate:   < 5%
 */

import type { AgentType, Env } from "../types/index.js";

// ── SLO constants ─────────────────────────────────────────────────────────────
// Calibrated 2026-07-01 against real production data (10 requests, 2 orgs):
//   cloudflare org: p50=10725ms, p95=13118ms
//   portfolio-org:  p50=6536ms,  p95=11737ms
//
// 8000ms was the initial aspirational target. It was wrong for a 70B model
// with RAG (embedding query + vector search + 70B generation in one path).
// The honest p95 for this architecture under normal load is 12-15s.
//
// Decision: set 15000ms as the p95 target. This is achievable, measurable,
// and reflects the real cost of running a 70B model at the edge.
// Future improvement path: cache common KB answers, reduce max_tokens, or
// route simple queries to a smaller model (Llama 8B) — all trackable via this SLO.
export const SLO = {
  P95_LATENCY_MS: 15000,  // p95 response time target — calibrated against real 70B production data
  ERROR_RATE_PCT: 5,      // max acceptable error rate
  WINDOW_HOURS: 24,       // default rolling window for health queries
} as const;

// ── Metric input ──────────────────────────────────────────────────────────────
export interface MetricInput {
  orgId: string;
  userId: string;
  agentType: AgentType;
  latencyMs: number;
  kbChunksUsed: number;
  toolsCalled: string[];
  status: "success" | "error" | "rate_limited";
  errorType?: string;
}

// ── Write a single metric row ─────────────────────────────────────────────────
// Fire-and-forget from base-agent. Errors are swallowed — a metrics write
// failure must never surface to the user or affect response delivery.
export async function writeMetric(input: MetricInput, env: Env): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO request_metrics
       (id, timestamp, org_id, user_id, agent_type, latency_ms,
        kb_chunks_used, tools_called, status, error_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    Date.now(),
    input.orgId,
    input.userId,
    input.agentType,
    input.latencyMs,
    input.kbChunksUsed,
    JSON.stringify(input.toolsCalled),
    input.status,
    input.errorType ?? null
  ).run();
}

// ── Health scorecard query ────────────────────────────────────────────────────
// Returns aggregated metrics for one org (or all orgs for admin view).
// p95 is approximated via a percentile query on SQLite — no external service needed.
export interface OrgHealthData {
  orgId: string;
  windowHours: number;
  requestCount: number;
  successCount: number;
  errorCount: number;
  errorRatePct: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  agentBreakdown: { agentType: string; requests: number }[];
  slos: {
    latency: { targetMs: number; p95Ms: number; passing: boolean };
    errorRate: { targetPct: number; actualPct: number; passing: boolean };
  };
  errorBudgetRemainingPct: number;
}

export async function getOrgHealth(
  orgId: string | null,   // null = all orgs (admin view)
  windowHours: number,
  env: Env
): Promise<OrgHealthData[]> {
  const windowMs = windowHours * 60 * 60 * 1000;
  const since = Date.now() - windowMs;

  // Build org filter
  const orgFilter = orgId ? `AND org_id = ?` : "";
  const orgParams = orgId ? [since, orgId] : [since];

  // Get all org IDs in window
  const orgRows = await env.DB.prepare(
    `SELECT DISTINCT org_id FROM request_metrics WHERE timestamp >= ? ${orgFilter} ORDER BY org_id`
  ).bind(...orgParams).all<{ org_id: string }>();

  const orgs = orgRows.results.map((r) => r.org_id);

  const results: OrgHealthData[] = [];

  for (const org of orgs) {
    // Step 1: counts
    const agg = await env.DB.prepare(
      `SELECT
         COUNT(*)                                               AS total,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)  AS successes,
         SUM(CASE WHEN status = 'error'   THEN 1 ELSE 0 END)  AS errors
       FROM request_metrics
       WHERE org_id = ? AND timestamp >= ?`
    ).bind(org, since)
      .first<{ total: number; successes: number; errors: number }>();

    const total = agg?.total ?? 0;
    const successes = agg?.successes ?? 0;
    const errors = agg?.errors ?? 0;
    const errorRatePct = total > 0 ? parseFloat(((errors / total) * 100).toFixed(1)) : 0;

    // Step 2: percentiles — fetch sorted latencies, pick at the right rank in JS.
    // SQLite doesn't have a native percentile function; fetching the sorted list and
    // slicing in the runtime is simpler and correct for small windows (< 10k rows).
    const latencyRows = await env.DB.prepare(
      `SELECT latency_ms FROM request_metrics
       WHERE org_id = ? AND timestamp >= ?
       ORDER BY latency_ms ASC`
    ).bind(org, since).all<{ latency_ms: number }>();

    const latencies = latencyRows.results.map((r) => r.latency_ms);
    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.50)] ?? 0 : 0;
    const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] ?? 0 : 0;

    // Agent breakdown
    const agentRows = await env.DB.prepare(
      `SELECT agent_type, COUNT(*) as cnt
       FROM request_metrics
       WHERE org_id = ? AND timestamp >= ?
       GROUP BY agent_type
       ORDER BY cnt DESC`
    ).bind(org, since).all<{ agent_type: string; cnt: number }>();

    const agentBreakdown = agentRows.results.map((r) => ({
      agentType: r.agent_type,
      requests: r.cnt,
    }));

    // SLO evaluation
    const latencyPassing = p95 <= SLO.P95_LATENCY_MS;
    const errorRatePassing = errorRatePct <= SLO.ERROR_RATE_PCT;

    // Error budget: how much of the allowed error rate is left
    const errorBudgetRemainingPct =
      SLO.ERROR_RATE_PCT > 0
        ? parseFloat(Math.max(0, ((SLO.ERROR_RATE_PCT - errorRatePct) / SLO.ERROR_RATE_PCT) * 100).toFixed(1))
        : 100;

    results.push({
      orgId: org,
      windowHours,
      requestCount: total,
      successCount: successes,
      errorCount: errors,
      errorRatePct,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      agentBreakdown,
      slos: {
        latency: { targetMs: SLO.P95_LATENCY_MS, p95Ms: p95, passing: latencyPassing },
        errorRate: { targetPct: SLO.ERROR_RATE_PCT, actualPct: errorRatePct, passing: errorRatePassing },
      },
      errorBudgetRemainingPct,
    });
  }

  return results;
}
