# Theory Log — Mastery Track

> One entry per Theory block (45–60m+). Format from `templates/theory-log-entry.md`.
> The **"explain to a customer"** field is interview rehearsal — write it like you're saying it out loud.
> Fill the `← your words` sections yourself. That's the comprehension proof.

---

## Date: 2026-06-18 (Day 5)
## Resource: STUDY.md — Chapter 5: The RAG System
## Time Spent: 60 min
## Topics: embeddings, cosine similarity, BGE-base-en-v1.5, eager tool calling, Vectorize metadata filtering, score thresholds, RAG faithfulness
## Connects to this week's target: Multi-tenancy (Cycle 1 / Week 1) — Week 1 capstone

### Key Insight (one sentence)
RAG has two failure modes that look identical from the outside — retrieval failure (wrong chunks returned) and generation failure (right chunks returned, LLM ignores them) — and you can only distinguish them by testing below the model layer.

### How it connects to what I'm building
Chapter 5 describes the full RAG pipeline: embed the query with BGE-base-en-v1.5 (768 dimensions), query Vectorize across allowed namespaces in parallel, filter by cosine similarity >= 0.5, inject the top 5 chunks as a system message before the user's question. The `orgId` metadata filter I added on Day 2 sits at step 3 — it's an additional `WHERE` clause on the Vectorize query that happens *before* the similarity ranking. A chunk can score 0.95 and still be invisible if its `orgId` doesn't match the caller's org.

The Week 1 capstone proved this end-to-end: `isolation-test.sh` runs all three probes (kb-probe, memory-probe, audit-probe) in sequence and asserts `isolationOk: true` across the board. The test is CI-compatible — `--ci` flag exits 1 on any failure. No LLM in the path.

The connection between Chapter 5's score threshold (0.5) and the BACKLOG faithfulness gap is worth naming: the threshold controls what gets *into* the context window, but nothing controls whether the LLM *uses* what's in the window. The score of 0.5 was tuned through the eval harness — lower thresholds injected noise (groundedness dropped), higher thresholds missed relevant content (hallucination increased). But even at the right threshold, the LLM can still ignore the retrieved content entirely. That's Week 2's problem: a faithfulness eval that checks whether the response actually cites the chunks it was given.

Chapter 5 also explains "eager tool calling" — tools run BEFORE the LLM, not called BY the LLM. This is more predictable: the agent doesn't decide whether to search, it always searches. The trade-off is slightly more latency (tool call even when unnecessary) for much more reliability (KB content is always in context). In the multi-tenancy context, this matters: the `orgId` filter runs on every request, not only when the model decides it should.

> Prompt I used: Chapter 5 describes a 5-step RAG pipeline. Where does the `orgId` metadata filter sit in that pipeline? Then: the chapter explains "eager tool calling" (tools run before the LLM, not called by it). How does that design decision interact with multi-tenancy — what would happen if the LLM decided *when* to search, and could it bypass the orgId filter? Finally: the score threshold is 0.5. What does that control, and what does it NOT control?

### How I'd explain it to a customer / exec (practice out loud)
When your team asks a question, the system does two things in sequence. First, it searches your company's knowledge base for relevant documents — that search is filtered so only your company's documents and shared product information are visible. Second, it feeds those documents to the AI model as context before the model generates its response. The model reads your documents and uses them to answer. The search is always run — the AI doesn't get to decide whether to check your knowledge base. That means the security filter is always applied, on every request, regardless of how the question is phrased. The test we run proves both steps independently: step 1 returns only your documents (proven by the probe), and step 2 is where the AI reads them (measured by the quality evaluation we're building next).

### Tradeoff or open question
The 0.5 cosine similarity threshold is a single number controlling the quality-noise tradeoff for every query across every org. In practice, different orgs may need different thresholds — a legal team's knowledge base might need stricter matching (0.7+) to avoid injecting tangentially related clauses, while a sales team's base might benefit from looser matching (0.4) to surface more competitive context. A per-org or per-namespace threshold is worth exploring but adds configuration surface area. For now, 0.5 works because it was tuned against the eval harness. Week 2's faithfulness eval will tell us whether the threshold is actually the bottleneck or whether the problem is downstream in the generation layer.

---

## Date: 2026-06-18 (Day 4)
## Resource: STUDY.md — Chapter 4: The Rate Limiter
## Time Spent: 60 min
## Topics: sliding window, fixed window, token bucket, KV eventual consistency, per-org rate limiting, D1 vs KV consistency tradeoffs
## Connects to this week's target: Multi-tenancy (Cycle 1 / Week 1)

