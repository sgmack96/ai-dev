# AGENTS.md — Agentic AI Portfolio

> **Role:** Cloudflare Solutions Engineer → AI/ML Solutions Architect
> **Focus:** Build production-grade agentic AI systems on Cloudflare to prove readiness for top AI companies (Anthropic, OpenAI)
> **Location:** `/Users/smack/ai-dev/AGENTS.md`
> **Last Updated:** 2026-05-28

---

## Project Purpose

This is a **portfolio-building sprint** designed to map every deliverable to actual job requirements from leading AI companies. The goal is not just to learn agentic AI, but to **prove through shipped code** that I can architect, build, and deploy AI systems at the level these companies hire for.

**Target roles:**
- Anthropic — Applied AI Architect, Startups (SF/NYC)
- Anthropic — Applied AI Architect, Commercial (SF/NYC)
- Anthropic — Applied AI Architect, Industries (NYC/SF/Seattle)
- Anthropic — Applied AI Engineer (London)
- Anthropic — Applied AI Engineer, Enterprise Tech (SF/NYC/Seattle)
- OpenAI — Solutions Engineer, Core Enterprise
- OpenAI — AI Deployment Engineer, Startups
- OpenAI — AI Success Engineer (Abu Dhabi)

**Core hypothesis:** The future belongs to engineers who can bridge AI capabilities with production infrastructure. Cloudflare's edge platform is the ideal proving ground.

---

## Who I Am

I am a **Cloudflare Solutions Engineer** selling to startups. My superpower is translating technical capabilities into business outcomes. This is an ongoing portfolio of projects that extends that skill into AI/ML engineering.

**What I bring:**
- 5+ years in technical customer-facing roles (SE/SA/TAM)
- Fluent English
- Enterprise customer experience (complex buying cycles, C-suite to engineer)
- Full-stack JavaScript/TypeScript, Python proficiency
- Deep Cloudflare platform knowledge (Workers, KV, D1, R2, AI Gateway, Vectorize)

**What I'm proving:**
- I can build and deploy real AI systems, not just talk about them
- I understand multi-agent architectures, RAG, evals, and production patterns
- I can scope use cases, build demos, and create business cases
- I can operate as a technical thought partner from ideation to production

---

## How You Should Answer My Questions

### 1. Cite Sources (Non-Negotiable)

Every technical answer must include citations to:
- Cloudflare Developer Documentation (developers.cloudflare.com)
- Relevant academic papers (ArXiv links)
- Cloudflare Blog (blog.cloudflare.com)
- Internal wiki pages or knowledge bases (if applicable)
- GitHub repos or official examples

**Format:**
```
Answer text...

**Sources:**
- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
```

### 2. Complete Answers (No Summaries Unless Asked)

I need:
- Full implementation details with working code
- Configuration files (wrangler.toml, package.json, etc.)
- Step-by-step deployment instructions
- Cost breakdowns with real numbers
- Failure modes and how to handle them
- Security implications

**If a topic requires 200 lines, write 200 lines.** I will tell you if I need it shorter.

### 3. Cloudflare-First Perspective

**Always frame answers through the Cloudflare lens:**
- How does this run on Workers?
- What's the edge-native architecture?
- How does Workers AI compare to OpenAI/Anthropic APIs?
- What are the cost advantages?
- How does AI Gateway help?
- What's the latency story?

**Compare against competitors when relevant:**
- AWS Lambda (cold starts, regional lock-in)
- Vercel (good for frontend, limited backend)
- Fastly (compute@edge limitations)
- OpenAI API (cost, rate limits, single provider)

### 4. Agentic AI Context

**This sprint covers:**
- ReAct reasoning patterns
- Multi-agent orchestration (CrewAI, LangGraph)
- RAG with Vectorize
- Evaluation frameworks (LLM-as-judge)
- Production deployment patterns
- Cost optimization and caching
- Enterprise security and guardrails

**When answering:**
- Show the Cloudflare-native implementation first
- Then show how it compares to the "standard" OpenAI/Anthropic approach
- Include cost per request/token where possible
- Explain when to use Workers AI vs AI Gateway vs direct API calls

### 5. Portfolio Mindset

**Every deliverable must be:**
- Deployed and live (URL provided)
- Documented (README with architecture diagram)
- Demo-ready (script exists, can be shown in 5 minutes)
- Business-justified (cost, ROI, competitive positioning)

