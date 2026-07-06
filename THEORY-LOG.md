# Theory Log — Mastery Track

> One entry per Theory block (45–60m+). Format from `templates/theory-log-entry.md`.
> The **"explain to a customer"** field is interview rehearsal — write it like you're saying it out loud.
> Fill the `← your words` sections yourself. That's the comprehension proof.

---

## Date: 2026-07-06
## Resource: Google SRE Book — "Embracing Risk" / error budgets (https://sre.google/sre-book/embracing-risk/) + STUDY.md — Chapter 12: Observability, SLOs, and the Health Scorecard
## Time Spent: 45 min
## Topics: SLO calibration, error budgets as a "cry wolf" problem, dependency-ordered probes, test drift vs regression
## Connects to this week's target: Observability + SLOs + Account-Health Scorecard (Cycle 1 / Week 3) — closing the loop

### Key Insight (one sentence)
An SLO is only useful if it's occasionally achievable — a target set from a guess instead of measurement either fails permanently (and gets ignored) or passes trivially (and hides nothing), and the fix for both is the same: measure real traffic before you commit to a number.

### How it connects to what I'm building
The 06-26 entry in this log covers the SLI/SLO/SLA framework and the SQLite percentile
mechanics while the target was still the original guess (`P95_LATENCY_MS: 8000`, verified
live at `requestCount: 1`). What happened next, once real 70B+RAG traffic hit it, is the
part worth logging on its own: both orgs came back `p95=13118ms` and `p95=11737ms` —
both "failing" a target that was never based on anything real. The SRE book's framing of
error budgets assumes the SLO itself is trustworthy; a target that's aspirational rather
than measured breaks that assumption before you even get to the budget math. We
recalibrated to 15000ms with the before/after numbers written into the code comment
(`metrics.ts:20-32`) and into `CYCLE-1-WEEK-3-observability-slos.md`, plus a named
improvement roadmap (KB answer caching, lower `max_tokens`, route simple queries to an
8B model) so the new number isn't just a higher guess — it's a baseline with a plan.

