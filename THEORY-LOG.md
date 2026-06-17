# Theory Log — Mastery Track

> One entry per Theory block (45–60m+). Format from `templates/theory-log-entry.md`.
> The **"explain to a customer"** field is interview rehearsal — write it like you're saying it out loud.
> Fill the `← your words` sections yourself. That's the comprehension proof.

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
