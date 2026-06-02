# SE Intel — Multi-Agent Revenue Intelligence Platform

> **Live:** https://se-intel-portfolio.stephenmack96.workers.dev  
> **Stack:** Cloudflare Workers · Durable Objects · Workers AI · Vectorize · KV · D1 · Hono  
> **Full write-up:** https://portfolio.macksportreport.com/blog/se-intel-architecture

A production-grade two-agent system for sales teams. Role-gated knowledge base, streaming responses, cross-session memory, and an LLM-as-judge evaluation harness. Every component deployed on Cloudflare's edge — $0 infrastructure cost.

---

## Agents

### AccountIntelAgent
Pre-call research. Give it a company name or tech stack description:
- Fetches recent news (NewsAPI)
- Searches the web (DuckDuckGo) for tech stack signals
- Queries the RAG knowledge base for Cloudflare opportunities
- Returns competitive positioning, discovery questions, migration angles

### EnablementAgent
Sales coaching. Ask about objections, POC patterns, product comparisons:
- Always queries the KB first (product knowledge, competitive comparisons)
- Falls back to web search if KB has no relevant chunks
- Role-calibrated depth — AEs get business framing, SEs get technical depth

---

## Architecture

```
Browser
  │
  ├─ POST /api/v1/account/stream   (streaming SSE)
  │    Authorization: Bearer <HS256 JWT>
  │
  ▼
Cloudflare Worker (Hono router)
  ├─ extractUserContext()   → verify JWT → UserContext{userId, role, orgId}
  ├─ checkRateLimit()       → KV sliding window → 429 if exceeded
  └─ stub.fetch("/stream")  → Durable Object for this userId
       │
       ▼
  AccountIntelAgent (Durable Object — one per user)
  ├─ memory.getHistory()    → SQLite: last 20 turns for this thread
  ├─ ltm.formatForPrompt()  → KV: stored facts about this user
  ├─ buildSystemPrompt()    → role-specific instructions + LTM
  ├─ dispatchTools()
  │    ├─ fetchNews()       → NewsAPI (se/tam/manager only)
  │    ├─ kbSearch()        → Vectorize RAG (namespace-filtered by role)
  │    └─ webSearch()       → DuckDuckGo → KB fallback
  ├─ AI.run(stream: true)   → Llama 3.3 70B → ReadableStream
  ├─ SSE: tools → tokens → done
  └─ state.waitUntil()
       ├─ memory.append()   → SQLite (conversation history)
       ├─ writeAudit()      → D1 (audit log)
       └─ extractFacts()    → Workers AI → KV (long-term memory)
```

---

## RBAC — Five Roles, Three KB Namespaces

| Role | KB Access | Web Search | News |
|------|-----------|------------|------|
| `ae` | `public` | — | — |
| `csm` | `public` | — | — |
| `se` | `public` + `se_only` | ✓ | ✓ |
| `tam` | `public` + `se_only` | ✓ | ✓ |
| `sales_manager` | `public` + `se_only` + `manager_only` | ✓ | ✓ |

**KB namespaces (102 chunks total):**
- `public` (80) — Product overviews, pricing, competitor comparisons
- `se_only` (12) — POC patterns, architecture guides, technical objection handling
- `manager_only` (10) — Discount approval tiers, champion building, deal strategy

Access is enforced at three layers: the `ROLE_KB_ACCESS` type map, tool execution time, and the Vectorize filter clause.

---

## Key Technical Decisions

### Durable Objects for agent state
Each user gets one DO instance per agent, single-threaded, with embedded SQLite storage. Eliminates the race condition where two concurrent requests read the same conversation history and write conflicting state back. Idle DOs hibernate at $0.

### Streaming SSE
`AI.run({ stream: true })` returns a `ReadableStream`. The DO re-emits three event types: `tools` (fires before first token — shows what was retrieved), `token` (one per word), `done` (latency + metadata). The Worker passes the stream straight through with no buffering — TTFB under 100ms.

### Long-term memory extraction
After every response, `state.waitUntil()` keeps the DO alive while a short LLM call extracts personal facts ("prefers bullet points", "working on Stripe deal") and writes them to KV. Facts are injected into the system prompt on future conversations via `ltm.formatForPrompt()`.

**Key bug fixed:** plain `.catch(() => {})` without `state.waitUntil()` causes the DO isolate to die before async work completes — a silent failure with no error thrown.

---

## Evaluation Harness

```
evaluation-harness/
├── cases/
│   ├── account-intel.json   # 8 test cases
│   └── enablement.json      # 7 test cases
├── eval/
│   ├── runner.py            # calls live API, records raw results
│   ├── judge.py             # LLM-as-judge via Workers AI REST API
│   └── report.py            # score summary + regression diff
└── tests/
    └── run_eval.sh          # one command: runner → judge → report
```