### Key Insight (one sentence)
The rate limiter is the one remaining layer not scoped to `orgId` — and it should stay that way for now, because the consistency tradeoff that makes KV acceptable for per-user rate limiting (over-count by 1-2 is fine) would be unacceptable for org-level billing or audit, which is why those live in D1.

### How it connects to what I'm building
We picked **sliding window** to prevent **reset gaming** — a user sends 20 requests at 11:59:58, the fixed window resets at 12:00:00, and they send 20 more at 12:00:02. That's 40 requests in 4 seconds against a "20 per minute" limit. Sliding window eliminates that: the window is always the 60 seconds before *this request*, no reset point. The implementation is `Math.floor(Date.now() / 60000)` at `ratelimit.ts:24` — a new bucket number every 60 seconds. The KV key TTL is 120 seconds (two buckets), so old keys auto-delete without a background job.

**Token bucket** was overkill — it's designed for burst traffic where clients send 10 requests at once but average 2/second. SE Intel users send one request and wait for the response. There's no burst pattern to accommodate, so token bucket adds complexity without benefit.

**KV vs D1 — why the split:** KV is eventually consistent. If Request A and Request B both read a count of 19 (limit is 20), and both increment, the count goes to 21 — one request over the limit. KV propagates writes globally within ~100-300ms, so during that window concurrent reads can see stale data. For a rate limiter that's a guardrail (not a billing meter), being wrong by 1-2 requests is acceptable. For a billing API or audit log where over-counting costs money or an auditor needs exact numbers, you'd use a Durable Object counter — guaranteed serial execution, no over-counting possible. That's exactly why the audit log lives in D1 (strongly consistent) and the rate limiter lives in KV (eventually consistent). Different jobs, different consistency guarantees.

Now that every other layer is scoped to `orgId` (DO keys, KV memory keys, Vectorize metadata, D1 audit reads), the rate limiter stands out. It's keyed by `rl:${userId}:${bucket}` — no org prefix. For the current use case (per-user request throttle), that's correct: the rate limit protects the platform from individual user abuse, not from one org outspending another. But the gap worth naming: in a real multi-tenant SaaS, you'd want a *second* rate limit tier — per-org — to prevent one org with 50 users all hitting their individual limits simultaneously from consuming a disproportionate share of compute. That would be a separate counter (`rl-org:${orgId}:${bucket}`) with an aggregate cap. The same eventual-consistency weakness applies — if exact org-level enforcement matters (billing), you'd need a DO counter instead of KV. Logged to BACKLOG.

The role-based limits (AE: 20/min, SE: 30/min, manager: 50/min) connect to the Day 4 audit endpoint: a manager reviewing 10 team members' usage needs more headroom than an AE checking one account. The audit endpoint is the first feature that justifies the manager's higher limit — before today, there was no org-wide read operation.

> Prompt I used: Chapter 4 covers three rate-limiting strategies (fixed window, sliding window, token bucket). Why did we pick sliding window? Then: the rate limiter uses KV, the audit log uses D1. What's the consistency tradeoff that makes that split correct? Finally: the rate limiter is the one layer NOT scoped to `orgId` — should it be, and what would a per-org rate limit look like?

### How I'd explain it to a customer / exec (practice out loud)
Every user in the system has a per-minute request limit based on their role — an account executive gets 20 requests per minute, a sales manager gets 50. That protects the platform from runaway usage. But the audit log is the receipt — it tells you exactly what each person and each organization did, when, and with which tools. The audit data is strongly consistent, meaning the numbers are always exact, not "eventually correct." That matters when you're showing usage reports to a VP or responding to a compliance audit. The rate limit is a guardrail; the audit log is the paper trail. Different jobs, different storage, different consistency guarantees.

### Tradeoff or open question
The rate limiter is currently per-user only. In a real multi-tenant deployment, you'd want a per-org tier too — preventing one organization from consuming a disproportionate share of compute by having 50 users all hitting their individual limits simultaneously. That would be a second KV counter (`rl-org:${orgId}:${bucket}`) with an aggregate cap. The eventual-consistency weakness applies at the org tier too: two users in the same org could both read the same org-level count and both succeed when the org as a whole should be throttled. If exact enforcement matters at the org level (e.g. billing), you'd need a Durable Object counter instead of KV. Logged to BACKLOG.

---

## Date: 2026-06-17
## Resource: STUDY.md — Chapter 3: The Auth System
## Time Spent: 60 min
## Topics: JWT, HS256, WebCrypto, defense in depth, orgId claim enforcement, Zero Trust layering, orphaned DOs
## Connects to this week's target: Multi-tenancy (Cycle 1 / Week 1)