**When I ask about a feature:**
- Consider: "How does this look on a resume/in an interview?"
- Provide the "so what" — why this matters for the target roles
- Connect to specific job requirements from the README.md alignment doc

---

## Technical Stack

| Layer | Technology | Cloudflare Product |
|-------|-----------|-------------------|
| **Compute** | TypeScript/JavaScript, Python | Cloudflare Workers (V8 isolates) |
| **AI/ML** | Workers AI models, AI Gateway | Workers AI, AI Gateway |
| **Storage** | KV, D1, R2 | KV (global cache), D1 (SQLite), R2 (S3-compatible) |
| **Vector DB** | Vectorize | Vectorize (pgvector-compatible) |
| **Frameworks** | Hono, LangChain, LangGraph, CrewAI | Hono for HTTP routing |
| **Observability** | Workers Analytics, Sentry | Built-in + third-party |
| **Deployment** | Wrangler CLI, GitHub Actions | Wrangler v3+ |

---

## Project Structure

```
/Users/smack/ai-dev/
├── AGENTS.md                    # This file
├── README.md                    # Career alignment doc (target roles, skills heatmap)
├── projects/                    # Individual agent projects
│   ├── <project-name>/
│   │   ├── src/
│   │   ├── wrangler.toml
│   │   └── README.md
│   └── ...
├── evaluation-harness/          # LLM-as-judge + A/B testing framework
│   ├── src/
│   └── README.md
├── business-cases/              # Business case templates + cost analysis
│   ├── cloudflare-vs-openai.md
│   └── roi-calculator.md
├── demo-scripts/                # Demo scripts for different audiences
│   ├── c-suite-demo.md
│   ├── engineer-demo.md
│   └── objection-handling.md
├── architecture-diagrams/       # Excalidraw/ASCII architecture docs
├── career-alignment/            # Job requirement mapping
│   ├── se-playbook.md           # Discovery → Deployment playbook
│   └── gap-fillers.md
└── blog-posts/                  # Public content
    └── ...
```

---

## Sprint Roadmap (Ongoing)

This is a living roadmap. I will continue building, learning, and expanding projects indefinitely.

| Phase | Theme | Key Deliverables |
|------|-------|-----------------|
| **Phase 1** | Foundation | Multi-agent core agent, AI Gateway routing, real tools, conversation memory |
| **Phase 2** | Scale | CrewAI integration, LangGraph control flow, D1 database, secondary modules |
| **Phase 3** | Production | Eval framework, A/B testing, cost engineering, observability, enterprise audit |
| **Phase 4+** | Portfolio & Beyond | Vertical agents, competitive analysis, blog posts, open-source contributions, new ideas as they come |

**Current status:** Starting fresh. Ready to ship.

---

## Communication Preferences

| Situation | How I Want It |
|-----------|--------------|
| **Code examples** | Complete, copy-paste ready, with comments |
| **Architecture** | Diagrams (Excalidraw or ASCII), not just text |
| **Pricing** | Tables with comparisons, not vague statements |
| **Timelines** | Specific hours/days, not "soon" or "eventually" |
| **Risks** | Honest assessment, not sugar-coated |
| **Next steps** | Numbered action items with who-does-what |

---

## Things That Frustrate Me

1. **Vague answers** — "It depends" without explaining what it depends on
2. **Missing context** — Assuming I know something I don't
3. **Marketing speak** — "Cloud-native synergies" instead of actual technical details
4. **Incomplete code** — Pseudocode when I need working TypeScript
5. **No failure modes** — Only showing the happy path
6. **Not connecting to jobs** — Every answer should tie back to "how does this help me get hired at Anthropic/OpenAI"

---

## Quick Reference for You

**When I ask about a Cloudflare product:**
- Start with the developer docs URL
- Explain the binding/configuration in wrangler.toml
- Show a minimal working example
- Compare pricing to the nearest competitor
- Mention one startup success story if you know it

**When I ask about an AI/agent topic:**
- Cite the original paper (ArXiv link)
- Show the Cloudflare-native implementation
- Include cost per request/token
- Explain when to use Workers AI vs AI Gateway

**When I ask about a target role (Anthropic/OpenAI):**
- Check README.md for specific job requirements
- Map the answer to a specific skill gap or proof point
- Suggest which project or deliverable this connects to

---

## Active Projects

*Starting fresh. Projects will be added here as they are built and deployed.*

---

## Anthropic Target Role Requirements

> Extracted from 5 live JDs (May 2026). Every project and deliverable should map to at least one requirement here.

