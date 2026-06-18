# Cycle 1 · Week 1 — Multi-tenancy

> **Target:** Make `orgId` a real isolation boundary across **RAG, memory, and audit**.
> **Why it matters (interview):** "How do you keep Customer A's data from leaking to Customer B?" is THE enterprise question. Right now `orgId` exists in `UserContext` but nothing enforces it.
> **Done when:** A user in `org-a` provably cannot read RAG chunks, memory, or audit rows belonging to `org-b` — and a test proves it.

---

## The current gap (verified in code)

- `src/auth/context.ts` → builds `UserContext` **with `orgId`**, but it's never used downstream.
- `src/tools/kb-search.ts` → `kbSearch()` filters Vectorize by **role namespace only**, not by org.
- `src/memory/short-term.ts` / `long-term.ts` → keyed by **`userId`** — no org scoping.
- audit (`writeAudit` in `src/index.ts`) → no `org_id` column / filter.

## Tasks (work top to bottom — this is your daily BUILD pointer)

### Day 1 — Thread orgId through the request path  ✅ (code done 2026-06-15)
- [x] Confirm every agent call receives `orgId` from `UserContext`. **Traced:** Worker (`index.ts`) passes full `userContext` into each DO body → `BaseAgent.dispatchTools(message, userContext, toolCalls)` → tools. `orgId` was present end-to-end but unused below the agent.
- [x] Add `orgId` to the `ToolCall` audit shape so every tool logs which org it ran for. **Done:** added `orgId` to `ToolCall` (types/index.ts); threaded `orgId` param into `kbSearch`, `webSearch` (+ its kb fallback), `fetchNews`; stamped on every `toolCalls.push`; passed `userContext.orgId` at all agent call-sites. `npx tsc --noEmit` green.
- [ ] **(your Theory block)** Write the theory-log entry: Anthropic *Building Effective Agents*. Note how isolation relates to the agent/tool boundary.

> **Finding (adjusts Day 4):** audit *writes* already include `org_id` — `AuditEvent.orgId` is set and the D1 INSERT in `base-agent.ts` already binds `org_id`. So Day 4 is **not** "add org_id to writeAudit"; it's only the **scoped READ** query (prove an org-filtered read can't return other orgs' rows).
>
> **Finding (sharpens Day 2):** RAG shares chunks across all orgs — `kbSearch` filters Vectorize by `{ namespace }` (role tier) only. Day 2 plan: add `orgId` to chunk metadata, filter `namespace = ns AND orgId ∈ [userOrg, "global"]` (global sentinel = shared product docs), create a Vectorize **metadata index** on `orgId`, and re-seed. `kbSearch` already receives `orgId` now, so Day 2 is filter + seed only.

### Day 2 — Isolate RAG by org

> **🧭 DIRECT — decide before any code:**
> **Q: How do you isolate RAG by tenant?**
> - **Option A — metadata filter on one shared index** + `"global"` sentinel org for shared product docs. Filter `namespace = ns AND orgId ∈ [userOrg, "global"]`. Simple ops, one index; risk = noisy-neighbor query cost at high tenant counts.
> - **Option B — index-per-org.** Hard isolation, no shared-index risk; ops cost = N indexes to manage/seed, and shared product docs must be duplicated per org.
> - **Option C — separate Vectorize namespace per org.** Middle ground; namespaces are already used for role tiers, so you'd be overloading that mechanism.
>
> **Your call + why (write it here before building): __________**

**🧭 DECISION (locked):** Option A — metadata filter on shared index, least privilege, `"global"` sentinel. Rationale: each tenant gets own data + universal docs, nothing else.

- [x] **COMPREHEND/BUILD:** `kb-search.ts:94` now filters `{ namespace, orgId: { $in: [orgId, "global"] } }`. Refactored into `kbSearchRaw` (structured, testable) + `kbSearch` (formats/audits).
- [x] Created **two** Vectorize metadata indexes (`orgId` AND `namespace`) — *finding:* none existed before, so the prior role-namespace filter wasn't actually enforced at the data layer. Both live now.
- [x] Re-seed: existing 102 chunks tagged `orgId: "global"`; added 3 `orgId: "acme"` private chunks. Total 105 seeded, 0 errors.
- [x] **VERIFY (deterministic):** added `/admin/kb-probe` (runs real retrieval, no LLM). **acme** → gets its 35% chunk + global, `isolationOk:true`. **portfolio-org** → only global, acme chunk filtered out despite being top-scored, `isolationOk:true, leakedChunks:0`. **Isolation proven.**

