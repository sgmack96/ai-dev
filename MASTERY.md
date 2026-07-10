# MASTERY — Daily Command Center

> **Open this file every morning.** It tells you exactly what today is.
> **Goal — dual-track, not sequential:**
> 1. **Present:** Excel as a Cloudflare Solutions Engineer today — President's Club performance, deep platform mastery.
> 2. **Future:** Build continuous, compounding proof toward Applied AI Architect / Solutions Engineer / Forward Deployed Engineer roles — Anthropic, OpenAI, and the wider company list in `README.md` Tier 2.
>
> These aren't competing tracks. `se-intel` and the RFP lab are deliberately built to double as day-job-relevant proof (Cloudflare's own Dev Platform → AI Gateway → Zero Trust motion) and external portfolio evidence at the same time — see `internal/cf-digital-native-strategy.md` (gitignored, local-only) for the day-job mapping. The 5-8 hrs/week budget only works *because* the work serves both goals at once, not despite it.
> **Flagship:** `se-intel` (`ai-dev/projects/se-intel`) — the one system you harden continuously.
> **This is continuous.** There is no end date. Cycles get harder. Expertise compounds.

---

## ☀️ TODAY — 2026-07-10 (Friday)

```
TRACK:   RFP/curriculum week, last day before Cycle 1 / Week 4 (07-14).
STATUS:  Ran the Zero Trust DEMO-SCRIPT.md rehearsal cold (closed, notes after
         each section) — timing was good. Graded Act 5 (Traffic Policies:
         Gateway + DLP) against the actual script: 1/3 solid, 2/3 had real
         gaps (a factual mix-up between AI Gateway's DLP and Gateway HTTP's
         TLS-inspection mechanism, muddled reasoning on why DNS-layer blocking
         matters, missed 2 of 5 DLP false-positive mitigations). Good signal
         that rehearsal surfaces real gaps even when it "feels good."
         Built rfp-lab/002-app-sec-cdn/002-b-realtime-streaming-cni/ — a new,
         fully fictional win-wire scenario (WHAT-CHANGED, CUSTOMER-STORY,
         WIN-WIRE) covering Cloudflare Network Interconnect (CNI) + real-time
         video/WebRTC ingestion + Load Balancer expansion. First upsell/
         renewal-type story in the lab (001-a, 002-a, 003-a are all net-new
         displacement); first CNI coverage; sets up an explicit AI Gateway
         forward-hook. Built after two earlier drafts (pasted directly into
         this session) turned out to still be identifiable despite real
         anonymization effort — declined both and rebuilt from scratch as a
         pure invention instead, per AGENTS.md's data handling rules.

TODAY:   Scenario built. Remaining before Week 4 starts Monday: RFP-002's own
         missing scenario subfolder (still open, lower priority), and the
         GTW-04 rate-limiting decision (still needs your call on values).
```

---

## ☀️ TODAY — 2026-07-08 (Wednesday)

