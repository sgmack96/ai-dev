# Cycle 1 / Week 3 — Observability, SLOs, and Account-Health Scorecard

> **Interview Q this answers:** "How do you track adoption and health of an AI system?"
> **Status:** COMPLETE
> **Completed:** 2026-07-01

---

## What Was Built

### Already in production before this session
- `src/observability/metrics.ts` — `writeMetric()` + `getOrgHealth()` + SLO constants
- `schema.sql` — `request_metrics` table with org/agent/status indexes
- `base-agent.ts` — `writeMetric()` wired to both `/chat` and `/stream` paths via `state.waitUntil()`
- `GET /api/v1/health` — org-scoped, role-gated SLO scorecard for self-service
- `GET /admin/health-scorecard` — all-orgs view, bearer-gated for ops

### Built this session (2026-07-01)
1. **SLO calibration** — updated `P95_LATENCY_MS` from 8000ms to 15000ms based on real production data
2. **Health probe script** — `evaluation-harness/tests/health-probe.sh`, 4 deterministic assertions, CI-compatible
3. **Deployed** — version `97e0b8a4` live, both orgs now showing `status: healthy`

---

## The Key Decision: SLO Calibration

### What we found
The initial SLO target was 8000ms p95. When we hit the live scorecard against real production data:

```
cloudflare org:   p50=10725ms, p95=13118ms  →  FAILING
portfolio-org:    p50=6536ms,  p95=11737ms  →  FAILING
```

Both orgs were "degraded" from day one — not because the system was broken, but because the target was aspirational, not empirical.

### The decision
Set 15000ms as the p95 target. Reasoning:

- A 70B model (Llama 3.3 70B) with RAG involves: embedding query (BGE 768-dim) + Vectorize search + 70B generation in sequence
- Workers AI 70B generation alone takes 8-13s for a 1024-token response
- 15000ms gives realistic headroom while still being measurable and improvable
- Future improvement paths are now trackable against this baseline: cache hot KB answers, route simple queries to 8B model, reduce max_tokens

### Why this matters in an interview
The wrong answer: "Our p95 target is 8 seconds."
The right answer: "We started with 8 seconds, deployed, measured 13 seconds in production, and recalibrated to 15 seconds. The target is now achievable and the system reports `healthy`. Here's the improvement roadmap."

SLOs are meaningless if they're permanently failing. A perpetually red dashboard trains people to ignore dashboards.

---

## Architecture Decisions

### Why D1 for metrics, not Workers Analytics Engine?
Workers Analytics Engine is the "right" tool for high-cardinality time-series in production. But it requires a separate binding, a separate query language (SQL Analytics), and doesn't work in local dev without mocking.

D1 was already the audit log backend. Adding `request_metrics` there means:
- One binding, one mental model
- Standard SQL for percentile queries (sort-and-slice in JS, not native percentile functions)
- Works in local dev with `wrangler dev`
- The cost: SQLite sort-and-slice for p95 is O(n log n). At <10k rows/window it's fine. At >100k rows it would be slow — that's the trigger to migrate to Analytics Engine.

### Why `state.waitUntil()` for metric writes?
The metric write is fire-and-forget — it must not add latency to the response path. `state.waitUntil()` tells the Durable Object runtime to keep the isolate alive until the promise resolves, even after `Response` is returned. Without it, the DO could be killed before the D1 write completes.

This is the same pattern used for audit log writes — Week 1 taught us that any async work after the response must use `waitUntil()`.

### Why separate `request_metrics` from `audit_log`?
Two different concerns:
- `audit_log` carries PII (message_preview, role, threadId) — retention and access is governed
- `request_metrics` is purely operational — latency, status, agent type, no message content
- Metrics are higher write frequency and optimised for aggregation (ORDER BY latency_ms ASC)
- Separating them means you can delete/purge metrics without touching audit records

---

## What the Live System Shows

```
GET /admin/health-scorecard?window=168
{
  "status": "healthy",
  "sloTargets": { "p95LatencyMs": 15000, "errorRatePct": 5 },
  "orgCount": 2,
  "orgs": [
    {
      "orgId": "cloudflare",
      "requestCount": 6,
      "errorRatePct": 0,
      "p50LatencyMs": 10725,
      "p95LatencyMs": 13118,
      "slos": {
        "latency": { "targetMs": 15000, "p95Ms": 13118, "passing": true },
        "errorRate": { "targetPct": 5, "actualPct": 0, "passing": true }
      },
      "errorBudgetRemainingPct": 100
    },
    {
      "orgId": "portfolio-org",
      "requestCount": 4,
      "errorRatePct": 0,
      "p50LatencyMs": 6536,
      "p95LatencyMs": 11737,
      "slos": {
        "latency": { "targetMs": 15000, "p95Ms": 11737, "passing": true },
        "errorRate": { "targetPct": 5, "actualPct": 0, "passing": true }
      },
      "errorBudgetRemainingPct": 100
    }
  ]
}
```

---

## Probe Results

```
./evaluation-harness/tests/health-probe.sh

✓ PASS  http-200            — HTTP 200
✓ PASS  orgs-have-data      — 2 org(s) have request_metrics rows
✓ PASS  error-rate-slo      — All orgs within 5% error rate SLO
✓ PASS  p95-calculated      — All orgs have non-zero p95

ALL HEALTH CHECKS PASSED — observability system verified
```

---

## The Interview Answer

**Q: "How do you track adoption and health of an AI system?"**

> "We emit a structured metric on every agent request — latency, agent type, org, status — written non-blocking via `waitUntil()` to a D1 table. That feeds a `/api/v1/health` endpoint that returns a per-org SLO scorecard: p50/p95 latency, error rate, error budget remaining, and a `passing: true/false` for each SLO. Managers see all orgs, users see only their own org.
>
> The interesting part was calibration. We started with an 8-second p95 target. When we deployed and measured real 70B model traffic, p95 was 13 seconds. So we recalibrated to 15 seconds with a documented rationale and an improvement roadmap — smaller model routing for simple queries, KB answer caching. A perpetually failing SLO is worse than no SLO — it trains people to ignore the dashboard."

---

## Definition of Done

- [x] `request_metrics` table in D1 — writes on every request
- [x] `writeMetric()` wired to both `/chat` and `/stream` paths via `waitUntil()`
- [x] `getOrgHealth()` — p50/p95, error rate, agent breakdown, SLO eval, error budget
- [x] `/api/v1/health` — self-service, org-scoped, role-gated
- [x] `/admin/health-scorecard` — all-orgs, bearer-gated
- [x] SLO calibrated to real production data (15000ms p95)
- [x] `health-probe.sh` — 4/4 passing, deterministic, CI-compatible
- [x] Deployed — version `97e0b8a4`, both orgs `status: healthy`

*Week 4 next: Failure under load — fallback injection, DO contention handling.*
