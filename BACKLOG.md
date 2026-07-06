# BACKLOG — ideas parked to protect focus

> Per the Working Agreement in MASTERY.md: **no new top-level project mid-cycle.**
> New ideas land here, not in a new folder. Pull from here when a cycle opens up.

---

## Cycle 2 candidates (retrieval quality / distributed depth)

- **RAG faithfulness / grounding** *(found Day 2, 2026-06-16)* — the LLM does not reliably use retrieved chunks: with the acme chunk stating "35% discount" present in context, the agent answered "25%"; with no chunk, it hallucinated "27%". Retrieval is correct (proven via `/admin/kb-probe`), but generation isn't faithful. Fixes to explore: stricter "answer ONLY from context, cite the chunk, say 'not in KB' otherwise" prompting; lower temperature; a faithfulness eval (LLM-as-judge or string-grounding check) in the Week 2 eval harness. **This is prime Week 2 (evals) material.**

- **Reranking + recall@k** — current retrieval is raw cosine top-K across namespaces; add a reranker and measure recall@k.

---

## Cycle 3+ candidates (real-world deployment / new verticals)

- **Low-resource language healthcare deployment** *(sourced from real customer conversation, 2026-06-23)* — deploying AI agents in regions like West Africa where healthcare workers speak local dialects (not high-resource languages like French), with strict data residency requirements. The architecture challenge: base LLMs (Llama 3.3 70B) handle French well but not regional dialects. Three-phase approach: (1) French-first interface with a KV dialect glossary for local medical slang, (2) external translation pipeline (NLLB-200 or API) when Workers AI supports it, (3) native dialect generation. Key blocker: Workers AI does not ship NLLB-200 or equivalent today; dialect translation requires external dependency. For safety-critical health responses (Ebola triage), deterministic template matching is preferred over LLM generation — pre-approved responses in the local dialect, with human escalation for edge cases. Eval pattern: exact-match expected outputs for critical cases, behavioral contracts for tool usage, rubric synthesis for scale. Data residency: R2 region pinning + Durable Objects in local colo (where available) or nearest regional anchor.
