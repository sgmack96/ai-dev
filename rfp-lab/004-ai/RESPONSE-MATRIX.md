# Response Matrix — AI Infrastructure for Enterprise Sales Teams
> **Legend:** C = Compliant | PC = Partially Compliant | NC = Non-Compliant
> **Lab Proof:** ✅ = Built, deployed, and verified against the live `se-intel` system | ❌ = Gap (not yet built) | ⚠️ = Built but with a known, named limitation

---

## Multi-Tenancy & Data Isolation (MTN)

| ID | Area | Status | CF/se-intel Capability | Lab Proof | Response |
|---|---|---|---|---|---|
| MTN-01 | RAG Isolation | **C** | Vectorize metadata filter | ✅ | `kb-search.ts:94` filters every query on `{ namespace, orgId: { $in: [orgId, "global"] } }` — a fail-closed filter (a chunk with no `orgId` matches neither value and is dropped). Verified via `/admin/kb-probe`: `acme` org retrieves its private chunk + global docs; `portfolio-org` gets only global docs, with the acme chunk confirmed filtered out despite scoring higher. `isolationOk: true`, `leakedChunks: 0`. |
| MTN-02 | Memory Isolation | **C** | Durable Object key scoping + KV key scoping | ✅ | Short-term memory: DO `idFromName()` uses `${orgId}:${userId}` — different orgs get physically separate SQLite instances, not a filtered shared one. Long-term memory: KV keys are `ltm:{orgId}:{userId}:{factId}`. Verified via `/admin/memory-probe`: writes a fact as orgA, reads as orgB, asserts 0 leaked facts. `isolationOk: true`. |
| MTN-03 | Audit Isolation | **C** | D1 org-scoped, role-split reads | ✅ | `GET /api/v1/audit` reads `orgId` from the JWT only, never the request. `sales_manager` sees all rows for their org (`scope: "org"`); every other role sees only their own rows (`scope: "own"`). Verified via `/admin/audit-probe`: fetches orgA's most recent row ID, confirms orgB's scoped query cannot return it. `isolationOk: true`, `crossOrgLeaked: 0`. |
| MTN-04 | Shared Content Model | **C** | `"global"` sentinel org on shared chunks | ✅ | 102 of 105 seeded chunks are tagged `orgId: "global"` (universal product knowledge); 3 are tagged `orgId: "acme"` (tenant-private). Both are queryable by the same role/namespace filter, with tenant isolation enforced independently by MTN-01's `$in` filter. |
| MTN-05 | Deterministic Verification | **C** ⚠️ | `isolation-test.sh` | ✅ | Runs all three probes above in sequence, asserts `isolationOk: true` on each, CI-compatible (`--ci` flag exits 1 on failure). No LLM anywhere in the test path. **Honest limitation:** this exact script silently broke on 2026-07-06 — an unrelated global auth-middleware change (added for a different feature) caused all 3 probes to fail with `Unauthorized`, not because isolation regressed, but because the script's request headers didn't account for the new check. Fixed same day. The lesson generalizes: a deterministic probe is only as good as how recently it was re-run against the current system — see SEC-04 for a related, more serious instance of the same pattern. |

## RAG & Knowledge Grounding (RAG)

| ID | Area | Status | CF/se-intel Capability | Lab Proof | Response |
|---|---|---|---|---|---|
| RAG-01 | Role-Gated Retrieval | **C** | `ROLE_KB_ACCESS` map, enforced at tool execution | ✅ | Three namespaces (`public`, `se_only`, `manager_only`) mapped per role in `types/index.ts`, re-checked inside `kbSearchRaw` at query time — not just at the router. A bug in the orchestrator passing the wrong role still gets rejected by the tool itself. |
| RAG-02 | Semantic Retrieval | **C** | Workers AI BGE embeddings + Vectorize | ✅ | Queries embedded via `@cf/baai/bge-base-en-v1.5`, searched with cosine similarity, `topK: 5`. |
| RAG-03 | Relevance Thresholding | **C** | `MIN_SCORE = 0.5` | ✅ | `kb-search.ts:26` — matches below 0.5 cosine similarity are filtered before formatting, so a weak semantic match never reaches the prompt. |
| RAG-04 | Generation Faithfulness | **PC** ⚠️ | `faithfulness.py` + GROUNDING RULE prompt | ✅ | A chunk stating "35% discount" was in context; the agent answered "25%" — retrieval was correct, generation was not faithful (found Cycle 1 Week 1 Day 2). Root-cause fix: a GROUNDING RULE added to the system prompt ("cite named facts verbatim, never alter a number"), which stabilized a flaky case (`fth-003`) from ~50% pass to 3/3. **Rated PC, not C:** faithfulness is enforced by a prompt instruction, which is probabilistic by nature — the deterministic check (EVAL-02) catches violations after the fact and blocks deploy, but nothing prevents the underlying model from drifting again with a different phrasing. |
| RAG-05 | Retrieval Fallback | **C** | `kbSearch` returns `null` on empty/failed retrieval | ✅ | Both agents fall back to web search (DuckDuckGo) when `kbSearch` returns `null`; if that also fails, the LLM answers from training data with a system-prompt instruction to flag ungrounded answers. No single tool failure blocks the response. |
| RAG-06 | Reranking | **NC** | — | ❌ | Not built. Current retrieval is raw cosine top-K with no reranking pass. Named as a Cycle 2 candidate in `BACKLOG.md` ("Reranking + recall@k"). |

