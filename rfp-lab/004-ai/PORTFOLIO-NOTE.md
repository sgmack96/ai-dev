# Portfolio Note — AI Infrastructure Lab (Pillar 4)
> **For:** Portfolio, LinkedIn, interviews. No customer names or internal data — this pillar was never derived from a real customer conversation. Safe to share publicly.

---

## Why This Lab Is Different From the Other Three

Pillars 1-3 answer real, sanitized enterprise RFPs. This one is different on purpose: instead of a customer conversation, the "customer" is a composite, hypothetical B2B sales org evaluating exactly the kind of AI platform `se-intel` already is. The requirements were written first, independent of what had already been built, then answered against the live system — not the other way around.

---

## What I Built to Answer It

`se-intel` — a multi-agent revenue intelligence platform on Cloudflare Workers, hardened across three cycles of dedicated engineering work before this RFP exercise even started:

| Cycle | What Shipped | Proven |
|---|---|---|
| 1 | Multi-tenant isolation — RAG, memory, audit | 3 deterministic admin probes, 0 cross-org leaks |
| 2 | Evals as a CI gate | A deterministic faithfulness check caught a real bug an LLM judge missed (KB said 35%, agent said 25%) |
| 3 | Observability + SLOs | A recalibrated SLO based on real measured traffic (8s guess → 13s measured → 15s target), plus a live health scorecard |
| (unplanned) | Found + fixed 2 live bugs same-day | A metrics status field that could never record a failure, and a 5-day public-demo outage caused by an overly broad security guard |

**Coverage:** 24 of 33 requirements fully compliant (73%), 2 partially compliant (6%), 7 named gaps (21%) — including two ratings that were genuinely non-compliant as of the morning this matrix was written, and are compliant now because they were found and fixed during the engagement, not assumed from the start.

**The honest gaps documented:**
- No reranking pass on retrieval (raw cosine top-K only)
- Agent and evaluation judge share the same model — self-grading bias, named and unfixed
- AI Gateway-level rate limiting and content-safety (DLP) controls are toggled on but not configured — the DLP gap was actively attempted this session and blocked by API token scope, not skipped
- The application-level rate limiter has a real concurrency bug — 25 simultaneous requests should trip a 20/minute limit and mostly didn't, because of a KV read-then-write race

---

## Why This Matters for Technical Pre-Sales / Applied AI Roles

The standard AI demo is a happy-path walkthrough on a slide. This is different in three specific ways:

1. **Every "Compliant" rating traces to something real** — a specific file and line number, a specific probe output, or a specific live API response pulled from the actual Cloudflare account during the writing of this document, not from memory or documentation.

2. **Two ratings flipped from non-compliant to compliant during the engagement itself.** The metrics status-tracking gap and the auth-guard outage were both found *while building this RFP response*, not before it — and both were fixed and re-verified against live traffic the same day, with the fix documented alongside the original failure, not quietly cleaned up.

3. **The gaps that are still open say exactly why, not just that.** GTW-05 (PII controls) isn't marked as a gap because it wasn't tried — it's marked as a gap because the available API token doesn't have the permission scope to configure it, and that's stated explicitly. That's the difference between "we haven't gotten to it" and "here's the specific blocker and what would remove it."

---

## Safe Description for Portfolio / LinkedIn

> *"Built a self-constructed 33-requirement RFP for 'AI infrastructure for enterprise sales teams' and answered it against a real, live multi-agent AI platform (se-intel) — multi-tenant isolation, RAG faithfulness, a deterministic CI eval gate, calibrated SLOs, and AI Gateway governance. 73% fully compliant, with every rating backed by a specific probe, file, or live API check. While building the response matrix, found and fixed two live production bugs same-day — a metrics field that could never record a failure, and a security control that had been silently blocking the public demo for 5 days — and documented both the failure and the fix in the matrix itself, rather than only showing the finished state."*

---

*No sanitization footer needed — this pillar never involved real customer data. Requirements are self-authored; system evidence is real and current as of 2026-07-08.*
