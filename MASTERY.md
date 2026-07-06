# MASTERY — Daily Command Center

> **Open this file every morning.** It tells you exactly what today is.
> **Goal:** Become an expert in scalable, distributed AI systems → land an Applied AI Architect role (Anthropic / OpenAI).
> **Flagship:** `se-intel` (`ai-dev/projects/se-intel`) — the one system you harden continuously.
> **This is continuous.** There is no end date. Cycles get harder. Expertise compounds.

---

## ☀️ TODAY — 2026-07-06 (Monday)

```
TRACK:   AI-dev close-out, then RFP/curriculum for the rest of the week
STATUS:  Week 3 is now FULLY CLOSED:
           ✓ Sanity probes re-verified (4/4 health, 3/3 isolation)
           ✓ COMPREHEND done (5 questions — see Progress Log below for grading notes)
           ✓ STUDY.md Chapter 12 (Observability) written
           ✓ THEORY-LOG.md entry logged (SLO calibration + a test-drift finding)
           ✓ NARRATE published — project page updated with Cycle 1 Weeks 1-3 summary
           ✓ All outstanding code/docs committed (4 commits: Week 2, Week 3,
             isolation-test.sh drift fix, this doc set)

TODAY:   Week 3 close-out is done. Per the scheduling model below, the rest of
         this week is RFP/curriculum. Options:
           (A) RFP 002 lab — Enterprise Tech RFP exists at
               rfp-lab/001-zero-trust-sase/RFP-002-ENTERPRISE-TECH.md
           (B) Zero Trust demo practice — run DEMO-SCRIPT.md cold 3x
               against the dashboard, time yourself
           (C) Curriculum gap — any phase you haven't studied recently

NEXT AI-DEV WEEK (2026-07-14): Cycle 1 / Week 4 — Failure under load
         (fallback injection, DO contention handling).
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

### Current week type
- **Week of 2026-06-30:** AI-dev — Week 3 shipped AND fully closed (2026-07-06)
- **Week of 2026-07-07:** RFP/curriculum → target: RFP 002 lab or demo practice
- **Week of 2026-07-14:** AI-dev → target: Cycle 1 / Week 4 — Failure under load

### Why this ratio
Your day job makes you excellent through repetition — 7-10 calls/week is already doing that work.
The side project makes you hireable for the next role. At 5-8 hrs/week, protect that time.
The risk isn't neglecting calls. The risk is the side project time gets absorbed by RFP studying
that your day job already covers, and the AI portfolio never gets far enough to matter.

### When you ask "what are we doing today" — the AI checks:
1. Is there an open MASTERY week not fully closed? → finish that first (it's blocking Week 4)
2. Which week type is it (A or B)? → AI-dev or RFP accordingly
3. Is there a real customer call/RFP with urgency? → drop everything, prep that
4. Are both tracks current? → your choice, AI suggests highest-leverage option

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