## Evaluation & Quality Assurance (EVAL)

| ID | Area | Status | CF/se-intel Capability | Lab Proof | Response |
|---|---|---|---|---|---|
| EVAL-01 | Automated Quality Scoring | **C** | `judge.py` — LLM-as-judge | ✅ | 5 dimensions (groundedness, relevance, role-appropriateness, actionability, faithfulness), 15-point scale, pass threshold 10. Score progression across 3 prompt-engineering iterations: 67% → 73% → 87%. |
| EVAL-02 | Deterministic Regression Gate | **C** | `faithfulness.py` | ✅ | Pure string-grounding check — compares what was actually retrieved (via `?debug=true`) against what the response contains. Distinguishes `grounding_fail` (retrieved but dropped — blocks CI) from `retrieval_fail` (never retrieved — reported, not blocking) from `hallucination_fail` (invented fact — blocks CI). Cannot be masked by the same hallucination it's hunting, because it never asks an LLM whether the response is faithful. |
| EVAL-03 | CI-Integrated Gate | **C** | `run_eval.sh --ci` | ✅ | 4-step pipeline (runner → faithfulness → judge → report); `--ci` runs the deterministic gate fail-fast before the LLM judge even runs, to fail cheap before failing expensive. Verified exit code 1 on a real pre-fix flaky run, exit code 0 clean after. |
| EVAL-04 | Cross-Tenant Faithfulness | **C** | `fth-005` test case | ✅ | Runs acme's "35% discount" query as `portfolio-org` — the fact must not appear (forbidden), since portfolio-org was never granted that chunk. Ties MTN-01's retrieval-layer isolation to the generation layer: retrieval isolation alone doesn't guarantee the model won't hallucinate the same fact from training data or context bleed. |
| EVAL-05 | Independent Judge | **NC** | — | ❌ | The agent and the judge both run Llama 3.3 70B — documented self-grading bias (the judge is biased toward responses in its own style, so scores likely skew optimistic vs. an independent model). Fix identified (Claude via Anthropic API as judge) but not built. |

## Observability, SLOs & Reliability (OBS)

