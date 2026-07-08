# Career Alignment: AI-Dev Portfolio → Industry AI Roles

> **Purpose:** Map every deliverable from the `ai-dev` portfolio to actual job requirements from target companies. This is a living document, not a fixed sprint output — it updates as the portfolio (flagship: `se-intel`) grows under the continuous Cycle model in `MASTERY.md`.
>
> **Two tiers of target:**
> - **Tier 1 — Anthropic / OpenAI.** The original, most-specific targets. Detailed requirement tables below, sourced from real screening questions and job descriptions.
> - **Tier 2 — Forward Deployed Engineer (FDE), wherever it's hired.** Anthropic and OpenAI were the starting point, not the ceiling. FDE is a fast-growing role category — pioneered by Palantir, now hired by OpenAI, Ramp, Scale AI, Sierra AI, Salesforce (Agentforce), and other AI-native companies — that overlaps heavily with what this portfolio already proves. See [Tier 2](#tier-2--forward-deployed-engineer-wherever-its-hired) below.
>
> **Last updated:** 2026-07-07

---

## Contents

1. [Tier 1 — Anthropic](#tier-1--anthropic)
2. [Tier 1 — OpenAI](#tier-1--openai)
3. [Tier 2 — Forward Deployed Engineer](#tier-2--forward-deployed-engineer-wherever-its-hired)
4. [Master Skills Heatmap](#master-skills-heatmap)
5. [Gap Fillers](#gap-fillers)
6. [Key Application Questions — Proof Kit](#key-application-questions--proof-kit)
7. [How to Use This Document](#how-to-use-this-document)

---

## Tier 1 — Anthropic

Five role variants currently tracked (per `AGENTS.md`):

- Applied AI Architect, Startups (SF/NYC)
- Applied AI Architect, Commercial (SF/NYC)
- Applied AI Architect, Industries (NYC/SF/Seattle)
- Applied AI Engineer (London)
- Applied AI Engineer, Enterprise Tech (SF/NYC/Seattle)

All five share a common core of technical and customer-facing requirements. Rather than five near-duplicate tables, here's the shared requirement set with portfolio evidence — variant-specific differences (industry focus, location) are noted inline.

### Technical requirements

| Requirement | Portfolio Evidence | Status |
|---|---|---|
| Production LLM apps deployed at scale | `se-intel` — 3 agents (AccountIntel, Enablement, Transcript) on Cloudflare Workers, live at `se-intel-portfolio.stephenmack96.workers.dev`. Not a demo: real JWT auth, real rate limiting, real multi-tenancy, a production incident found and fixed live (2026-07-07). | ✅ **Deliverable** |
| Context engineering / prompt engineering | Enablement agent's GROUNDING RULE prompt fix (Cycle 1 Week 2) — root-caused a flaky ~50% citation failure via a targeted system-prompt rule, verified 3/3 stable after. Documented in `CYCLE-1-WEEK-2-evals-ci-gate.md`. | ✅ **Deliverable** |
| Evaluation frameworks (evals) | Python eval harness: LLM-as-judge (5 dimensions, 15-pt scale) + a **deterministic** faithfulness check (`faithfulness.py`) that caught a real bug the LLM judge missed (KB said 35%, agent answered 25%). `run_eval.sh --ci` gates deploys on regression. | ✅ **Deliverable** |
| Agent architectures with tool use | 3 tools (`kb_search`, `web_search`, `fetch_news`) dispatched via a keyword-routed workflow (deliberately *not* open-ended agentic delegation — see STUDY.md ch.1 for the workflow-vs-agent distinction and why). RBAC enforced at tool execution time, not just the router. | ✅ **Deliverable** |
| Python proficiency | Eval harness (`runner.py`, `judge.py`, `faithfulness.py`, `report.py`) — httpx, argparse, direct Workers AI REST calls. | ✅ **Deliverable** |
| TypeScript/JavaScript | All of `se-intel`'s Worker/Durable Object code; Hono routing. | ✅ **Deliverable** |
| Scalable cloud architecture design | Multi-tenant org isolation across RAG (Vectorize metadata filter), memory (DO key scoping), and audit (D1 scoped reads) — proven by 3 deterministic admin probes, not asserted. Observability layer with per-org SLOs and error budgets. | ✅ **Deliverable** |
| LLM framework familiarity | LangGraph, LangChain, CrewAI referenced in `ai-lab/` notes; `dispatchTools` pattern is a hand-rolled workflow, deliberately evaluated against the framework alternative. | ✅ **Concept + notes** |
| MCP (Model Context Protocol) | `se-intel-mcp` — 3 tools (`research_account`, `get_enablement`, `get_memory`) exposing the live agents to Claude Desktop/Cursor/Continue.dev via stdio transport. Protocol-verified. | ✅ **Deliverable** (not yet connected to Claude Desktop) |
| Reusable blueprints / demos | **GAP** — no templatized starter project yet; each portfolio piece is a one-off build. | 🔲 Add |
| Transcript analysis | `TranscriptAgent` — post-call transcript analysis, CRM-ready structured output. | ✅ **Deliverable** |
| Advanced RAG patterns | Vectorize + role/org-namespaced metadata filtering + semantic chunking. **GAP:** no reranking yet. | ✅ **Deliverable** (reranking gap noted) |

### Customer-facing requirements

| Requirement | Portfolio Evidence | Status |
|---|---|---|
| Technical discovery → deployment journey | Day job (Cloudflare SE) does this daily. `rfp-lab/` documents full RFP response cycles (2 labs, 43-requirement response matrix on RFP-002). | ✅ **Role + Sprint** |
| Win technical evaluations | **GAP** — no head-to-head comparative eval (Claude vs. an alternative) built yet. `rfp-lab` has competitive positioning at the infra layer (Cloudflare vs. hyperscalers), not at the model layer. | 🔲 Add |
| Architecture reviews / code reviews | Every `CYCLE-1-WEEK-N` doc *is* a self-authored architecture decision record (DIRECT decision blocks, rejected alternatives, trade-offs). | ✅ **Deliverable** |
| Workshop / hackathon facilitation | `curriculum/phase-12-zero-trust/DEMO-SCRIPT.md` and `customer-demo/` — Zero Trust demo material from the day job side. Nothing AI-specific yet. | 📅 Planned |
| Executive-to-engineer communication | Blog #1 (multi-tenancy), Blog #2 (evals CI gate), portfolio project-page updates — all written to work at both a technical and a "why this matters" level. | ✅ **Deliverable** |
| Reusable enablement assets | Same as the "reusable blueprints" gap above — templates that scale across customers, not just this one system. | 🔲 Add |

### Mindset requirements (show, don't tell)

| Requirement | Portfolio Evidence |
|---|---|
| Builder identity — shipped real software | Every `se-intel` deployment is live with a real URL. Version-pinned deploys (`97e0b8a4`, etc.) |
| Systems mindset — reusable > one-off | Explicitly named as a gap above (no templates yet) — self-aware, not hidden |
| Operates in ambiguity | 2026-07-07: found a live production incident (public demo returning 401s to every visitor for 5 days) while doing unrelated prep work, diagnosed the root cause, fixed it, and verified against the live deployment — with no playbook telling you to look for it |
| Low ego / high collaboration | `THEORY-LOG.md` documents working-through of comprehension gaps in the open, including places where cold answers were incomplete |
| Safety-first | Failure Modes chapter (STUDY.md ch.10) + multi-tenant isolation probes + the 2026-07-07 postscript on a security-adjacent regression (Access-guard bug), including the honest root-cause analysis of why the test suite couldn't have caught it |

### Screening questions this portfolio answers

From `AGENTS.md`'s tracked list of screening questions Anthropic actually asks:

> **"Have you personally built and deployed a production LLM-powered application (not a demo, prototype, or hackathon project)?"**
> `se-intel` — live, multi-tenant, JWT-authed, rate-limited, audited, observed with real SLOs. Git history shows iterative hardening (Cycle 1, Weeks 1-3), not a single one-shot build.

> **"Have you built AI agents with tool use capabilities in a professional or production context?"**
> 3 tools across 3 agents, RBAC-enforced at execution time, audit-logged per call, with a debug mode (`?debug=true`) built specifically to support a deterministic faithfulness eval.

> **"Do you have experience working directly with startup engineering teams or technical founders (Series A–C stage)?"**
> **Honest gap.** This is the single most direct overlap with the Tier 2 (FDE) roles below — see the Gap Fillers section for how Tier 2 pursuit closes this specific gap rather than just working around it.

> **"Please describe your experience working on any personal or professional projects that make use of large language models to create complex or interactive functionality."**
> Two-tier memory (short-term DO SQLite + long-term KV fact extraction), streaming SSE, role-calibrated prompts, cross-org isolation, an eval harness with measured score progression (67% → 73% → 87%).

> **"Do you have expertise coding in Python?"**
> Eval harness is 100% Python.

---

## Tier 1 — OpenAI

### OpenAI — Solutions Engineer, Core Enterprise

**Role:** Pre-sales partner for Enterprise customers. Guide AI strategy, identify high-value use cases, recommend architecture patterns. More advisory than hands-on (see the FDE distinction in Tier 2 — this is closer to what the Pragmatic Engineer article calls OpenAI's "Solutions Architect" role).

| Requirement | Portfolio Evidence | Status |
|---|---|---|
| 8+ years technical pre-sales, incl. 4+ enterprise | Current role = Cloudflare SE (enterprise). `se-intel` proves AI-specific extension of that skill. | ✅ **Role + Sprint** |
| Deliver exceptional pre-sales customer experience | `rfp-lab` — full RFP response cycles, objection handling sections, honest "PC" (partially compliant) callouts rather than overselling. | ✅ **Deliverable** |
| Build/present demos, scope use cases, recommend architecture | `se-intel` chat UI (`/`) as a living demo across 5 roles. `CYCLE-1-WEEK-N` docs are architecture recommendation records. | ✅ **Deliverable** |
| IT security + enterprise compliance | Multi-tenant isolation (Cycle 1 Week 1), the 2026-07-07 auth-guard incident and fix, `rfp-lab` security requirement responses (mTLS, DLP, SOC 2/ISO 27001 positioning). | ✅ **Deliverable** |
| Python or JavaScript | Both — TypeScript for `se-intel`, Python for the eval harness. | ✅ **Deliverable** |
| GenAI/ML prototypes + cloud architecture | Workers, Durable Objects, D1, KV, Vectorize, AI Gateway — all in active use, not just referenced. | ✅ **Deliverable** |
| Own problems end-to-end | Solo-built and hardened `se-intel` across 3 cycle weeks: architecture → build → break → fix → document → publish. | ✅ **Deliverable** |
| **GAP: Formal SE discovery→deployment playbook** | `rfp-lab`'s per-RFP structure (Summary → Response Matrix → Reference Architecture) is close, but not written as a reusable, product-agnostic playbook. | 🔲 Add |

### OpenAI — AI Deployment Engineer, Startups

**Role, per OpenAI's own framing (and reframed after the FDE deep dive):** this is functionally OpenAI's FDE-equivalent for the startup segment — more hands-on than the Solutions Engineer role above. OpenAI's actual FDEs **write code directly on customer infrastructure**, work in higher ambiguity, and feed field learnings back into OpenAI's research/product roadmap (per Colin Jarvis, Head of FDE at OpenAI — see Tier 2 for the full sourcing). Position for this role using hands-on evidence, not advisory evidence.

| Requirement | Portfolio Evidence | Status |
|---|---|---|
| 5+ years SWE/ML, ideally startup environment | Cloudflare SE role (startup-facing vertical) + `se-intel` as the AI engineering proof point. | ✅ **Role + Sprint** |
| Passion for startups | Day job vertical is startups. Portfolio is entirely self-funded, self-directed side-building — not assigned work. | ✅ **Role** |
| Proficient in Python, JS, AI/LLM best practices | Both languages in active production use across the portfolio. | ✅ **Deliverable** |
| Built and delivered prototypes on the API platform | `se-intel` (Workers AI), `ai-sales-copilot` (Llama 3.3 70B via Workers AI, Vectorize RAG, 3-agent chaining). | ✅ **Deliverable** |
| Proactively identify opportunities for maximizing customer value | The 2026-07-07 incident: found a bug *nobody asked about* while doing unrelated prep work, diagnosed it was costing the "customer" (any portfolio visitor) the entire demo, and fixed it same-day. This is the FDE reflex in miniature. | ✅ **Deliverable** |
| Own problems end-to-end, including in ambiguity | Same incident — no ticket, no playbook, found via a side effect of testing something unrelated. | ✅ **Deliverable** |
| Contribute to open-source / codify best practices | **GAP** — nothing published to a public OSS repo yet; `se-intel` code is on a private GitHub repo. | 🔲 Add |
| **GAP: direct embedded work with an actual external startup team** | Everything above is self-directed on your own portfolio system, not embedded with someone else's engineering team on their infrastructure. This is the real FDE gap — see Gap Fillers. | 🔲 Add |

### OpenAI — AI Success Engineer (Abu Dhabi)

**Role:** Post-sales technical relationship lead. Drive adoption, health, value realization for enterprise customers.

| Requirement | Portfolio Evidence | Status |
|---|---|---|
| 8+ years technical customer-facing (TAM/SA/delivery) | Cloudflare SE role + `se-intel` AI-specific extension. | ✅ **Role + Sprint** |
| Deep hands-on API/SDK/integration knowledge | AI Gateway routing (per-call metadata tagging across every `AI.run()` call in `se-intel`), Workers AI API, MCP protocol integration. | ✅ **Deliverable** |
| Translate technical concepts into business language | Blog posts, project-page updates, `rfp-lab` executive-facing summaries. | ✅ **Deliverable** |
| Guide value realization via baselines, KPIs, reporting | `/api/v1/health` + `/admin/health-scorecard` — a **shipped, live account-health scorecard** with p50/p95 latency, error rate, and error budget remaining per org. This directly answers the "adoption/health scorecard" gap the old version of this document used to flag as missing. | ✅ **Deliverable** — **this gap is now closed** |
| Facilitate workshops on use case design | `DEMO-SCRIPT.md`, `customer-demo/` (Zero Trust side, not yet AI-specific). | 📅 Planned |
| High ownership, fast decision-making | The 2026-07-07 incident response: diagnose → fix → deploy → verify against live traffic → document, same session. | ✅ **Deliverable** |

---

## Tier 2 — Forward Deployed Engineer, wherever it's hired

**Source:** Gergely Orosz, *"What are Forward Deployed Engineers, and why are they so in demand?"*, The Pragmatic Engineer, Aug 12, 2025. Interviews with Colin Jarvis (Head of FDE, OpenAI), Leo Mehr (Head of FDE, Ramp), Anjor Kanekar (7-year Palantir FDE).

### Why this tier exists

Anthropic and OpenAI were the starting point for this whole document, not the ceiling. FDE is a distinct, fast-growing role category that overlaps heavily with what this portfolio already proves, and it's hired well beyond those two companies. Widening the target list here is a deliberate choice, not scope creep: the skill profile is the same one this portfolio is already built to prove.

### What an FDE actually is

A software engineer who alternates between being embedded with a specific customer's team (writing code on *their* infrastructure, in *their* tools) and contributing back to their own company's core product. Palantir's own framing is the clearest one:

> "FDEs' responsibilities look similar to those of a startup CTO: you'll work in small teams and own end-to-end execution of high-stakes projects."

Key distinction from a Solutions Architect / Solutions Engineer (per Colin Jarvis, OpenAI): SAs rarely write code on customer infrastructure and work from anonymized/offline data. FDEs are hands-on — they write code directly in the customer's environment and are expected to handle much higher ambiguity, because "what the customer describes in scoping doesn't match the data/system reality on the ground."

### Companies actively hiring for this role (per the article)

| Company | Segment | Notes |
|---|---|---|
| **OpenAI** | AI foundation model | ~10+ FDEs across NY/SF/Dublin/London/Munich/Paris/Tokyo/Singapore. Already Tier 1 above, via "AI Deployment Engineer, Startups." |
| **Palantir** | Data/gov + enterprise | Originated the role (called it "Delta"). Until 2016, had more FDEs than software engineers. ~25% onsite time. |
| **Ramp** | Fintech scaleup | ~15 FDEs organized in mentorship "pods." Explicit hiring signals below. |
| **Scale AI** | AI infra | Real comp data point below (L4, DC, $286K total). |
| **Sierra AI** | AI customer service agents | Calls the role "Agent Engineer" — Orosz's own conclusion: *"an 'AI-focused FDE' and an 'Agent Engineer' are the same."* |
| **Salesforce** | Enterprise CRM/AI | "Senior FDE" for Agentforce — job description reads almost identically to the Anthropic mindset requirements above (own end-to-end, remove technical blockers, rapid prototyping). |
| **Commure, Matta, Gecko Robotics** | Vertical AI (healthcare, industrial, robotics) | Smaller, more specialized — useful as a signal that FDE-shaped hiring isn't just a mega-cap phenomenon. |
| **Cloudflare** (your own employer) | Infra | See the narrative note below — Cloudflare already sells an FDE-equivalent as part of enterprise deals. |

### A narrative bridge you already have and didn't know it

Found while researching this: `rfp-lab/001-zero-trust-sase/001-a-gateway-dns-financial/`:

> `WIN-WIRE.md`: *"Forward Deployment Engineer (FDE) — bundled into commercial package"*
> `WHAT-CHANGED.md`: *"FDE lowers the customer's risk of failed deployment. It also keeps Cloudflare deeply embedded in the customer's technical team during the critical first 90 days — which is when expansion opportunities are identified."*

Cloudflare is already positioning FDEs as part of its own enterprise deal structure. That's a real interview answer to "why FDE, why now": *"I've already positioned this exact model from the vendor side, in real enterprise deals, before pursuing it as a role myself."* Nobody else applying for these roles will have that specific angle.

### Ramp's hiring signals (Leo Mehr, Head of FDE) — self-assessment

| Signal | Self-assessment |
|---|---|
| Drive and work ethic | Portfolio built entirely outside day-job hours, on a continuous (not time-boxed) cycle — see `MASTERY.md` |
| Engineering fundamentals | `se-intel` — TypeScript + Python, tested, deployed, hardened across 3 cycle weeks |
| Customer empathy, communication | Day job (Cloudflare SE) — daily practice |
| Teaching/leadership experience | **Unverified** — no TA/club-leadership history noted anywhere in the portfolio docs |
| "Service orientation" | Day job is literally this; `rfp-lab` objection-handling and honest "PC" callouts show the instinct extends to writing, not just conversation |
| Founder background | **Gap** — not a founder |
| Early-stage startup background | **Partial** — Cloudflare's own startup-segment vertical, not personal founding/early-employee experience |

### Compensation reality check (from the article, Levels.fyi data)

| Level | Company | Total Comp | Note |
|---|---|---|---|
| Mid-level (L4) | Scale AI (Washington DC) | $286K ($185K base + $91K/yr stock) | Requires security clearance in defense contexts |
| Mid-level | Windsurf (Mountain View) | $185K ($180K base + $5K/yr stock) | Stock component notably low |
| Entry-level | Commure (Mountain View) | $160K ($135K base + $25K/yr stock) | |

Roughly mirrors general SWE comp bands at the same level — not a premium. Go in with that expectation set correctly.

### FDE-specific requirement table

| Requirement | Portfolio Evidence | Status |
|---|---|---|
| "Always be scoping" — talk a customer out of unnecessary work | **Gap** — no documented case of this yet; day job likely has real examples not yet written down | 🔲 Document from day job |
| Generalize one-off customer work into reusable platform capability | Same gap as the Anthropic "reusable blueprints" line above — this is the same skill, viewed from the FDE angle | 🔲 Add |
| Write code directly on a customer's infrastructure/tooling | **Gap.** Everything in the portfolio runs on your own Cloudflare account. No embedded work on someone else's stack. | 🔲 **The single biggest gap for this tier** |
| Comfortable in ambiguity, "startup CTO" ownership | 2026-07-07 incident (found + fixed a production outage with zero ticket, zero playbook, mid-way through unrelated work) is strong, real evidence | ✅ **Deliverable** |
| Bias toward validating scope before committing to delivery | Every `CYCLE-1-WEEK-N` doc's DIRECT decision block (options considered, trade-off chosen, rejected alternatives named) is this instinct, just applied to self-directed work instead of a live customer | ✅ **Deliverable (adjacent)** |
| Contribute learnings back to the core platform/product | Findings from `se-intel` hardening feed directly back into `STUDY.md` and `THEORY-LOG.md` — the FDE-equivalent of "field notes → research team" | ✅ **Deliverable (adjacent)** |

---

## Master Skills Heatmap

Cycle 1 (the current, active hardening cycle on `se-intel`) mapped against Tier 1 and Tier 2 skill demands. Replaces the old 30-day-sprint version of this table, which referenced a program (and a golf-betting-agent project) no longer active.

| Cycle 1 Week | Deliverable | Anthropic (all 5 variants) | OpenAI SE | OpenAI Deployment Eng / FDE | OpenAI Success Eng | Tier 2 (FDE, general) |
|---|---|---|---|---|---|---|
| Week 1 | Multi-tenancy — org isolation on RAG/memory/audit, 3 deterministic probes | Scalable architecture, safety-first mindset | Enterprise security | Hands-on infra ownership | Enterprise trust | "Own end-to-end" |
| Week 2 | Evals as a CI gate — deterministic faithfulness check catches a real bug the LLM judge missed | Evaluation frameworks (direct requirement) | Data-driven pre-sales | AI/LLM best practices | Value measurement rigor | Bias to validated scope |
| Week 3 | Observability + SLOs + account-health scorecard; SLO recalibrated against real measured traffic | Production LLM apps at scale | Enterprise monitoring | Ambiguity → measured decision | **Direct requirement — adoption/health scorecard** | Generalizable platform capability |
| 2026-07-07 (patch day, not a full cycle week) | Found + fixed a hardcoded metrics bug AND a live 5-day production outage, same session, mid-way through unrelated prep work | Operates in ambiguity (mindset requirement) | Ownership, fast decisions | **This is the job, in miniature** | High ownership, fast decision-making | "Startup CTO" ownership |
| Week 4 (next, 2026-07-14) | Failure under load — fault injection, DO contention (including a real KV race-condition bug already found) | Safety/failure-mode depth | Production readiness | Graceful degradation under real conditions | Reliability storytelling | Handling real-world messiness |

---

## Gap Fillers

Concrete, scoped actions that close the gaps named above — organized by effort, not by which role they serve, since most gaps serve multiple targets at once.

### Gap 1: Embedded work with an actual external team (Tier 2's biggest gap, and Anthropic screening question #3)
**Relevance:** This is the same named gap in both Tier 1 (Anthropic: *"experience working directly with startup engineering teams or technical founders"*) and Tier 2 (FDE: *"write code directly on a customer's infrastructure"*). Closing it once answers both.
**What to do:** Find a real early-stage startup or technical founder (even informally — a friend's project, an open-source maintainer needing help) and do genuinely embedded work: their repo, their infra, their priorities, for a defined stretch of time. Document it the same way `CYCLE-1-WEEK-N` docs are written — DIRECT decisions, what shipped, what was rejected and why.
**Estimated time:** Ongoing / opportunistic — this isn't a single sprint task.

### Gap 2: Reusable blueprint / template (Anthropic "Commercial" variant + Tier 2 "generalize the work")
**Relevance:** Named explicitly in both Anthropic's "Commercial" role emphasis and Ramp's operating principle #2 ("generalize our work... avoid the octopus").
**What to do:** Take one piece of `se-intel` (the multi-tenancy pattern, or the eval harness) and extract it into a standalone, documented, reusable starter template — not just "here's my code" but "here's how you'd apply this to a different system."
**Estimated time:** 3-4 hours.

### Gap 3: Fine-tuning / model customization note (still open from the old version of this doc)
**Relevance:** Anthropic and OpenAI both reference fine-tuning/customization approaches in screening material.
**What to do:** Write `projects/se-intel/fine-tuning-notes.md` — when to fine-tune vs. RAG vs. prompt engineering, with a cost/tradeoff table. This is planned in `MASTERY.md`'s Cycle 1 Week 6 ("Fine-tune-vs-RAG note + Cloudflare-positioning architecture doc") — no need to duplicate early.
**Estimated time:** Already scheduled — no separate action needed.

### Gap 4: Open-source contribution
**Relevance:** OpenAI Deployment Engineer explicitly asks for this; general credibility signal for all Tier 2 targets.
**What to do:** Publish the eval harness (`faithfulness.py` + the deterministic-check pattern) as a standalone open-source tool — it's genuinely reusable outside `se-intel` and has a real "caught a bug the LLM judge missed" story attached.
**Estimated time:** 2-3 hours to extract and document; the code itself already exists.

### Gap 5 (closed, kept for the record): Account health / adoption scorecard
Previously flagged as a gap in this document. **Closed** by Cycle 1 Week 3 — `/api/v1/health` and `/admin/health-scorecard` are live, real, and were stress-tested (found and fixed a real bug in the underlying metrics on 2026-07-07). Leaving this row in as a record that the gap-filler process works.

---

## Key Application Questions — Proof Kit

### Anthropic (real screening questions, from `AGENTS.md`)

> **"Have you personally built and deployed a production LLM-powered application (not a demo, prototype, or hackathon project)?"**
> **Proof:** `se-intel-portfolio.stephenmack96.workers.dev` — live, multi-tenant, JWT-authed. Git history: Cycle 1 Weeks 1-3, each with a deterministic probe proving the claim (isolation, faithfulness, health).

> **"Have you built AI agents with tool use capabilities in a professional or production context?"**
> **Proof:** 3 tools, 3 agents, RBAC enforced at execution time (not just the router), audit-logged, debug-mode-instrumented for eval purposes.

> **"Do you have experience working directly with startup engineering teams or technical founders (Series A–C stage)?"**
> **Honest answer:** Not yet in a formal capacity — see Gap Filler 1. This is the sharpest, most honest gap in the whole document, and naming it precisely is itself part of the "low ego" mindset requirement.

> **"Please describe your experience working on any personal or professional projects that make use of large language models to create complex or interactive functionality."**
> **Proof:** Two-tier memory, streaming SSE, cross-org RAG isolation, an eval harness with a measured score progression (67% → 73% → 87%) and a caught-in-production faithfulness bug.

> **"Do you have expertise coding in Python?"**
> **Proof:** Full eval harness — `runner.py`, `judge.py`, `faithfulness.py`, `report.py`.

### OpenAI (implicit requirements, from job description language)

> **"Foundational training in programming languages like Python or JavaScript."**
> **Proof:** TypeScript across `se-intel`; Python across the eval harness.

> **"Delivered prototypes of Generative AI/traditional ML solutions."**
> **Proof:** `se-intel` (3 agents, live) + `ai-sales-copilot` (3-agent chaining, Vectorize RAG, Llama 3.3 70B).

> **"Proactively identify opportunities for maximizing customer business value through leveraging the [platform] API."**
> **Proof:** The 2026-07-07 incident — nobody asked for it, it was found while doing something else, and it was fixed and verified same-day because leaving it broken had a real cost (every visitor to the live demo).

### Tier 2 / FDE (synthesized from the article's actual hiring criteria)

> **"Tell me about a time you had to scope down a customer's ask because it wasn't the highest-value thing to build."** (Ramp's "Always Be Scoping" principle)
> **Honest answer:** No portfolio evidence yet — day job likely has real examples not yet written down. See Gap Filler 1.

> **"Describe a time you worked in high ambiguity with no clear spec."**
> **Proof:** 2026-07-07 — set out to fix one hardcoded status field, found a live production outage as a side effect, diagnosed root cause (a global auth guard with no compensating security value), fixed it, and proved via live traffic that nothing else depended on it.

> **"How do you decide whether to build something custom for one customer, or generalize it into the platform?"**
> **Proof (partial):** Every `CYCLE-1-WEEK-N` doc's DIRECT decision block is exactly this reasoning pattern, currently applied to a self-directed system rather than a live customer ask — see Gap Filler 1 for closing that distinction.

---

## How to Use This Document

1. **Before interviews:** Read the relevant tier and role section. The "Proof Kit" tells you exactly what story to tell, including the honest gaps — naming a gap precisely is itself evidence of the "low ego" mindset Anthropic explicitly screens for.
2. **During each Cycle week:** When a `CYCLE-1-WEEK-N` doc closes, check it against the Master Skills Heatmap and update this document if it closes or sharpens a gap — the way Week 3 closed the account-health-scorecard gap.
3. **Tier 2 pursuit:** Don't wait for Gap Filler 1 (embedded external-team work) to be "done" before applying to FDE roles — the article notes FDE hiring rewards drive and engineering fundamentals as much as prior FDE experience specifically. Apply with the honest gap named, not hidden.
4. **On the job:** The gap fillers are the adult supervision on this document — they separate "built a demo" from "ready to embed with a real customer team."

---

*This document tracks the `ai-dev` portfolio under the continuous Cycle model defined in `MASTERY.md`. It has no fixed end date and updates as Cycle 1 (and future cycles) progress.*
