# RFP 004 — AI Infrastructure for Enterprise Sales Teams
> **Industry:** B2B SaaS / Revenue Intelligence
> **Company Profile:** Composite/hypothetical — a mid-size B2B software vendor (multiple enterprise customer accounts, multiple internal sales roles) evaluating a multi-agent AI platform for pre-call research and sales enablement
> **Use Case:** Multi-tenant, role-gated AI agents grounded in an internal knowledge base, with governance, evaluation, and observability sufficient for a security/compliance review
> **Compliance driver:** Customer data must never cross tenant boundaries; AI spend and model usage must be auditable; quality regressions must be caught before they reach users
> **Current Stack:** Ad hoc — sales reps use ChatGPT/Claude directly with copy-pasted account context, no logging, no cost visibility, no consistency across reps

---

## How This Pillar Differs From Pillars 1-3

Pillars 1-3 answer real, sanitized customer RFPs. Pillar 4 is different by design (see `USE-CASE-NOTES.md`): there is no external customer here. This is a **self-constructed mock RFP**, built by treating `se-intel` — the AI system actually built and hardened across Cycle 1 of `MASTERY.md` — as the vendor's proof of work. Every requirement below is something `se-intel` could plausibly be asked to prove in a real AI-infrastructure RFP; every answer in `RESPONSE-MATRIX.md` is backed by real code, real deployed behavior, or an honestly named gap — not a hypothetical capability.

---

## Customer Context (Composite)

A B2B software company's sales organization — account executives, solutions engineers, CSMs, TAMs, and sales managers — currently researches prospects and handles objections by pasting account context into general-purpose LLM chat tools. This creates three problems the RFP is meant to solve:

1. **No tenant isolation.** If the platform is ever extended to let individual enterprise customers (not just internal reps) query it, one customer's data must never be retrievable by another.
2. **No consistency or quality control.** Different reps get different answers to the same question, with no way to measure whether responses are accurate or grounded in real product facts.
3. **No governance.** Nobody can answer "how much are we spending on this," "which model handled this request," or "did that agent actually fail, or did it just look slow" — because nothing is instrumented.

The RFP evaluates whether a Cloudflare-native multi-agent AI platform can close all three gaps.

---

## Objective

Select or validate an AI agent platform that provides:
1. Multi-tenant data isolation across retrieval, memory, and audit — provable, not just claimed
2. Role-based knowledge access matched to five distinct sales roles
3. An evaluation framework that catches quality regressions before deploy, including regressions an LLM judge itself might miss
4. Observability sufficient to answer "is this healthy right now" with real SLOs, not vibes
5. Centralized AI model governance — routing, cost visibility, usage attribution, and content safety controls
6. Security and access control that fails safe under both threat scenarios: unauthorized access, and unintentional self-inflicted lockout of legitimate users
7. Documented, honest gaps where the platform is not yet ready — not a sales deck

---

## Requirements

### Multi-Tenancy & Data Isolation (MTN)

| ID | Area | Description |
|---|---|---|
| MTN-01 | RAG Isolation | Knowledge base retrieval must never return another tenant's private content |
| MTN-02 | Memory Isolation | Conversation history and long-term memory must be physically isolated per tenant, not just filtered |
| MTN-03 | Audit Isolation | Compliance/audit reads must be scoped by tenant and role, with no cross-tenant read path |
| MTN-04 | Shared Content Model | Support both tenant-private knowledge and universally shared (non-tenant) content in the same retrieval layer |
| MTN-05 | Deterministic Verification | Isolation claims must be provable by an automated, non-LLM test — not asserted by code review alone |

### RAG & Knowledge Grounding (RAG)

| ID | Area | Description |
|---|---|---|
| RAG-01 | Role-Gated Retrieval | Different sales roles must see different knowledge tiers (e.g., public vs. internal-technical vs. deal-strategy content) |
| RAG-02 | Semantic Retrieval | Vector similarity search over a curated knowledge base, not keyword matching |
| RAG-03 | Relevance Thresholding | Low-confidence retrieval matches must be filtered rather than injected into the prompt |
| RAG-04 | Generation Faithfulness | The model's response must not contradict or silently drop facts that were actually retrieved |
| RAG-05 | Retrieval Fallback | Graceful degradation (e.g., fall back to web search) when retrieval returns nothing, rather than silent failure |
| RAG-06 | Reranking | A precision-improving reranking pass after initial vector retrieval |

