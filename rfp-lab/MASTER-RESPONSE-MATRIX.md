# Master Response Matrix — Cross-Pillar Capability Map
> **Purpose:** Living reference mapping every unique Cloudflare capability across all four pillars. Updated as each RFP exercise is completed.

---

## How to Read This

- **Pillar:** Which RFP exercise proved this capability
- **Status:** C (Compliant), PC (Partially Compliant), NC (Non-Compliant)
- **Lab Proof:** ✅ = configured and tested in personal lab | ❌ = gap
- **Honest Limitation:** What the customer needs to know that the marketing page doesn't say

---

## Pillar 1: Zero Trust / Cloudflare One

| Capability | Product | Status | Lab | Honest Limitation |
|---|---|---|---|---|
| Per-app identity-aware access | Access | C | ✅ | — |
| Multi-IdP support (SAML/OIDC) | Access | C | ✅ | — |
| Device posture enforcement | WARP + Posture Checks | C | ✅ | Windows: posture check diagnostics via dashboard only, no `warp-cli posture list` on Windows |
| Clientless browser access (no agent) | Access | C | ✅ | No device posture without WARP — trade-off for BYOD convenience |
| Outbound-only tunnel (no inbound ports) | Tunnel (cloudflared) | C | ✅ | — |
| Origin IP obfuscation | Tunnel + Cloudflare Proxy | C | ✅ | — |
| Gateway DNS filtering | Gateway DNS | C | ✅ | IPv4 block propagation can lag behind IPv6 (observed in lab — high upstream TTL) |
| Gateway HTTP filtering (TLS inspected) | Gateway HTTP | C | ✅ | Requires root CA on device. Public docs URL served expired cert — had to get from dashboard |
| Do Not Inspect exceptions | Gateway HTTP | C | ✅ | Enterprise-specific list — requires log-only discovery phase per deployment |
| DLP inline (in-transit) | Gateway HTTP + DLP | C | ✅ | Cannot inspect encrypted archives. No quarantine/coach action. |
| DLP at-rest (SaaS scanning) | CASB + DLP | C | ✅ | API-based, periodic (not real-time). Google Workspace needs Workspace admin. |
| CASB posture findings | CASB | C | ✅ | GitHub only in lab (personal Gmail not a Workspace admin) |
| Browser Isolation (WARP-based) | RBI | C | ✅ | 50-150ms added latency. Video streaming in isolation is poor. |
| Browser Isolation (clientless) | RBI | C | ✅ | — |
| EDR integration (CrowdStrike ZTA) | Posture Checks | C | ❌ | Requires CrowdStrike installed — cannot demo without EDR license |
| Malware sandboxing / detonation | Gateway HTTP | PC | ❌ | Static analysis + AV, not behavioral sandbox. Less mature than Zscaler/Palo Alto. |
| China Mainland PoP | CN Network (JD Cloud) | PC | ❌ | Separate contract required. Not auto-included. Cannot demo. |
| DLP quarantine action | DLP | PC | ✅ | No native quarantine. Block + payload logging is the workaround. |
| DLP OCR | DLP | C | ❌ | Feature exists, not yet tested in lab |
| Exact Data Match (EDM) | DLP | C | ❌ | Enterprise plan feature, not tested in lab |

---

## Pillar 1: AI Gateway (Sub-section of Zero Trust)