```
TRACK:   RFP/curriculum week (per schedule) — started Pillar 4 (AI) of rfp-lab,
         using se-intel as the proof of work.
STATUS:  Pillar 4 was previously "Not Yet Started" in MASTER-RESPONSE-MATRIX.md.
         Built today:
           ✓ rfp-lab/004-ai/RFP-SUMMARY.md — 33-requirement self-constructed
             mock RFP ("AI Infrastructure for Enterprise Sales Teams")
           ✓ rfp-lab/004-ai/RESPONSE-MATRIX.md — answered all 33 against the
             live se-intel system. 24 C (73%), 2 PC (6%), 7 NC (21%).
           ✓ rfp-lab/004-ai/PORTFOLIO-NOTE.md — portfolio/LinkedIn-safe summary
           ✓ Updated USE-CASE-NOTES.md — 2 of 5 original gaps closed (AI
             Gateway, formal SLOs), PII redaction attempt honestly documented
             as blocked by API token scope, not skipped
           ✓ Corrected a real inconsistency found in Pillar 1's existing AI
             Gateway section — "Budget controls per team" was rated C citing
             rate limits that a live API check confirmed aren't configured
             (rate_limiting_limit: 0). Fixed to PC.
           ✓ Updated MASTER-RESPONSE-MATRIX.md Cross-Pillar Summary
         Two ratings in the new matrix (failure-status tracking, fail-safe
         middleware) were genuinely non-compliant the same morning this was
         written — both are 07-07's live bug fixes, cited as proof rather
         than hidden.

TODAY:   Pillar 4 first pass is done. Remaining for this RFP/curriculum week:
           (A) RFP-002 scenario subfolder (WHAT-CHANGED/CUSTOMER-STORY/
               WIN-WIRE) — RFP-001 has one, RFP-002 doesn't yet
           (B) Zero Trust demo practice — DEMO-SCRIPT.md cold reps
           (C) Attempt to close a Pillar 4 gap for real if time allows —
               gateway-level rate limiting is the most tractable (dashboard
               config, no code); PII/DLP needs a broader-scoped API token

NEXT AI-DEV WEEK (2026-07-14): Cycle 1 / Week 4 — Failure under load
         (fallback injection via a debug-toggle mechanism, DO contention
         handling — including the KV rate-limiter race found 07-07, now
         also documented in rfp-lab/004-ai as OBS-06/SEC-05).
```

---

## ☀️ TODAY — 2026-07-07 (Tuesday)

```
TRACK:   AI-dev — one small standalone patch (not a full Week 4 start),
         then RFP/curriculum for the rest of the week as scheduled.
STATUS:  Week 3 close-out (07-06) is done. Today's patch found TWO live bugs,
         both fixed and verified against the deployed worker:
           ✓ writeMetric() status hardcoded to "success" — error-rate SLO
             could never detect a failure. Fixed on both chat + stream paths,
             plus added a missing rate_limited write in index.ts's rate-limit
             middleware. Verified live: forced a 429, confirmed the
             rate_limited row landed in request_metrics.
           ✓ EMERGENCY: a global Access-JWT guard added in Week 3 had been
             returning bare 401s to every real visitor (chat UI, /dev/token,
             all /api/v1/*) since the 07-01 deploy — 5 days undetected because
             both regression probes carry a workaround header that routed
             around this exact check. Removed the guard (it was also pure
             redundancy — /admin/* and /api/* both already have independent
             auth). Verified live: chat UI loads, full agent round-trip
             succeeds with zero special headers, both probes still 4/4 + 3/3.
           ✓ Found but deliberately NOT fixed: the KV rate-limiter loses most
             of its count under true concurrency (25 near-simultaneous
             requests left the counter at 10, not ~20) — this is real Week 4
             material (DO contention handling), logged for 07-14, not patched
             today.
         See CYCLE-1-WEEK-3-observability-slos.md postscript + THEORY-LOG.md
         2026-07-07 entry for full detail.

TODAY:   Patch is done and deployed. Rest of this week is RFP/curriculum per
         the schedule. Options:
           (A) RFP 002 lab — Enterprise Tech RFP exists at
               rfp-lab/001-zero-trust-sase/RFP-002-ENTERPRISE-TECH.md
           (B) Zero Trust demo practice — run DEMO-SCRIPT.md cold 3x
               against the dashboard, time yourself
           (C) Curriculum gap — any phase you haven't studied recently

NEXT AI-DEV WEEK (2026-07-14): Cycle 1 / Week 4 — Failure under load
         (fallback injection via a debug-toggle mechanism, DO contention
         handling — including the KV rate-limiter race found today).
```

> **▶ Sanity re-check on reopen:**
> ```sh
> cd ~/ai-dev/projects/se-intel/evaluation-harness
> ./tests/health-probe.sh    # should print 4/4 PASS
> ./tests/isolation-test.sh  # should print 3/3 PASS
> ```

---

## Scheduling Model

### Your time budget
| Activity | Hours/week |
|---|---|
| Customer calls | 7-10 |
| Call prep | ~5 |
| **Side project available** | **~5-8 hours** |