| ID | Area | Status | CF/se-intel Capability | Lab Proof | Response |
|---|---|---|---|---|---|
| OBS-01 | Per-Tenant Health Reporting | **C** | `getOrgHealth()`, `/api/v1/health`, `/admin/health-scorecard` | ✅ | p50/p95 latency, error rate, agent breakdown, SLO pass/fail, and error budget remaining, per org or across all orgs (role-gated: managers see all, others see their own). |
| OBS-02 | Non-Blocking Telemetry | **C** | `state.waitUntil()` / `c.executionCtx.waitUntil()` | ✅ | Every metric and audit write happens after the response is already returned to the client. Same pattern used both inside Durable Objects (`state.waitUntil`) and in the Worker's own rate-limit middleware, which isn't inside a DO (`c.executionCtx.waitUntil`). |
| OBS-03 | Calibrated SLOs | **C** | `SLO.P95_LATENCY_MS` | ✅ | Initial target (8000ms) was an aspirational guess; real 70B-model-with-RAG production traffic measured p95 = 13118ms / 11737ms across two orgs. Recalibrated to 15000ms, with the before/after numbers documented in code and a named improvement roadmap (KB answer caching, lower `max_tokens`, route simple queries to an 8B model). |
| OBS-04 | Deterministic Health Probes | **C** | `health-probe.sh` | ✅ | 4 assertions (endpoint reachable, data present, error rate within SLO, p95 non-zero), no LLM in the test path. The 4th assertion specifically exists to catch a percentile calculation silently defaulting to 0, which would otherwise look like flawless latency. |
| OBS-05 | Accurate Failure Tracking | **C** ⚠️ | `writeMetric()` status threading | ✅ | **Was NC until 2026-07-07.** `writeMetric()` hardcoded `status: "success"` on every call regardless of actual outcome — the error-rate SLO could structurally never detect a failure. Worse on the streaming path: a failure returned before any audit or metric write happened at all, not just mislabeled. Fixed same day: real success/error outcomes threaded through both paths, plus a `rate_limited` write added to the rate-limit middleware (which previously wrote nothing, since 429s never reach a Durable Object). Verified live: pre-seeded a KV counter over the limit, forced a real 429, confirmed the `rate_limited` row landed in D1 with `latency_ms: 35`. **Rated C with a caveat, not a full clean C:** the fix is hours old at time of writing, with no regression test yet guarding against this exact class of bug (a status field silently defaulting to a "healthy" value) recurring elsewhere in the codebase. |
| OBS-06 | Concurrency-Safe Counters | **NC** | KV sliding-window rate limiter | ❌ | Found while verifying OBS-05 on 2026-07-07: firing 25 near-simultaneous requests against a 20/minute limit left the KV counter at 10, not ~20 — a lost-update race under true concurrency, not a rounding error. The known fix (Durable-Object-based counter for exact enforcement, already named in `STUDY.md` Chapter 10) is scoped for Cycle 1 Week 4 ("Failure under load — DO contention handling") and not yet built. |

## AI Gateway & Model Governance (GTW)

| ID | Area | Status | CF/se-intel Capability | Lab Proof | Response |
|---|---|---|---|---|---|
| GTW-01 | Unified Model Routing | **C** | Cloudflare AI Gateway (`se-intel-gateway`) | ✅ | Confirmed live via the Cloudflare API: gateway `se-intel-gateway` exists (created 2026-06-30). All 4 `env.AI.run()` call sites in `se-intel` (chat, stream, embedding, long-term-memory extraction) route through it. |
| GTW-02 | Usage Attribution | **C** | Per-call gateway metadata | ✅ | Every routed call carries `user_id`, `user_role`, `org_id`, `agent_type`, and `call_type` metadata — attributable in the AI Gateway dashboard or via its GraphQL analytics API without any custom instrumentation. |
| GTW-03 | Cost & Usage Visibility | **C** | AI Gateway dashboard/GraphQL analytics | ✅ | `collect_logs: true` confirmed on `se-intel-gateway` via live API check. AI Gateway natively reports requests, token usage, cost, errors, and cache hit rate — no custom cost-tracking code required. |
| GTW-04 | Gateway-Level Rate Limiting | **NC** | — | ❌ | Confirmed via live API check: `rate_limiting_limit: 0` on `se-intel-gateway` — not configured at the gateway layer. Application-layer rate limiting exists instead (see SEC-05), which has its own gap (OBS-06). |
| GTW-05 | Content Safety / PII Controls | **NC** | AI Gateway DLP | ❌ | Confirmed via live API check: `dlp.enabled: true` on `se-intel-gateway`, but `dlp.policies: []` — the feature is toggled on with zero policies attached, so it currently does nothing. **Attempted to close this gap on 2026-07-07; blocked, not abandoned:** the API token available for this lab is scoped to Workers AI only (`Account > Workers AI > Edit`) and returned an authentication error against the DLP profiles endpoint. Closing this requires either a broader-scoped token or direct dashboard access — a real, honest example of a gap that's blocked by access control, not effort. |
| GTW-06 | Data Retention Controls | **NC** | AI Gateway Zero Data Retention | ❌ | Not configured on `se-intel-gateway`. The feature exists on the platform (used in a different, hypothetical use case documented in `USE-CASE-NOTES.md` Use Case 1) but has not been enabled for this system. |

## Security & Access Control (SEC)