### Technical Skills — Must Demonstrate

| Requirement | Source Roles | How to Prove It |
|-------------|-------------|-----------------|
| **Production LLM apps deployed at scale** | All 5 roles | Deployed Workers with real endpoints, not demos |
| **Context engineering / prompt engineering** | All 5 roles | Documented prompt techniques in project READMEs |
| **Evaluation frameworks (evals)** | All 5 roles | LLM-as-judge harness, custom eval suites per use case |
| **Agent architectures with tool use** | All 5 roles | Multi-tool agents, ReAct loops, MCP integration |
| **Python proficiency** | All 5 roles | Python scripts, evals, data pipelines alongside TS |
| **TypeScript/JavaScript** | Enterprise Tech | Workers code, Hono APIs |
| **Scalable cloud architecture design** | Architect roles | Architecture diagrams per project |
| **LLM framework familiarity** | All 5 roles | LangGraph, LangChain, CrewAI in project code |
| **MCP (Model Context Protocol)** | Enterprise Tech | MCP server implementation |
| **Reusable blueprints / demos** | Commercial | Templatized starter projects, not one-offs |
| **Transcript analysis** | Enterprise Tech | Log analysis, session replay patterns |
| **Advanced RAG patterns** | All | Vectorize + semantic chunking + reranking |

### Customer-Facing Skills — Must Demonstrate

| Requirement | Source Roles | How to Prove It |
|-------------|-------------|-----------------|
| **Technical discovery → deployment journey** | All 5 roles | Write up a fictional or real customer arc per project |
| **Win technical evaluations** | Startups | Build comparative eval showing Claude vs alternatives |
| **Architecture reviews / code reviews** | Applied AI Eng | Documented PR reviews, architecture decision records |
| **Workshop / hackathon facilitation** | Applied AI Eng | Demo scripts, workshop agendas in `demo-scripts/` |
| **Executive-to-engineer communication** | Industries | Blog posts, whitepapers, tiered explainers |
| **Reusable enablement assets** | Commercial | Templates, blueprints that scale across customers |

### Mindset Requirements (Show Don't Tell)

- **Builder identity:** Shipped real software. Every project must have a live URL.
- **Systems mindset:** One reusable thing > ten one-off things. Build with templates.
- **Operates in ambiguity:** No playbook exists. Document decisions as you make them.
- **Low ego / high collaboration:** Show cross-team thinking in project docs.
- **Safety-first:** Every project includes a section on failure modes and safety guardrails.

### Screening Questions Anthropic Actually Asks

These appear verbatim in Anthropic application forms — have concrete answers ready:

1. "Have you personally built and deployed a production LLM-powered application (not a demo, prototype, or hackathon project)?"
2. "Have you built AI agents with tool use capabilities in a professional or production context?"
3. "Do you have experience working directly with startup engineering teams or technical founders (Series A–C stage)?"
4. "Please describe your experience working on any personal or professional projects that make use of large language models to create complex or interactive functionality."
5. "Do you have expertise coding in Python?"

**Action:** Every project README must serve as a concrete answer to question 1, 2, and 4.

### Skill Gap Analysis (Current vs. Required)

| Skill | Current Level | Target Level | Gap-Filler Project |
|-------|--------------|--------------|-------------------|
| Production LLM deployment | Intermediate | Strong | Phase 1 core agent |
| Evaluation frameworks | Beginner | Strong | Phase 3 eval harness |
| Agent architectures + tool use | Beginner | Strong | Phase 1–2 agents |
| Python (AI/ML context) | Intermediate | Proficient | Eval harness in Python |
| Context engineering | Beginner | Strong | Documented in each project |
| MCP implementation | None | Working knowledge | Phase 2+ |
| Reusable blueprint creation | None | Demonstrated | Phase 2 templates |
| Technical writing for devs | Intermediate | Strong | Blog posts in `blog-posts/` |

---

## How This File Works

This AGENTS.md lives in the project root (`~/ai-dev/AGENTS.md`). OpenCode reads this to understand:
- What this project is trying to achieve
- How every deliverable maps to job requirements
- Why Cloudflare is the right platform to build on
- What level of detail and sourcing is expected

**Update this file when:**
- New projects are shipped
- New target roles are added
- Technical stack evolves
- Communication preferences change

---

*This file ensures every answer I get from OpenCode is tailored to my goal of proving AI engineering readiness at the world's top AI companies, built on the Cloudflare platform.*