### Key Insight (one sentence)
A JWT claim only becomes an isolation guarantee when the storage layer enforces it — `orgId` was in the token since Day 1, but isolation wasn't real until Day 3 baked it into the DO key and KV prefix.

### How it connects to what I'm building
Chapter 3 draws the defense-in-depth stack: Cloudflare Access validates identity at the network edge before your code runs, the Worker middleware re-verifies the JWT and extracts claims into `UserContext`, the tool layer re-checks role against allowed namespaces, and now — after Day 3 — the storage layer bakes `orgId` into the address itself. `idFromName(`${orgId}:${userId}`)` at `index.ts:175` means the DO for `acme:alice` is a physically separate instance from `portfolio-org:alice`. KV keys at `long-term.ts:53` are `ltm:${orgId}:${userId}:__index` — no code path can accidentally resolve one org's key to another org's data.

This is Zero Trust applied vertically through the stack, not just horizontally at the network edge. Each layer is independent — a bypass at layer 2 (JWT middleware) doesn't compromise layer 5 (storage key). Day 3 completed that stack. Before it, `orgId` flowed through the system as a claim that was logged but not enforced at the deepest layer. Now it's structural.

The other Chapter 3 concept that hit differently today: the two auth paths (Cloudflare Access for production, self-issued HS256 for portfolio). In production, the user never touches the JWT — Access injects `cf-access-jwt-assertion` automatically after SSO. The user authenticates via Google/Okta and Access handles the rest. In portfolio mode, the user POSTs to `/dev/token` with their userId, role, and orgId, and the Worker signs a token with `JWT_SECRET` via WebCrypto. Both paths produce the same `UserContext`. Everything downstream is identical — that's the design that lets the same codebase run in both environments.

> Prompt I used: Chapter 3 covers two auth paths (Access vs self-issued JWT). How does `orgId` get into the token in each path? Then: Chapter 3's defense-in-depth pattern is router (identity) → tool (authorization). Day 3 added a third layer — the storage key itself. Walk through the full stack and explain what each layer independently guarantees. Finally: what happens to the old DO instances keyed by `userId` alone after you change to `orgId:userId`?

### How I'd explain it to a customer / exec (practice out loud)
We don't just check your organization ID at the front door — we bake it into every storage address in the system. Your conversation history and memory live at a different physical address than any other company's, even if two people happen to have the same username. There's no code path that could accidentally hand you someone else's data because the addresses themselves are different. And every request goes through five independent checkpoints — network edge authentication, token verification, rate limiting, permission checks on each data source, and the storage address itself. A failure at any single layer doesn't compromise the others. That's the Zero Trust model applied all the way down to the storage layer.

### Tradeoff or open question
Changing the DO key scheme from `userId` to `orgId:userId` is a one-way door. The old DO instances — keyed by `userId` alone — are orphaned. They still exist in Cloudflare's infrastructure, but no code ever routes to them again. They hibernate at $0 and eventually get garbage collected. In a portfolio context, that's fine — we lose demo conversation history. In production, this would require a migration plan: either read all old DOs and backfill to the new key scheme before deploying, or run both schemes in parallel (check new key first, fall back to old, backfill on hit). The lesson: **key scheme decisions are architectural commitments.** Get them right before you have user data you can't afford to orphan. This is the kind of decision that's easy to make on Day 3 of a project and expensive to make on Day 300.

---

## Date: 2026-06-16
## Resource: STUDY.md — Chapter 2: The Runtime: Workers and Durable Objects
## Time Spent: 60 min
## Topics: V8 isolates, Durable Objects, embedded SQLite, race conditions, single-threaded execution, two-layer isolation model
## Connects to this week's target: Multi-tenancy (Cycle 1 / Week 1)

### Key Insight (one sentence)
DO isolation and Vectorize metadata filtering are two different isolation layers operating at two different scopes — DOs give you user-level physical isolation, the `orgId` filter gives you org-level logical isolation, and Day 2's build closed the gap between them.

### How it connects to what I'm building
Chapter 2's race condition diagram (Request A reads → Request B reads → B overwrites A's message) is the exact problem the DO's single-threaded execution solves for conversation history. But that same guarantee only covers user-level data — the Durable Object for Alice is separate from Bob's, but both Alice (acme) and Charlie (portfolio-org) shared the *same* Vectorize index until Day 2.

The filter at `kb-search.ts:94` is the org-level equivalent of `idFromName(userId)` — it draws a boundary at the org layer that the DO boundary doesn't reach. Before Day 2, the DO guaranteed Alice's chat history couldn't bleed into Charlie's, but Alice's org's KB chunks *could* surface in Charlie's org's RAG results because Vectorize had no `orgId` metadata.