> **⚠️ Secondary finding (NOT isolation — log for evals/Cycle 2):** the LLM does not faithfully ground in retrieved chunks — acme's chunk says 35% but the agent answered "25%", and portfolio-org (no chunk) hallucinated "27%". RAG *retrieval* is correct; RAG *faithfulness* is not. Target for Week 2 evals + Cycle 2 retrieval-quality work.

> **Each day below: lead with the 🧭 DIRECT decision, then COMPREHEND the diff, then VERIFY. No build before the call.**

### Day 3 — Isolate memory by org  ✅ (code done 2026-06-17)

> **🧭 DECISION (locked):** Option B — DO key becomes `orgId:userId` (full physical isolation per org). LTM KV keys become `ltm:{orgId}:{userId}:{factId}`. Rationale: in production, `alice@acme` and `alice@portfolio-org` are different people; the DO and KV boundaries should reflect the tenant, not just the username. Trade-off: changes DO IDs, which means existing conversation history is orphaned (acceptable — portfolio demo data, not production).

- [x] **Short-term:** DO `idFromName()` now uses `${orgId}:${userId}` across all 7 call sites in `index.ts`. Each org+user combo gets a physically separate DO instance and SQLite.
- [x] **Long-term:** `LongTermMemory` constructor takes `orgId` as second param. KV keys changed from `ltm:{userId}:{factId}` to `ltm:{orgId}:{userId}:{factId}`. All 5 call sites updated (`base-agent.ts` ×4, `index.ts` ×1).
- [x] **VERIFY (deterministic):** added `/admin/memory-probe` — writes a test fact as orgA/user, reads as orgB/user, asserts 0 leaked facts, then cleans up. **Result: `isolationOk: true`** — orgA reads its fact, orgB sees nothing. KB probe regression check also passes (`isolationOk: true` for both orgs).

### Day 4 — Isolate audit by org  ✅ (code done 2026-06-18)

> **Finding confirmed:** `org_id` column, index, and INSERT binding already existed since Day 1. Day 4 is read-only — the enforcement gap was on the *query* side, not the *write* side.

- [x] **`GET /api/v1/audit`** — user-accessible, org-scoped, role-split read. `orgId` comes from the JWT (never from the request). `sales_manager` sees all rows for their org (`scope: "org"`); everyone else sees only their own rows (`scope: "own"`, adds `AND user_id = ?`). Optional `agentType` filter. Tested: manager sees 5 org-wide rows, SE sees 0 own rows (fresh DO keys).
- [x] **`POST /admin/audit-probe`** — deterministic isolation test. Counts rows per org, then fetches orgA's most recent row ID and confirms orgB's scoped query cannot return it. **Result: `isolationOk: true`, `crossOrgLeaked: 0`**. All three probes pass (KB + memory + audit).

### Day 5 — Prove it + publish  ✅ (done 2026-06-18)

- [x] **`tests/isolation-test.sh`** — end-to-end isolation test. Calls all 3 admin probes in sequence, asserts `isolationOk: true`, prints summary table. CI-compatible (`--ci` exits 1 on failure). **Result: 3/3 PASSED.**
- [x] **Blog #1** — "Multi-Tenant Isolation in an Edge AI System" (240 lines). Published at `portfolio.macksportreport.com/blog/multi-tenant-isolation-edge-ai`. Three layers, three probes, the hallucination story, what's still missing.
- [x] Updated `MASTERY.md` → Week 2 (Evals as a CI gate).

## Definition of done  ✅ ALL MET
- [x] All three layers (RAG / memory / audit) filter by `orgId`.
- [x] A passing automated test proves cross-org isolation — `isolation-test.sh` 3/3 pass.
- [x] Blog #1 published.
- [x] Tradeoff (metadata-filter vs index-per-org) written in own words — blog, cycle doc, and theory log.
