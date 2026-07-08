# Pillar 4 — AI Use Case Notes
> **Purpose:** Sanitized patterns from real customer conversations involving AI Gateway, Workers AI, and LLM infrastructure. No company names, contact names, or deal specifics.

---

## Use Case 1: Unified Model Evaluation for AI Lab

**Pattern:** An AI research lab building its own frontier model needs to benchmark it against competitor models (OpenAI, Anthropic) using identical prompts. The core pain: managing separate API keys, billing accounts, and SDKs for each provider creates friction that slows the evaluation cycle.

**What they need:**
- Single API token and endpoint to access multiple LLM providers
- OpenAI-compatible API — write the evaluation framework once, swap the model string to route to any provider
- Unified billing — one bill for all provider usage, no separate API key management per provider
- Zero Data Retention (ZDR) — toggle at the gateway level so upstream providers do not use evaluation data for training
- Immediate access with minimal overhead — cost is secondary to speed and frictionless setup

**Cloudflare solution:** AI Gateway

| Requirement | AI Gateway Feature |
|---|---|
| Single endpoint | AI Gateway endpoint with OpenAI-compatible API |
| Model routing | Swap model string (e.g., `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `anthropic/claude-opus-4.6`) to route to any provider |
| Unified billing | Cloudflare handles payments to upstream providers, single credit balance |
| ZDR | Zero Data Retention flag appended to upstream requests per gateway configuration |
| Logging | Per-request logging: prompt metadata, token count, latency, cost, provider, model |

**Workers AI distinction:** This customer specifically needed proprietary frontier models (Claude, GPT) — not open-weight models. AI Gateway routes to proprietary providers. Workers AI runs open-weight models (Llama, Mistral) natively on Cloudflare's edge GPUs. Different products, different use cases, but same dashboard.

**What this maps to in the response matrix:**
- LLM-SG-01 (Authentication) — single gateway token
- LLM-SG-03 (Provider Abstraction) — single endpoint, multiple providers
- LLM-SG-04 (Provider Routing) — model string determines routing
- LLM-SG-06 (Logging) — per-request metadata
- LLM-SG-14 (Spend Visibility) — unified billing dashboard

---

## Use Case 2: SE Intel as AI RFP Proof of Work (Self-Built)

**Pattern:** SE Intel is a multi-agent revenue intelligence platform built on Cloudflare Workers that demonstrates the full AI platform stack — Workers AI inference, Vectorize RAG, Durable Objects for state, KV for memory, D1 for audit, streaming SSE, and an LLM-as-judge evaluation harness.

**What SE Intel proves against an AI infrastructure RFP:**

| Requirement Category | What SE Intel Demonstrates |
|---|---|
| Multi-tenant RAG | Vectorize with `orgId` metadata filtering — each org only sees their own knowledge base |
| Role-based access | JWT with role claim → different KB namespaces per role (public, technical, leadership) |
| Streaming inference | Workers AI → SSE streaming → browser (token-by-token rendering) |
| Agent memory | Durable Objects (SQLite) for conversation history + KV for long-term facts |
| Evaluation harness | Python eval framework: 15 test cases, LLM-as-judge (4 dimensions, 12-point scale), regression diff |
| Audit trail | D1 audit log: every request logged with userId, orgId, agent, tools used, latency |
| Multi-tenant isolation | Proven across 5 layers: auth, RAG, memory, audit, rate limiting |

**Status as of 2026-07-08 — updated from the original gap list above:**
- ~~AI Gateway integration~~ — **CLOSED.** `se-intel-gateway` live since 2026-06-30, all 4 `AI.run()` call sites routed, verified via live Cloudflare API check.
- ~~Formal SLOs~~ — **CLOSED.** Shipped Cycle 1 Week 3 — `/api/v1/health` + `/admin/health-scorecard`, SLO recalibrated against real measured traffic.
- PII redaction in prompts — **still open.** Confirmed via live API check: DLP is toggled on for `se-intel-gateway` (`dlp.enabled: true`) but has zero policies attached (`dlp.policies: []`). Attempted to close this on 2026-07-08 during the Pillar 4 exercise; blocked by API token scope (Workers AI Edit only, no DLP permission) — a real, honest access-control blocker, not an effort gap.
- Per-team token budgets — still open, not yet attempted.
- Fine-tuning / model customization — still open, already scheduled in `README.md`'s gap fillers for `MASTERY.md` Cycle 1 Week 6.

**New gaps found during the Pillar 4 exercise itself (not on the original list):**
- Gateway-level rate limiting was never configured (`rate_limiting_limit: 0` on `se-intel-gateway`) — application-level rate limiting exists instead, and it has its own bug (below).
- The application-level (KV-based) rate limiter has a real concurrency bug: 25 near-simultaneous requests against a 20/minute limit left the counter at 10, not ~20. Scoped for Cycle 1 Week 4.
- Two bugs found and fixed same-day while verifying the matrix: `writeMetric()` couldn't record failures (hardcoded to `"success"`), and a global auth guard had silently blocked the entire public demo for 5 days. Both are now closed — see `RESPONSE-MATRIX.md` OBS-05 and SEC-04 for the full detail. These are the two ratings in the matrix that were genuinely non-compliant the same morning this document was updated.

---

## How Pillar 4 RFP Exercise Will Work

Unlike Pillars 1-3 (external customer RFPs), Pillar 4 is built around SE Intel itself:

1. **Construct a mock RFP** for "AI Infrastructure for Enterprise Sales Teams" — ✅ done, see `RFP-SUMMARY.md`
2. **Answer every requirement** using SE Intel as the proof of work — ✅ done, see `RESPONSE-MATRIX.md` (33 requirements, 73% compliant)
3. **Build the gaps** — AI Gateway integration and formal SLOs were already closed by Cycle 1 Weeks 1-3 before this exercise started. PII redaction was attempted and honestly blocked (see above). Per-team token budgets, reranking, an independent judge model, gateway-level rate limiting, and the KV rate-limiter concurrency bug remain open — see `RESPONSE-MATRIX.md`'s summary for the full list.
4. **Document it** — ✅ done: `RFP-SUMMARY.md`, `RESPONSE-MATRIX.md`, `PORTFOLIO-NOTE.md`

This connects directly to the Cycle 1 work in MASTERY.md and makes Pillar 4 continuous with the existing build cadence rather than a detour.

---

*Sanitized: All company names, employee names, deal specifics, and internal references removed. Technical patterns only.*