### The rule: alternate full weeks, not daily splits
At 5-8 hrs/week, context-switching between tracks in the same session costs more than it saves.
Go deep on one thing per week.

```
Week A  →  AI-dev primary   (close the open MASTERY week, build next one)
Week B  →  RFP/curriculum   (one new RFP lab, or demo practice reps)
Week A  →  AI-dev primary
...
```

**Exception:** Real customer RFP or urgent call prep → drop everything, do that first. Job comes first.

**Non-exception — dual-purpose work doesn't cost a context switch.** Some work serves both
tracks from the same context, not by switching between them. Cycle 1 / Week 3's observability
work is Cloudflare AI Gateway usage in production — direct day-job platform depth, not a
detour from it. `rfp-lab/004-ai` (Pillar 4) is an RFP-curriculum deliverable built entirely
around `se-intel` — RFP/curriculum-week work that *is* AI-dev-week work, not competing with
it. When a task is genuinely dual-purpose like this, do it regardless of which week type it
technically is — the alternation rule exists to prevent switching between *unrelated*
contexts, not to block picking up free leverage when both tracks point at the same thing.

### Current week type
- **Week of 2026-06-30:** AI-dev — Week 3 shipped AND fully closed (2026-07-06)
- **Week of 2026-07-07:** RFP/curriculum → target: RFP 002 lab or demo practice (Pillar 4 of
  the RFP lab, built 07-08, counts as dual-purpose per above — genuine RFP-curriculum output
  that also deepened `se-intel` documentation)
- **Week of 2026-07-14:** AI-dev → target: Cycle 1 / Week 4 — Failure under load

### Why this ratio
The day job and the portfolio are not competing claims on the same 5-8 hours — they're
increasingly the same claim, viewed from two angles. Per the Goal statement above and
`internal/cf-digital-native-strategy.md` (gitignored, local-only): `se-intel`'s stack
(Workers, Workers AI, AI Gateway, Vectorize) mirrors the actual land-and-expand motion for
the day-job segment, so platform depth built here is depth that shows up in calls, not just
in interviews. The remaining real risk isn't "day job vs. portfolio" — it's the side project
budget quietly getting absorbed by RFP studying that's *actually already covered* by day-job
repetition (7-10 calls/week), which is genuinely single-purpose time, not dual-purpose. The
distinction that matters: RFP-lab work built *around* `se-intel` (like Pillar 4) is
dual-purpose and worth prioritizing; RFP-lab work that's pure day-job repetition (e.g., a
new product's requirement matrix with no AI/portfolio angle) is single-purpose and should
stay bounded to its own protected time, not bleed into the AI-dev budget.