Day 2 closed that gap. The `/admin/kb-probe` endpoint is the deterministic proof: it bypasses the LLM entirely and directly asserts `isolationOk=true` for both orgs. The DO model is physical and can't be misconfigured; the Vectorize filter is logical and depends on correct metadata at seed time — that asymmetry is worth naming in a customer conversation.

> Prompt I used: Chapter 2's DO isolation diagram — "each user gets their own SQLite database, not a filtered view of a shared one." How does that physical isolation at the user level compare to the logical isolation we added at the org level in Day 2? Where is each boundary enforced in code, and what could break each one?

### How I'd explain it to a customer / exec (practice out loud)
When a prospect asks "is my data isolated from other customers?" the honest answer has two parts and most vendors only give you one. First, every user in our system gets their own database — not a WHERE clause filtering a shared table, but a physically separate SQLite instance that only that user's requests ever touch. That solves the race condition problem and the cross-user bleed problem in one move. Second, your company's knowledge base documents are tagged with your organization ID when they're uploaded and filtered at query time — another company's internal documents are invisible to your searches even if they happen to be semantically similar to your query. Two locks on two different doors. The first lock is architectural and can't be bypassed. The second lock depends on correct tagging at upload time, which is why we have a deterministic test that proves isolation without involving the AI at all.

### Tradeoff or open question
The DO boundary is physical — `idFromName(userId)` routes to a completely separate isolate and SQLite. It's impossible to misconfigure your way into cross-user leakage at that layer. The `orgId` metadata filter is logical — it's enforced at query time by the application code in `kb-search.ts`. That means it's only as strong as the seed data. If a chunk is seeded with the wrong `orgId` (or no `orgId`), it leaks across org boundaries silently. This is the correct risk to call out in an architecture review: the stronger isolation is at the user layer, the weaker isolation is at the org/KB layer. Mitigations: seed validation in CI, the `/admin/kb-probe` regression test, and the upcoming eval harness (Week 2) which can catch faithfulness regressions that might mask isolation failures — exactly like the hallucination that masked our isolation test on Day 2.

---

## Date: 2026-06-15
## Resource: Anthropic — "Building Effective Agents" (https://www.anthropic.com/research/building-effective-agents)
## Time Spent: ___ min
## Topics: agents, workflows, tool use, orchestration, multi-tenancy
## Connects to this week's target: Multi-tenancy (Cycle 1 / Week 1)

### Key Insight (one sentence)
Agents are complex tools. When putting things into practice, you should aim for simplicitiy with workflows, which is more of a guided LLM until an open ended problem requries an AI agent. 

### How it connects to what I'm building
I'm building SE Intel — role-specific agents (AE, SE, CSM) that do RAG on internal knowledge and competitive vector search. My instinct was to call this "open-ended," but reading the code honestly: `dispatchTools` (`agents/account-intel.ts:134`) is actually a **workflow**, not an agent — it routes to tools using keyword matching (`TECH_STACK_KEYWORDS`, `NEWS_TRIGGERS`) and if/else, so the *code* picks the tools, not the model. Per Anthropic, that's the right call: I'm not paying for agent autonomy I don't need. The orchestrator-that-delegates-in-parallel I described would be the *agentic* version — worth reaching for only if routing becomes too open-ended for deterministic rules.

The second connection is the important one for this week: the tool boundary is also *where* I enforce `orgId` isolation — inside the tool (`kbSearch`), never by trusting the model or the system prompt. A model can be jailbroken or confused; a filter in code is deterministic. That's why Day 2's tenant filter lives in the tool, not the prompt.
> Prompt: Anthropic separates **"workflows"** (predefined code paths) from **"agents"** (the model dynamically directs its own tool use). Look at `se-intel`'s `dispatchTools` (`agents/account-intel.ts:134`) — is that a workflow or an agent, and why? Then: the post stresses keeping the agent–tool boundary simple and well-scoped. How does that boundary relate to *where* you enforce `orgId` isolation (the tool, vs the model)?

### How I'd explain it to a customer / exec (practice out loud)
As compnaies are implementing these LLM's to augment their jobs, there should be an architectural person in charge of guiding them through it. Because if they are using the wrong AI agents for simple input output prompts, then thats an overengineered solution. and designing the proper workflow strategies for their LLM's will garner quicker, more accurate results. Its a new age, and having someone help design these systems for cost and efficiency is paramount.

### Tradeoff or open question
Whats the cost of doing nothing? how do i estimate time savings for these LLM's into something like ablue collar industry that barely has a website? what does an effective customer for this look like? they need a CRM? digital presenence? what is not a good customer profile? how do you land and expand within a customer if i was starting from square one? start with one workflow, optimize then expand?