| ID | Area | Status | CF/se-intel Capability | Lab Proof | Response |
|---|---|---|---|---|---|
| SEC-01 | Dual Auth Path | **C** | `extractUserContext()` | ✅ | Production: Cloudflare Access injects a verified `cf-access-jwt-assertion` header, parsed without re-verification (Access already verified it). Portfolio/demo: a self-issued HS256 JWT via `/dev/token`, verified with WebCrypto. Both paths produce an identical `UserContext` shape — everything downstream is auth-path-agnostic. |
| SEC-02 | Execution-Time Authorization | **C** | Role re-check inside `kbSearch` | ✅ | Same mechanism as RAG-01/MTN-01 — RBAC is enforced at the point of data access, not trusted from the router or the model. |
| SEC-03 | Defense-in-Depth Against Leakage | **C** | 3 independent layers | ✅ | Namespace access map (type layer) → tool-execution re-check → Vectorize metadata filter (query layer). A bug in any one layer doesn't compromise the others for the specific failure mode of cross-tenant/role data leakage. |
| SEC-04 | Fail-Safe Availability | **C** ⚠️ | Removed a global auth guard | ✅ | **This is the sharpest finding in this entire matrix.** A global `app.use("*", ...)` Cloudflare Access guard, added to protect new admin routes, was scoped to the entire application (only `/health` and `/cdn-cgi/*` exempted) — meaning the public chat UI, `/dev/token`, and every `/api/v1/*` route returned a bare 401 to any real visitor from the moment it deployed (2026-07-01) until found and fixed (2026-07-07): **5 days of full public-demo downtime, self-inflicted by a security control, undetected by either automated regression probe** because both carried a workaround header specifically built to route around that exact check. Also turned out to be pure redundancy — every route it might have protected already had independent auth (SEC-01, SEC-02). Removed; verified live (chat UI, dev-token flow, and a full agent round-trip all succeed with zero special headers) and confirmed both regression probes still pass, proving nothing legitimate depended on the guard. **Rated C, not NC, because the system is fixed and verified as of this writing** — but the honest RFP answer names the incident, not just the resolution, because the failure mode (a security control silently breaking availability, invisible to tests built around it) is a real enterprise risk pattern, not unique to this lab. |
| SEC-05 | Abuse Prevention | **PC** | KV sliding-window rate limiter | ⚠️ | Role-based limits (20-50 req/min) enforced via `checkRateLimit()`, rejected before reaching a Durable Object. Works correctly under normal sequential load. **See OBS-06:** breaks down under true concurrent bursts due to a KV read-then-write race — rated PC rather than C because the stated guarantee ("N requests per minute") does not reliably hold under the exact conditions (burst traffic) it exists to protect against. |

---

**Summary**

| Category | Total | C | PC | NC |
|---|---|---|---|---|
| Multi-Tenancy & Isolation (MTN) | 5 | 5 | 0 | 0 |
| RAG & Knowledge Grounding (RAG) | 6 | 4 | 1 | 1 |
| Evaluation & QA (EVAL) | 5 | 4 | 0 | 1 |
| Observability & Reliability (OBS) | 6 | 4 | 0 | 2 |
| AI Gateway & Governance (GTW) | 6 | 3 | 0 | 3 |
| Security & Access Control (SEC) | 5 | 4 | 1 | 0 |
| **Total** | **33** | **24 (73%)** | **2 (6%)** | **7 (21%)** |

**Key gaps for future cycles:**
- Reranking (RAG-06) and an independent judge model (EVAL-05) — both named, both Cycle 2 candidates already in `BACKLOG.md`.
- Gateway-level rate limiting (GTW-04) and content safety/DLP (GTW-05) — GTW-05 was actively attempted this session and blocked by API token scope, not skipped.
- Concurrency-safe rate limiting (OBS-06 / SEC-05) — a real bug found this session, explicitly scoped for Cycle 1 Week 4.
- Zero Data Retention (GTW-06) — not yet evaluated as a requirement for this system's actual sensitivity level.

**What this matrix proves that a slide deck can't:** every "C" rating above traces to a specific file, a specific live API response, or a specific probe output captured during this engagement — including two ratings (OBS-05, SEC-04) that were genuinely **NC as of this morning** and are now C because they were found and fixed today, not assumed compliant from the start.

---

*This response matrix was built against `se-intel` as deployed at the time of writing (2026-07-08). Live API checks (AI Gateway config) were run read-only against the actual Cloudflare account — not simulated.*