### When you ask "what are we doing today" — the AI checks:
1. Is there an open MASTERY week not fully closed? → finish that first (it's blocking Week 4)
2. Is there a dual-purpose option available (RFP-lab work built around `se-intel`, or `se-intel` work that's also real day-job platform depth)? → prioritize it regardless of week type — it's free leverage, not a context switch
3. Otherwise, which week type is it (A or B)? → AI-dev or RFP accordingly
4. Is there a real customer call/RFP with urgency? → drop everything, prep that
5. Are both tracks current? → your choice, AI suggests highest-leverage option

---

## Working Agreement (how I use the AI)

- AI is the junior who types. **I'm the architect who decides and is accountable.**
- Per target: (1) AI explains gap + options → (2) **I choose + justify** → (3) AI builds → (4) **I explain it back** in the theory-log "explain to a customer" field.
- The AI must **NOT** build until I've made the call in step 2. Step 4 is non-negotiable.
- Proof I learned: I can defend it cold, chat closed.

---

## The Engine (never changes)

```
Build target → pulls 1 canonical read + 1 STUDY.md chapter
     │                    │
     │             Theory block → logged in theory-log template
     │                    │
     └─ the tradeoff I made ─┴─→ Narrate (build-digest) → publish.sh → portfolio → LinkedIn
```

**The one rule that prevents sprawl:** No new top-level project until the current week's target ships *and* publishes. New ideas go in `BACKLOG.md`, never a new folder.

---

## CYCLE 1 — Production Hardening

Outcome: you can defend a real production agent system cold.

| Wk | Build target | Theory pulled | Publishes | Interview Q it answers |
|----|--------------|---------------|-----------|------------------------|
| 1  | **Multi-tenancy** — org isolation on RAG/memory/audit | Anthropic *Building Effective Agents* + tenancy/isolation; STUDY ch.2–3 | blog #1 | "How do you keep customer data isolated?" |
| 2  | **Evals as a CI gate** — block deploy on quality drop | Chip Huyen evals chapter; STUDY ch.8 | blog #2 | "How do you measure LLM quality?" |
| 3  | **Observability + SLOs + account-health scorecard** | SLOs / error budgets; STUDY ch.10 | project page update | "How do you track adoption & health?" |
| 4  | **Failure under load** — fallback injection, DO contention | idempotency, graceful degradation; STUDY ch.4,7 | blog #3 | "What happens when a model provider fails?" |
| 5  | **Orchestration** — Workflows/Queues for a long multi-step agent job | durable execution vs queues; CF Workflows docs | blog #4 | "How do agents run long tasks reliably?" |
| 6  | **Fine-tune-vs-RAG note + Cloudflare-positioning architecture doc** | fine-tune vs RAG vs prompt; CF AI stack map | capstone page | "Where does each tool fit?" |

---

## CYCLE 2 — Distributed-Systems Depth & Scale

Where "expert" separates from "competent." (Unlock after Cycle 1 ships.)

- Retrieval at scale: chunking strategy, **reranking, hybrid search, recall@k eval**
- Consistency across Durable Objects + KV + D1; data locality / multi-region
- Orchestration graphs: planner–executor / supervisor patterns on Workflows
- Semantic caching on AI Gateway; load test + capacity + cost model at 10k→100k req

## CYCLE 3 — Frontier, Breadth & Safety

The Applied AI Architect signature. (Unlock after Cycle 2 ships.)

- **"AI disaster recovery" failover layer** — OpenAI↔Anthropic↔Workers AI portability abstraction (your own June-12 digest insight, built)
- Safety/guardrails for real: prompt-injection defense, PII redaction, jailbreak testing
- **Do one fine-tune/LoRA for real** on a small model — kills the PhD fear with a hands-on story
- **One deliberate non-Cloudflare build** (Bedrock or Vertex comparison) — proves you're a *generalist* architect, not CF-only

---

## Source Stack (where theory comes from)

- **Layer 0 — Your own system:** `projects/se-intel/STUDY.md` (11 chapters, interview Q&A). One chapter per Theory block, underneath everything.
- **Layer 1 — Canonical (finite, not infinite tutorials):** Anthropic *Building Effective Agents*; Chip Huyen *AI Engineering*; your existing `ai-lab/` notes (ReAct, Ng's 4 patterns, routing) are reference.
- **Layer 2 — Cloudflare-AI positioning:** where Workers AI / AI Gateway / Vectorize / Durable Objects / Workflows / AutoRAG fit vs OpenAI / Anthropic / Bedrock. Your "Cloudflare lens" digest habit, formalized.

---

## Progress Log  *(append one line per day — your streak)*

- 2026-06-15 — Set up command center + templates. Cycle 1 / Week 1 begins.
- 2026-06-15 — Day 1 ✅ Threaded `orgId` end-to-end into `ToolCall` audit shape (types + 3 tools + agent call-sites), tsc green. Findings: audit-write already had org_id (shrinks Day 4 → scoped read only); RAG shares chunks across orgs (Day 2 = metadata filter + re-seed). Reshaped daily blocks → DIRECT/COMPREHEND/VERIFY/THEORY/NARRATE + Working Agreement. Day 1 DIRECT/COMPREHEND/VERIFY done under new model. THEORY + NARRATE done & published. **Day 1 fully complete.**
- 2026-06-16 — Day 2 ✅ FULLY COMPLETE. RAG isolation shipped + THEORY (STUDY.md ch.2, two-layer isolation model) + NARRATE published (the LLM-hallucination-masked-the-test story). Key insight: LLM is not a reliable test oracle — deterministic probe required.
- 2026-06-17 — Day 3 ✅ FULLY COMPLETE. Memory isolation shipped — DO keys scoped to `orgId:userId` (7 sites), LTM KV keys scoped to `ltm:{orgId}:{userId}:{factId}` (5 sites), `/admin/memory-probe` proves `isolationOk: true`. THEORY (STUDY.md ch.3, auth + Zero Trust layering) + NARRATE published. Key insight: the claim existed without the enforcement — `orgId` was in the JWT since Day 1 but wasn't in the storage layer until Day 3.
- 2026-06-18 — Day 4 ✅ FULLY COMPLETE. Audit isolation shipped — `GET /api/v1/audit` (user-accessible, org-scoped, role-split: manager sees org, individual sees own), `/admin/audit-probe` proves `isolationOk: true`, `crossOrgLeaked: 0`. All 3 probes pass (KB + memory + audit). THEORY (STUDY.md ch.4, rate limiter + consistency tradeoffs) + NARRATE published. Key insight: the schema was right from Day 1 — the gap was the read path, not the write path.
- 2026-06-18 — Day 5 ✅ WEEK 1 COMPLETE. `isolation-test.sh` 3/3 pass. Blog #1 published (240 lines, "Multi-Tenant Isolation in an Edge AI System"). THEORY (STUDY.md ch.5, RAG pipeline + eager tool calling + faithfulness gap). Definition of Done: all 4 criteria met. Week 2 begins: Evals as a CI gate.
- 2026-06-22 — Week 2 BUILD ✅ Faithfulness eval + CI gate shipped. (1) API: `?debug=true` returns `retrievedChunks` (lean in prod) — threaded debugMode through index.ts → base-agent → kbSearch, captures exactly the chunks injected (no duplicate query). (2) `faithfulness.py` — deterministic string-grounding check, no LLM: `grounded` facts (retrieved+in response) and `forbidden` facts (cross-org/hallucination). Distinguishes grounding_fail (retrieved-but-dropped = THE bug) from retrieval_fail (not retrieved). (3) judge.py 5th dimension (faithfulness), 12→15pt scale, threshold 8→10, judge now sees retrieved chunks. (4) 4-step run_eval.sh with `--ci` fail-fast gate. (5) `cases/faithfulness.json` 5 cases incl. fth-005 cross-org (acme's 35% must NOT leak to portfolio-org at generation layer — ties Week 1 isolation to Week 2 faithfulness). FINDINGS: harness immediately caught a REAL flaky bug — fth-003 dropped the retrieved "WinterCG" fact ~50% of runs (LLM non-determinism). Fixed root cause via enablement GROUNDING RULE prompt (cite named facts verbatim); now 3/3 stable. Gate verified: exits 1 on grounding_fail, exits 0 clean.
- 2026-06-26 — Week 2 COMPLETE ✅ THEORY (Chip Huyen Ch.3-4 + STUDY ch.8) logged in THEORY-LOG.md. NARRATE: Blog #2 published ("How I Built a CI Gate for My AI Agent"). Definition of Done: all 7 criteria met. Week 3 begins: Observability + SLOs + Account-Health Scorecard.
- 2026-07-01 — Week 3 COMPLETE ✅ Observability + SLOs shipped. Key finding: initial 8000ms p95 SLO was wrong for 70B — real production data showed 11-13s. Recalibrated to 15000ms with documented rationale. `health-probe.sh` 4/4 passing (deterministic, no LLM). `/admin/health-scorecard` live — both orgs `status: healthy`. Deployed version `97e0b8a4`. Week 4 next: Failure under load — fallback injection, DO contention.
- 2026-07-06 — Week 3 CLOSED ✅ Full close-out ritual completed (build was done 07-01, close-out had been sitting open). Sanity probes re-run first: health-probe 4/4 passed clean; isolation-test.sh failed 3/3 (`isolationOk: null`) — real finding, not a regression: the global Access JWT guard added in the Week 3 code didn't get the same treatment in the older Week 1 script (health-probe.sh already had the workaround header, isolation-test.sh didn't). Fixed, re-verified 3/3. COMPREHEND: answered all 5 cold — 2/5 solid as-is (waitUntil rationale, audit_log vs request_metrics split), 3/5 right in shape but light on specifics (SLO numbers, the JS-percentile-not-SQL detail, the probe dependency-chain reasoning) — closed the gaps in STUDY.md ch.12 rather than re-quizzing. STUDY.md Chapter 12 written (Concept/What We Built/Why/Interview Qs, same house style as ch.1-11). THEORY-LOG entry logged: SLO-as-error-budget-precondition insight + the isolation-test.sh drift as its own "test rot" lesson. NARRATE: portfolio project page updated with a Cycle 1 (Weeks 1-3) summary section linking both live blog posts — lighter lift than a full blog, as scoped. Also cleared 3 weeks of uncommitted work into 4 scoped commits (Week 2 evals-CI-gate, Week 3 observability/SLOs, the isolation-test.sh fix, this doc set) — flagged one undocumented bundled change (AI Gateway per-call routing metadata across several files) in the commit body rather than silently attributing it to either week. Week 4 (Failure under load) deferred to the 2026-07-14 AI-dev week per the schedule; rest of this week is RFP/curriculum.
- 2026-07-07 — Small standalone patch (not Week 4 proper) ✅ Set out to fix one thing (writeMetric() hardcoded to "success") and found two live bugs. (1) Threaded real success/error status through both writeMetric() call sites in base-agent.ts; fixed the streaming path, which previously wrote NO audit event and NO metric at all on failure (worse than mislabeled — invisible); added a rate_limited write in index.ts's rate-limit middleware via c.executionCtx.waitUntil(). Verified live against D1: forced a real 429 by pre-seeding the KV counter, confirmed the rate_limited row landed with latency_ms:35. (2) While testing with a plain Bearer token, found the entire public demo (chat UI, /dev/token, all /api/v1/*) had been returning bare 401s to any real visitor since the Week 3 deploy on 07-01 — a global Access-JWT guard was scoped to the whole app instead of just the new admin routes, and neither health-probe.sh nor isolation-test.sh could ever have caught it because both carry a workaround header specifically built to route around that exact check. Also turned out to be pure redundancy (admin routes and /api/* both already have independent auth). Removed the guard, verified live: chat UI 200, full agent round-trip succeeds with zero special headers, both probes still 4/4 + 3/3. Deliberately did NOT fix a third finding (KV rate-limiter loses most of its count under true concurrency — 25 near-simultaneous requests left the counter at 10) — that's real Week 4 material, logged for 07-14. Documented all three in CYCLE-1-WEEK-3's postscript + a THEORY-LOG entry on the repeating "test workaround = blind spot" pattern (3rd instance in 4 days: isolation-test.sh drift → this auth outage → the rate-limiter race, all same root shape). Two commits, deployed twice, both live and verified. Separately: shared a Pragmatic Engineer article on Forward Deployed Engineers; rewrote README.md — retired the stale 30-day-sprint/golf-agent framing, updated Anthropic's 5 current role variants, and added a Tier 2 (FDE) section widening the target company list beyond Anthropic/OpenAI to Palantir, Ramp, Scale AI, Sierra AI, and others, per request.
- 2026-07-08 — Started rfp-lab Pillar 4 (AI) ✅ Was "Not Yet Started" in MASTER-RESPONSE-MATRIX.md; USE-CASE-NOTES.md already had a 4-step plan written but never executed. Built all 4 planned artifacts: RFP-SUMMARY.md (33-requirement self-constructed mock RFP, "AI Infrastructure for Enterprise Sales Teams"), RESPONSE-MATRIX.md (answered all 33 against the live se-intel system — 24 C/73%, 2 PC/6%, 7 NC/21%), PORTFOLIO-NOTE.md, and updated USE-CASE-NOTES.md's gap list (2 of the original 5 gaps were already closed by Cycle 1 Weeks 1-3 without anyone noticing — AI Gateway integration and formal SLOs). Attempted to close the PII-redaction gap for real (DLP is enabled on se-intel-gateway but has 0 policies) — blocked honestly by API token scope (Workers AI Edit only), documented as a real access-control blocker rather than skipped. Found and fixed a real inconsistency while cross-checking: Pillar 1's existing AI Gateway section rated "budget controls per team" as Compliant citing rate limits that a live API check proved aren't configured (rate_limiting_limit: 0) — corrected to Partially Compliant. Two ratings in the new Pillar 4 matrix (failure-status tracking, fail-safe middleware) are 07-07's bug fixes, cited as proof of the exercise catching real things, not hidden. Updated MASTER-RESPONSE-MATRIX.md's Cross-Pillar Summary. Remaining for this RFP week: RFP-002 scenario subfolder, Zero Trust demo reps, or attempt a tractable Pillar 4 gap (gateway-level rate limiting is dashboard-only, no code needed). Later same day: reframed MASTERY.md's Goal as dual-track (present — CF SE excellence/President's Club; future — Anthropic/OpenAI/FDE per README Tier 2), tied to internal/cf-digital-native-strategy.md's day-job mapping; named "dual-purpose work" as a non-exception to the weekly alternation rule. THEORY: read Cloudflare's actual AI Gateway Rate Limiting + DLP docs (the two features GTW-04/GTW-05 flagged as gaps) — found DLP is scoped per-gateway not per-request (conflicts with se-intel's single shared gateway across tenants — same shared-vs-per-tenant fork as Week 1's Vectorize decision, but with no metadata-filter middle ground this time) and DLP response-scanning buffers full responses (conflicts with the sub-100ms-TTFB streaming architecture in STUDY ch.7). Updated GTW-05's response with both blockers (access-control + architecture) and logged the full reasoning in THEORY-LOG.md.
- 2026-07-10 — Zero Trust rehearsal + new win-wire scenario ✅ Ran DEMO-SCRIPT.md cold (closed, post-section notes, good timing) — the rehearsal that had been deferred three sessions running finally happened. Graded Act 5 against the script: correctly extended the "shared DLP profiles across enforcement channels" principle from Gateway HTTP/CASB to AI Gateway (real cross-connection to 07-08's theory pull), but mixed up AI Gateway's DLP mechanism with Gateway HTTP's TLS-inspection mechanism, gave a muddled reason for DNS-layer blocking (said "exposes IP" instead of "no connection of any kind is ever attempted"), and named only 2 of the 5 DLP false-positive mitigations from memory (missed body-phase selector and Exact Data Match specifically). Real signal that "felt good" rehearsal still has gaps worth closing before saying this cold to a customer. Separately: attempted to find a real win-wire for a Digital Native/upsell scenario (the gap identified 07-09 — no upsell story in the lab, no Digital Native segment coverage). User pasted real Salesforce opportunity data, then a real internal account-notes document, twice, with increasing (but still insufficient) anonymization attempts — declined both: the first still had real ASNs and real employee full names despite a company-name swap; the second properly redacted names/IDs/regions but the surviving factual combination (industry + "10+ year customer" + "earliest SSL for SaaS adopter" + "own ASN" + verbatim quotes) was still a re-identifying fingerprint, and the document's internal CRM/process structure was its own separate concern per AGENTS.md. Built rfp-lab/002-app-sec-cdn/002-b-realtime-streaming-cni/ instead — fully invented from scratch (WHAT-CHANGED.md, CUSTOMER-STORY.md, WIN-WIRE.md), covering the same technical shape (WHIP/WebRTC ingestion hairpin routing + Cloudflare Network Interconnect as the fix, bundled Load Balancer expansion, AI Gateway forward-hook) with zero real specifics. First upsell-type and first CNI-covering scenario in the lab. Lesson for next time: true anonymization means writing a fresh summary from memory, not redacting tokens in the original — token redaction preserves the source's shape (quotes, structure, factual fingerprint) even when every name is gone.