| Capability | Product | Status | Lab | Honest Limitation |
|---|---|---|---|---|
| AI Gateway authentication | AI Gateway | C | ✅ | `se-intel-gateway` live. All SE Intel Workers AI calls route through gateway. Token-based auth confirmed. |
| Provider abstraction | AI Gateway | C | ✅ | App calls one gateway endpoint. Provider is a config — not baked into app code. |
| Provider routing + fallback | AI Gateway | C | ✅ | Dynamic Routes configured. Metadata fields (`user_role`, `org_id`, `call_type`) available for routing decisions. |
| Usage quotas / rate limiting | AI Gateway | C | ✅ | Rate limits configurable per gateway binding. |
| Prompt/response logging | AI Gateway | C | ✅ | 6 log entries from one SE Intel session: model, tokens (in/out), cost, latency, user metadata. |
| Prompt inspection (pre-submission) | AI Gateway + Workers | PC | ❌ | No native semantic inspection. Keyword/regex via custom Workers only. |
| Response inspection | AI Gateway + Workers | PC | ❌ | Same — custom Workers, not native. |
| PII redaction in prompts | Workers + DLP | PC | ❌ | Custom implementation, not a native toggle. |
| Budget controls per team | AI Gateway | PC | ✅ | **Corrected 2026-07-08 — was previously rated C.** Metadata-based routing (`user_role`, `org_id`, `call_type`) enables per-team *attribution*, confirmed live. But per-team *enforcement* would require gateway-level rate limiting, and a live API check on 2026-07-08 (Pillar 4 exercise) confirmed `rate_limiting_limit: 0` on `se-intel-gateway` — not configured. Attribution without enforcement is visibility, not control. See Pillar 4 GTW-04. |
| Spend visibility | AI Gateway Analytics | C | ✅ | Cost per request visible in dashboard. ~$0.003/SE Intel query. Per-model breakdown. |
| Anomalous usage alerting | AI Gateway + Workers | PC | ❌ | No native alert — requires custom Workers monitoring. |

---

## Pillar 1: Application Security (Overlapping)

| Capability | Product | Status | Lab | Honest Limitation |
|---|---|---|---|---|
| WAF managed rules (OWASP CRS) | WAF | C | ✅ | SQLi, RCE, XSS, sqlmap UA — all 403. CF-RAY `a13eb88a4b58fce9-AUS-DOG` in Security Events with matched rule + WAF Attack Score. |
| WAF ML (Attack Score) | WAF Attack Score | C | ✅ | Multi-vector attack scored and blocked. Attack Score visible in Security Events. |
| mTLS on API routes | mTLS + API Shield | C | ✅ | WAF rule on `/api/*` enforcing `cf.tls_client_auth.cert_verified`. 403 without cert. Client cert issued from Cloudflare Managed CA (expires Jun 2036). BYO CA option visible in dashboard. |
| API schema validation | API Shield | C | ✅ | OpenAPI spec uploaded (`se-intel-api`, schema ID `ac61fc89`). Enforcement on `retail.macksportreport.com`: wrong type/missing fields/undocumented endpoint → all 403. |
| Bot Management | Bot Management | C | ✅ | sqlmap user agent → 403. Bot score visible in Security Events. |
| Advanced Rate Limiting (per key) | Rate Limiting | C | ✅ | Rule keyed on `x-api-key` header. Requests 1-5 → 200, request 6 → 429. Per-key isolation confirmed. |
| Sequence Rules | Sequence Rules | C | ❌ | Not configured in lab |
| Page Shield (client-side security) | Page Shield | C | ❌ | Not relevant to this RFP but exists |

---

## Pillar 1: Observability

| Capability | Product | Status | Lab | Honest Limitation |
|---|---|---|---|---|
| SIEM log export | Logpush | C | ❌ | Not configured. JSON format only (no CEF/LEEF). |
| Near-real-time log delivery | Logpush | PC | ❌ | No contractual SLA on delivery latency. Typically 1-5 min. |
| Guaranteed log delivery | Logpush | PC | ❌ | Retry logic exists but no zero-loss guarantee. |
| Instant Logs (real-time stream) | Instant Logs | C | ❌ | Session-based, not persistent. |
| Log Explorer (native SQL query) | Log Explorer | C | ❌ | Requires R2 storage. Not yet tested. |
| Custom dashboards | Log Explorer | C | ❌ | — |

---

## Pillar 2: Application Security + CDN (Not Yet Started)