### Evaluation & Quality Assurance (EVAL)

| ID | Area | Description |
|---|---|---|
| EVAL-01 | Automated Quality Scoring | LLM-as-judge scoring across multiple response-quality dimensions |
| EVAL-02 | Deterministic Regression Gate | A quality check that cannot be masked by the same failure mode it's designed to catch |
| EVAL-03 | CI-Integrated Gate | Quality checks that can block a deploy, not just produce a report after the fact |
| EVAL-04 | Cross-Tenant Faithfulness | Isolation must hold at the generation layer, not just the retrieval layer — one tenant's facts must never surface in another's response |
| EVAL-05 | Independent Judge | The model being evaluated and the model doing the evaluating should not be the same model |

### Observability, SLOs & Reliability (OBS)

| ID | Area | Description |
|---|---|---|
| OBS-01 | Per-Tenant Health Reporting | Latency percentiles, error rate, and error budget remaining, reportable per tenant |
| OBS-02 | Non-Blocking Telemetry | Metrics and audit capture must not add latency to the user-facing response path |
| OBS-03 | Calibrated SLOs | Latency/error targets must be calibrated against real measured production traffic, not aspirational guesses |
| OBS-04 | Deterministic Health Probes | Health verification must not require an LLM in the test path |
| OBS-05 | Accurate Failure Tracking | The metrics system must be able to record that a request failed — not just that requests happened |
| OBS-06 | Concurrency-Safe Counters | Rate limiting and usage counters must hold their guarantees under real concurrent load, not just sequential testing |

### AI Gateway & Model Governance (GTW)

| ID | Area | Description |
|---|---|---|
| GTW-01 | Unified Model Routing | A single integration point for all model calls, regardless of which model or provider serves the request |
| GTW-02 | Usage Attribution | Every model call tagged with enough metadata (user, org, role, call type) to attribute cost and behavior |
| GTW-03 | Cost & Usage Visibility | Token counts, latency, and cost visible per request, without building custom instrumentation |
| GTW-04 | Gateway-Level Rate Limiting | Quota enforcement at the model-gateway layer, independent of application-level rate limiting |
| GTW-05 | Content Safety / PII Controls | Sensitive data detection or redaction before a prompt reaches an upstream model provider |
| GTW-06 | Data Retention Controls | Ability to enforce zero/limited data retention with upstream model providers for sensitive workloads |

### Security & Access Control (SEC)

| ID | Area | Description |
|---|---|---|
| SEC-01 | Dual Auth Path | Support both a production SSO-integrated auth path and a simplified path for internal/demo use, producing identical identity context |
| SEC-02 | Execution-Time Authorization | Role-based access enforced at the point of data access (tool execution), not only at the router |
| SEC-03 | Defense-in-Depth Against Leakage | No single layer's failure should be sufficient to leak data across tenants or roles |
| SEC-04 | Fail-Safe Availability | Security middleware must not be capable of silently locking out legitimate users while appearing to function correctly |
| SEC-05 | Abuse Prevention | Per-user/role rate limiting to prevent cost runaway from a single account |

---

**Total Requirements: 33**

---

## Mapping to Cloudflare Platform

This pillar maps most directly to **Workers AI + AI Gateway + Vectorize + Durable Objects + D1 + KV** — the same stack already deployed for `se-intel`. Unlike Pillars 1-3, there is no separate "Cloudflare product to map to" step: the product being evaluated in this RFP *is* the platform `se-intel` is already built on, which is the point of using it as proof of work.

---

*This RFP is self-constructed, not derived from a real customer conversation — see "How This Pillar Differs From Pillars 1-3" above. No sanitization footer is needed because no real customer data was ever involved.*
