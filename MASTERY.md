# MASTERY — Daily Command Center

> **Open this file every morning.** It tells you exactly what today is.
> **Goal:** Become an expert in scalable, distributed AI systems → land an Applied AI Architect role (Anthropic / OpenAI).
> **Flagship:** `se-intel` (`ai-dev/projects/se-intel`) — the one system you harden continuously.
> **This is continuous.** There is no end date. Cycles get harder. Expertise compounds.

---

## ☀️ TODAY  — *(edit this line each morning)*

```
DATE:    2026-06-16  (update tomorrow)
CYCLE:   1  (Production Hardening)
WEEK:    1  (Multi-tenancy)  ·  DAY 2 build PROVEN — isolation confirmed via /admin/kb-probe
TASK:    ▶ Day 3 COMPLETE. START Day 4 — audit isolation: scoped read query on D1 audit_log,
         prove cross-org audit rows are inaccessible, THEORY (STUDY.md ch.4 — Rate Limiter),
         NARRATE in portfolio/src/content/digest/2026-06-18.md → publish.sh.
```

> **▶ Sanity re-check on reopen (should print `true` twice):**
> ```sh
> cd ~/ai-dev/projects/se-intel
> SECRET=$(grep '^JWT_SECRET=' .dev.vars | cut -d= -f2-)
> BASE=https://se-intel-portfolio.stephenmack96.workers.dev
> for ORG in acme portfolio-org; do
>   curl -sX POST $BASE/admin/kb-probe -H "Authorization: Bearer $SECRET" \
>     -H "Content-Type: application/json" \
>     -d "{\"query\":\"negotiated Cloudflare discount\",\"role\":\"se\",\"orgId\":\"$ORG\"}" | jq .isolationOk
> done
> ```

### The 5 phases (do every working day)

- [x] **DIRECT** — *(Day 2 ✅ — Option A: metadata filter, least privilege, "global" sentinel)*
- [x] **COMPREHEND** — *(Day 2 ✅ — filter at `kb-search.ts:94`, refactored `kbSearchRaw`; 3 Qs answered)*
- [x] **VERIFY** — *(Day 2 ✅ — `/admin/kb-probe` deterministic test: isolationOk=true both orgs, acme chunk filtered from portfolio-org. Isolation PROVEN. Secondary finding: LLM faithfulness gap → Week 2 evals.)*
- [x] **THEORY (60m+)** — STUDY.md ch.2 (Workers + DOs, two-layer isolation model) → `THEORY-LOG.md`. *(Day 2 ✅)*
- [x] **NARRATE (20–30m)** — `[BUILD]` in `../portfolio/src/content/digest/2026-06-16.md` published. *(Day 2 ✅)*

> *(Day 1 fully complete — see Progress Log.)*

> The point is NOT "ship code" — the AI does that in minutes. The point is **you can defend every decision cold.**
> Daily litmus test: explain today's change with this chat closed. If you can't, you skipped COMPREHEND.

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
- 2026-06-17 — Day 3 ✅ FULLY COMPLETE. Memory isolation shipped — DO keys scoped to `orgId:userId` (7 sites), LTM KV keys scoped to `ltm:{orgId}:{userId}:{factId}` (5 sites), `/admin/memory-probe` proves `isolationOk: true`. THEORY (STUDY.md ch.3, auth + Zero Trust layering) + NARRATE published. Key insight: the claim existed without the enforcement — `orgId` was in the JWT since Day 1 but wasn't in the storage layer until Day 3. Day 4 target: audit isolation (scoped read on D1).