*To be populated when Pillar 2 RFP exercise begins.*

---

## Pillar 3: Developer Platform (Not Yet Started)

*To be populated when Pillar 3 RFP exercise begins.*

---

## Pillar 4: AI (Started 2026-07-08 — self-constructed RFP, SE Intel as proof of work)

Full detail in `004-ai/RFP-SUMMARY.md` and `004-ai/RESPONSE-MATRIX.md`. Summary:

| Capability Area | Status | Lab | Honest Limitation |
|---|---|---|---|
| Multi-tenant RAG/memory/audit isolation | C | ✅ | 3 deterministic probes, 0 cross-org leaks. One probe (`isolation-test.sh`) silently broke on 07-06 from an unrelated auth change — fixed, but flags that probes need re-verification after any auth-layer change. |
| Role-gated retrieval + relevance thresholding | C | ✅ | `ROLE_KB_ACCESS` map + `MIN_SCORE: 0.5`, re-checked at tool execution time. |
| Generation faithfulness | PC | ✅ | Prompt-level GROUNDING RULE fixed a real flaky case, but faithfulness enforcement is still probabilistic — the deterministic check catches violations after the fact, it doesn't prevent them. |
| Reranking | NC | ❌ | Not built — raw cosine top-K only. |
| Deterministic eval CI gate | C | ✅ | `faithfulness.py --ci` — caught a real bug an LLM judge missed. Can't be masked by the failure mode it hunts. |
| Independent eval judge | NC | ❌ | Agent and judge share the same model — documented self-grading bias. |
| Calibrated SLOs + health scorecard | C | ✅ | Recalibrated against real measured p95 (13118ms), not an aspirational guess. |
| Accurate failure-status tracking | C (was NC that morning) | ✅ | `writeMetric()` couldn't record failures until fixed same-day, 2026-07-08. |
| Concurrency-safe rate limiting | NC | ❌ | Real lost-update race found under 25-request burst — scoped for Cycle 1 Week 4. |
| AI Gateway routing + usage attribution | C | ✅ | `se-intel-gateway` live, all 4 model-call sites routed, verified via live API. |
| Gateway-level rate limiting | NC | ❌ | Confirmed via live API: `rate_limiting_limit: 0`. |
| PII/content-safety controls (DLP) | NC | ❌ | Confirmed via live API: DLP enabled, zero policies. Attempted to close, blocked by API token scope — not skipped. |
| Fail-safe security middleware | C (was a 5-day outage) | ✅ | A global auth guard silently blocked the entire public demo for 5 days, undetected by tests built around it. Found and fixed 2026-07-08, verified live. |

**Coverage: 24/33 requirements Compliant (73%), 2 Partially Compliant (6%), 7 Non-Compliant/gap (21%).** Two of the Compliant ratings above (failure-status tracking, fail-safe middleware) were genuinely Non-Compliant the same morning this matrix was written — the gap-finding happened live, during the exercise, not before it.

---

## Cross-Pillar Summary

| Pillar | Total Capabilities | C | PC | NC | Lab ✅ | Lab ❌ |
|---|---|---|---|---|---|---|
| 1 — Zero Trust | 51 | 38 | 13 | 0 | 43 | 8 |
| 2 — App Sec + CDN | — | — | — | — | — | — |
| 3 — Dev Platform | — | — | — | — | — | — |
| 4 — AI | 33 | 24 | 2 | 7 | 24 | 9 |

*Pillar 1's C/PC split updated 2026-07-08 to reflect the "Budget controls per team" correction above (was miscounted as C, corrected to PC).*

**Pillar 1 remaining gaps (8):** SWG-03 (malware sandbox — no detonation engine), LLM-SG-09/10/11/12/15 (prompt/response inspection + PII redaction + anomalous usage alerting — all require custom Workers), CO-08 (China mainland — requires separate enterprise contract).

---

*Last updated: 2026-06-30*