**Second insight, found while re-verifying today, not during the original build:**
`tests/isolation-test.sh` (Week 1's capstone probe) started failing 3/3 today —
`isolationOk: null`, `"Unauthorized — access via se-intel.macksportreport.com"`. Root
cause: a global Cloudflare Access JWT guard was added to `index.ts` (`app.use("*", ...)`
at `index.ts:46-63`) at some point after the Week 1 script was written, and it checks
for the mere *presence* of a `CF-Access-Jwt-Assertion` header on every route. `health-probe.sh`
already sends a dummy value for that header (`-H "CF-Access-Jwt-Assertion: probe"`) to get
through the gate on the raw workers.dev URL; `isolation-test.sh`'s `run_probe()` never got
the same header added. This is not a security regression — the isolation logic itself is
untouched and passes once the header is added — it's **test drift**: a shared middleware
change silently broke an older script that didn't know about it. Same category of bug as
the Week 1/2 lesson (don't trust a test that can be silently invalidated), just at the
harness layer instead of the application layer.

### How I'd explain it to a customer / exec (practice out loud)
We don't set reliability targets by guessing and hoping. We shipped a target, ran it
against real usage, and found out it was wrong — the system was actually about 60% slower
than we'd committed to. Instead of quietly lowering our own bar or leaving a dashboard that
would always show red, we published the real numbers, set a new target based on what the
architecture actually does — a large model doing retrieval and generation in one request —
and wrote down three concrete ways we plan to bring that number down over time. A target
you can't hit isn't a target, it's decoration. And separately: when we went to re-verify
our isolation guarantees today, the test script itself had rotted — a security header
requirement got added elsewhere in the app and the old test didn't know about it. We
caught it immediately because the probe is deterministic, fixed the script in five minutes,
and reconfirmed all three isolation layers are still intact. The lesson we keep relearning
is the same one: tests have to be revisited every time the surrounding system changes, not
just written once and trusted forever.

### Tradeoff or open question
The isolation-test.sh drift raises a real process question: how do you catch "a shared
middleware change broke an unrelated test" *before* someone manually re-runs it weeks
later? The honest answer right now is "you don't, unless it's in CI." `faithfulness.py --ci`
and `health-probe.sh --ci` both already exist as gate-able scripts — `isolation-test.sh
--ci` does too, but none of these run automatically on every deploy yet, so this exact
kind of drift can sit undetected for an arbitrary amount of time. That's the natural
next step once Cycle 1 closes: wire all three probes into an actual CI pipeline
(GitHub Actions on push to `main`) instead of relying on remembering to run them by hand.

---

## Date: 2026-06-26
## Resource: Google SRE Book — "Service Level Objectives" (https://sre.google/sre-book/service-level-objectives/) + STUDY.md — Chapter 10: Failure Modes and Trade-offs
## Time Spent: 60 min
## Topics: SLOs, SLIs, SLAs, error budgets, p95 latency, observability, metrics vs logs, D1 time-series
## Connects to this week's target: Observability + SLOs + Account-Health Scorecard (Cycle 1 / Week 3)

### Key Insight (one sentence)
An SLO without an error budget is just a target — the error budget is what makes it operational, because it tells you how much you can afford to break before you have to stop shipping.

### How it connects to what I'm building

**The SLI/SLO/SLA stack:** The SRE book defines three levels. An SLI (Service Level Indicator) is the raw measurement — p95 latency in milliseconds, error rate as a percentage. An SLO is the target we commit to internally — p95 < 8000ms, error rate < 5%. An SLA is the external contract with a customer — what happens if we breach. We built SLIs and SLOs. We don't have an SLA yet because this is a portfolio system, but the architecture is ready for it.

**Where each piece lives in the code:**
- SLIs are emitted by `writeMetric()` in `src/observability/metrics.ts` — one row per request, `latency_ms` and `status` are the raw measurements.
- SLOs are constants in `SLO` at `metrics.ts:17-21` — `P95_LATENCY_MS: 8000`, `ERROR_RATE_PCT: 5`. Evaluated at query time in `getOrgHealth()`, never hardcoded into the data.
- Error budget is calculated live: `((SLO.ERROR_RATE_PCT - errorRatePct) / SLO.ERROR_RATE_PCT) * 100`. At 0% error rate, 100% budget remains. At 5% error rate, 0% budget remains — breach.

**Why `state.waitUntil()` for metric writes:** The DO returns a Response the moment the LLM finishes. If we `await writeMetric()` before returning, we add D1 write latency (~5ms) to every response. `state.waitUntil()` tells the runtime "keep this isolate alive after the Response is sent, until this promise settles." The user gets their response immediately. The metric write happens in the background. Same pattern as the audit log — both are non-blocking.

**Why separate from `audit_log`:** The audit log carries PII — `message_preview`, `role`, `user_id`. It's write-once, append-only, read by compliance/managers. The metrics table carries no PII — just latency, status, agent type, org. It's optimised for time-series aggregation: `ORDER BY latency_ms ASC` for percentiles, `GROUP BY agent_type` for breakdown. Two different jobs, two different tables. Same pattern as the rate limiter (KV) vs audit log (D1) split in Week 1.

**The SQLite percentile problem:** SQLite has no native `PERCENTILE_CONT()` function. The first implementation used a nested subquery with `COUNT(*)` inside — which refers to the subquery's own row count, not the outer query's. This caused a 500 on first run. The fix: fetch sorted latencies into the runtime and slice at the target rank in TypeScript. `latencies[Math.floor(latencies.length * 0.95)]`. Simple, correct for small windows, and avoids another D1 round trip. The weakness: at 100k+ rows, fetching all latencies into memory is expensive. At that scale, you'd pre-aggregate into hourly buckets or use a real time-series store.

**The `isManager` scoping pattern:** `/api/v1/health` follows the exact same pattern as `/api/v1/audit`. `orgId` comes from the JWT, never from the request. `isManager` determines whether we pass `orgId` as the filter or `null` (all orgs). The filter is applied inside `getOrgHealth()` — the route handler never constructs a SQL query directly. Same defense-in-depth principle as the KB namespace filter in Week 1.

**VERIFY results (confirmed live):**
```json
{
  "requestCount": 1,
  "p95LatencyMs": 6536,
  "slos": {
    "latency": { "targetMs": 8000, "p95Ms": 6536, "passing": true },
    "errorRate": { "targetPct": 5, "actualPct": 0, "passing": true }
  },
  "errorBudgetRemainingPct": 100
}
```
Both `/api/v1/health` (self-service, SE role, own org) and `/admin/health-scorecard` (bearer-protected, all orgs) return correct data. SLOs passing. Error budget at 100%.

> **Prompt I used (COMPREHEND checkpoints — walk these cold, chat closed):**
> 1. `src/observability/metrics.ts` — Why is `writeMetric()` a standalone function and not a method on the agent? Why does `getOrgHealth()` loop per-org instead of one big query? What does the SQLite percentile approximation actually do — and what's its weakness?
> 2. `src/agents/base-agent.ts` — Why `state.waitUntil()` and not just `await`? Why does `handleChat` use `capturedChunks?.length` for `kbChunksUsed` but `handleStream` uses `toolCalls.filter()`? Is that a tradeoff or a gap?
> 3. `src/index.ts` — `/api/v1/health` — Why does `isManager` determine the `orgFilter`? Trace exactly where `orgId` comes from. What happens if `request_metrics` is empty?
> 4. `schema.sql` — Why is `request_metrics` separate from `audit_log`? What do the three indexes cover and why those specific columns?

### How I'd explain it to a customer / exec (practice out loud)
← YOUR WORDS: Say this out loud, then write what you actually said.

Every time someone uses the system, we record two things silently in the background: how long the response took, and whether it succeeded. Those measurements feed a live scorecard that tells us — and you — whether the system is meeting its targets. We've set two targets: responses should complete in under 8 seconds at the 95th percentile, and fewer than 5% of requests should fail. The scorecard shows you your remaining "error budget" — basically, how close you are to the limit before we have a problem. Right now it's at 100% because nothing has failed. When it drops below 20%, that's the signal to stop shipping new features and fix stability instead. This is how Google runs their infrastructure, and it's how we've built SE Intel.

### Tradeoff or open question
← YOUR WORDS: What didn't fully make sense yet? What's the cost of this approach?

The percentile calculation fetches all latency rows into memory and slices in TypeScript. That's fine at 1 request. At 10,000 requests in a 24-hour window, you're pulling 10,000 rows across the wire from D1 just to compute a p95. The SRE book covers this — the standard fix is pre-aggregation into time buckets (hourly rollups) so the query always touches a bounded number of rows regardless of traffic. We haven't built that yet. The open question: at what request volume does the naive approach break down, and should we add hourly rollups to the metrics table as a Cycle 2 target?

---

## Date: 2026-06-22
## Resource: Chip Huyen — *AI Engineering* Ch.3-4 ("Evaluation and Monitoring") + STUDY.md — Chapter 8: The Evaluation Harness
## Time Spent: 70 min
## Topics: deterministic checks, LLM-as-judge, model-graded evals, faithfulness, regression testing, rubric scaling, self-grading bias
## Connects to this week's target: Evals as a CI gate (Cycle 1 / Week 2)

### Key Insight (one sentence)
Deterministic checks catch facts that appear or don't appear; LLM judges catch quality that requires semantic understanding — and the biggest mistake in eval design is using a judge where a string check would suffice.

### How it connects to what I'm building
STUDY.md Chapter 8 describes the four scoring dimensions (groundedness, relevance, role-appropriateness, actionability) and the three-script pipeline (runner → judge → report). Chip Huyen Chapter 3 adds the taxonomy I needed: deterministic checks are for objective criteria, model-graded evals are for subjective criteria, and human review is for ground truth. Chapter 4 adds the pipeline concept: evals run on every prompt change, not just before release.

**Where `faithfulness.py` sits in the taxonomy:** It is a deterministic check, not a model-graded eval. It does not call an LLM. It checks whether specific strings (the facts retrieved from the KB) appear in the response. If "WinterCG" was retrieved and "WinterCG" is not in the response, that's a grounding_fail — no model needed to judge that. This is exactly what Chip Huyen prescribes: "use deterministic checks when you can." The speed is milliseconds, the cost is zero, and it cannot be gaslit by the same LLM it's evaluating.

**Where `judge.py` adds value:** The judge handles dimensions that require semantic interpretation. "Is this response appropriate for a sales manager?" requires understanding business context, role expectations, and tone. A string check can't evaluate that. The judge's 5th dimension (faithfulness) now sees the retrieved chunks, so it can penalize the model for ignoring a specific fact even when the response is otherwise coherent. But the judge is slower (one LLM call per case), costs tokens, and carries self-grading bias.

**The self-grading bias problem:** The agent and the judge both use Llama 3.3 70B. The judge recognizes the agent's output style as natural and gives it higher scores than an independent evaluator would. Chip Huyen's fix: use a different model as judge (Claude via Anthropic API). I documented this as a known limitation in the harness README. For the portfolio, the bias is acceptable because the trend matters more than the absolute score — 67% → 73% → 87% is a real improvement regardless of the judge's optimism.

**Rubric scaling:** The 15 hand-written rubrics in `cases/*.json` don't scale. Chip Huyen Chapter 4 describes the eval pyramid: deterministic checks at the bottom (infinite scale, zero cost), LLM-synthesized rubrics in the middle, human review at the top. The four patterns I documented in the build notes (rubric synthesis, gold set, active learning, behavioral contracts) all come from Chapter 4's framework. The "one rule that prevents eval debt" — every new feature ships with at least one eval case — is the operational discipline that makes the pyramid work.

**The fth-003 bug as validation:** The deterministic gate caught a real flaky bug on first run. The model was handed the "WinterCG" chunk but cited it only ~50% of runs. A judge might have missed this — it would see a coherent response about lock-in and score it "good enough." The string check saw "WinterCG" was retrieved but absent, flagged a grounding_fail, and blocked the CI gate. That is the exact separation of concerns Chip Huyen describes: deterministic for facts, judge for nuance.

**Interview question this answers:** "How do you measure LLM quality?" — Two layers. A deterministic check proves whether specific facts from the knowledge base appear in the response (grounding). An LLM-as-judge scores four semantic dimensions (relevance, role-appropriateness, actionability, faithfulness) on a rubric. The deterministic gate blocks deploy on factual errors; the judge provides a trend signal for quality over time. Score progression: 67% → 73% → 87% across three iterations, each driven by a prompt fix identified by the harness.

> Prompt I used: Chip Huyen Ch.3 covers three eval types — deterministic checks, model-graded evals, human evaluation. Which one is `faithfulness.py` and which is `judge.py`? Then Ch.4 covers systematic pipelines: what is the "eval pyramid" and where does each of our components sit? Finally: what is self-grading bias, and why did the deterministic gate catch the fth-003 flaky bug when the judge might have missed it?

### How I'd explain it to a customer / exec (practice out loud)
Most AI demos look good until they don't — and by then you've already told a customer something wrong. The way we prevent that is with two testing layers that run before any change goes live. The first one is completely mechanical: we check whether the specific facts our retrieval system found actually made it into the response. If our knowledge base says the discount is 35% and the AI says 25%, that gets caught in milliseconds — no interpretation, no judgment, just a string that's either there or it isn't. The second layer uses another AI to score the response on quality: was it relevant, was it the right depth for the person asking, could a rep actually use it in a call? The first layer blocks bad deploys before they happen. The second layer tells us if quality is drifting over time. Together they answer the question you always get after a demo: "That looks great — but how do we know it keeps working?"

### Tradeoff or open question
The self-grading bias is the thing I'm still sitting with. We're using the same model to generate answers and to judge them — Llama 3.3 70B grading Llama 3.3 70B. The judge is going to be more forgiving of responses that sound like things it would say. The fix is obvious (use Claude or GPT-4o as the judge — a different model applies different standards), but it adds a real cost: every eval run would require an Anthropic API call instead of a free Workers AI call. At 15 cases that's negligible. At 500 it matters. The open question for me is: at what scale does self-grading bias actually show up as a problem in practice — do the 87% pass rates hold up when I swap in a stricter judge, or does the score drop and reveal that I've been measuring against a lenient baseline the whole time?

---

## Date: 2026-06-18 (Day 5)
## Resource: STUDY.md — Chapter 5: The RAG System
## Time Spent: 60 min
## Topics: embeddings, cosine similarity, BGE-base-en-v1.5, eager tool calling, Vectorize metadata filtering, score thresholds, RAG faithfulness
## Connects to this week's target: Multi-tenancy (Cycle 1 / Week 1) — Week 1 capstone

### Key Insight (one sentence)
RAG has two failure modes that look identical from the outside — retrieval failure (wrong chunks returned) and generation failure (right chunks returned, LLM ignores them) — and you can only distinguish them by testing below the model layer.

### How it connects to what I'm building
Chapter 5 describes a 5-step RAG pipeline: (1) check role → allowed namespaces, (2) embed the query → 768-dimensional vector, (3) query Vectorize, (4) filter by cosine similarity >= 0.5, (5) format and inject into LLM context.

**Where the `orgId` filter sits:** Step 3 — the Vectorize query itself. It's not a post-retrieval filter that discards wrong-org results after they come back. It's a `WHERE` clause *inside the database* that excludes other orgs' chunks from the search entirely. Vectorize never returns them. They never leave storage. A chunk can score 0.95 and still be invisible if its `orgId` doesn't match the caller's. That's stronger than filtering results — the data never crosses the boundary.

**What the 0.5 threshold controls and doesn't control:** The threshold gates what gets *into* the context window — chunks below 0.5 are discarded, chunks above are injected as a system message. All surviving chunks are visible to the LLM. But the threshold does NOT control whether the LLM actually *uses* what's in the window. The LLM can read 5 perfectly relevant chunks and still ignore them — that's the faithfulness gap from Day 2 (chunk said 35%, LLM answered 25%). The threshold gates the input; nothing currently gates the output. That's what Week 2's faithfulness eval will fix.

**Why eager tool calling is a security property, not just a performance choice:** "Eager" means tools run BEFORE the LLM, on every request — the code decides to search, not the model. If the LLM decided *when* to search (like OpenAI function calling), a prompt injection could convince the model to skip the search entirely, or worse, to call the search with a fabricated `orgId` parameter. With eager calling, the search always runs and the `orgId` always comes from the JWT, never from the model. The model has no say in whether isolation is enforced. The trade-off is slightly more latency (tool call even when unnecessary), but the security guarantee is worth it: the `orgId` filter runs on every request, unconditionally.

The Week 1 capstone proved this end-to-end: `isolation-test.sh` runs all three probes in sequence and asserts `isolationOk: true` across the board. CI-compatible — `--ci` flag exits 1 on any failure. No LLM in the test path.

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