**Scoring (LLM-as-judge):**
- Groundedness (0-3) — cites real products/pricing or hallucinations?
- Relevance (0-3) — answers what was actually asked?
- Role-appropriateness (0-3) — right depth for the role?
- Actionability (0-3) — usable in a customer call today?
- **Pass threshold:** 8/12

**Notable:** paired test cases (`acc-001` SE vs `acc-006` AE) ask the same question to two roles. The judge penalizes over-technical responses to AEs and under-technical responses to SEs — these catch both bad RBAC and mis-calibrated system prompts in one test.

**Run:**
```bash
cd evaluation-harness
cp .env.example .env   # fill in CF_ACCOUNT_ID and CF_API_TOKEN
pip install -r requirements.txt
./tests/run_eval.sh
```

---

## Setup & Deploy

### Prerequisites
- Cloudflare account on Paid plan (Workers AI + Vectorize + Durable Objects require paid)
- `wrangler` CLI authenticated

### 1. Provision resources

```bash
# KV namespaces
wrangler kv namespace create RATE_LIMIT_KV
wrangler kv namespace create USER_MEMORY_KV

# D1 database
wrangler d1 create se-intel-portfolio-db

# Vectorize index (768 dims, cosine)
wrangler vectorize create se-intel-portfolio-kb --dimensions=768 --metric=cosine
```

Update the IDs returned from each command into `wrangler.toml`.

### 2. Deploy

```bash
npm install
wrangler secret put JWT_SECRET   # any strong random string
wrangler deploy
```

### 3. Apply D1 schema

```bash
wrangler d1 execute se-intel-portfolio-db --file=schema.sql --remote
```

### 4. Seed the knowledge base

```bash
curl -X POST https://<your-worker>.workers.dev/admin/seed \
  -H "Authorization: Bearer <JWT_SECRET>"
```

### 5. Get a test token

```bash
curl -X POST https://<your-worker>.workers.dev/dev/token \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","role":"se","name":"Alice Chen"}'
```

### 6. Chat

```bash
TOKEN="<token from above>"

# Account Intel
curl -X POST https://<your-worker>.workers.dev/api/v1/account \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Research Stripe — tech stack and Cloudflare opportunity","threadId":"demo-001"}'

# Enablement
curl -X POST https://<your-worker>.workers.dev/api/v1/enablement \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"How does Workers compare to Lambda? Handle the vendor lock-in objection.","threadId":"demo-002"}'
```

---

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | — | Chat UI |
| `GET` | `/health` | — | Service health |
| `POST` | `/api/v1/account` | JWT | AccountIntelAgent (JSON) |
| `POST` | `/api/v1/account/stream` | JWT | AccountIntelAgent (SSE) |
| `POST` | `/api/v1/enablement` | JWT | EnablementAgent (JSON) |
| `POST` | `/api/v1/enablement/stream` | JWT | EnablementAgent (SSE) |
| `GET` | `/api/v1/history/:agent` | JWT | Conversation history |
| `GET` | `/api/v1/memory` | JWT | Stored LTM facts for this user |
| `POST` | `/dev/token` | — | Get test JWT (portfolio only) |
| `POST` | `/admin/seed` | Bearer secret | Seed Vectorize KB |
| `GET` | `/admin/seed/status` | — | Verify KB is seeded |

**SSE event format:**
```
data: {"type":"tools","toolsUsed":["kb_search"]}
data: {"type":"token","text":"Workers uses V8 isolates"}
data: {"type":"done","latencyMs":5381,"toolsUsed":["kb_search"]}
data: {"type":"error","message":"..."}
```

---

## Cloudflare Products

| Product | How it's used |
|---------|--------------|
| **Workers** | Hono router, JWT auth, rate limiting, SSE stream passthrough |
| **Durable Objects (SQLite)** | One DO per user per agent. Conversation history, serialized request handling |
| **Workers AI** | Llama 3.3 70B (chat + memory extraction + eval judging), BGE-base-en-v1.5 (embeddings) |
| **Vectorize** | 102 vectors, cosine similarity, metadata namespace filtering for RBAC |
| **KV** | Rate limit counters (sliding window), long-term user memory (fact store) |
| **D1** | Audit log — every request with role, tools used, latency, model |

---

## What I'd change

1. **Reranking** — a cross-encoder pass after Vectorize retrieval would improve chunk relevance for short queries against long chunks. Matters at >1,000 chunks.
2. **Extraction prompt** — the memory extractor is too conservative on deal context. Adding explicit examples would improve recall without adding noise.
3. **Conversation reset UI** — a "New conversation" button is 10 lines of JS.
4. **Claude as eval judge** — using the same model as agent and judge introduces self-grading bias. Claude gives cleaner scores.

---

*Built by a Cloudflare Solutions Engineer who got tired of seeing AI demos that never ship.*
