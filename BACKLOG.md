# BACKLOG — ideas parked to protect focus

> Per the Working Agreement in MASTERY.md: **no new top-level project mid-cycle.**
> New ideas land here, not in a new folder. Pull from here when a cycle opens up.

---

## Cycle 2 candidates (retrieval quality / distributed depth)

- **RAG faithfulness / grounding** *(found Day 2, 2026-06-16)* — the LLM does not reliably use retrieved chunks: with the acme chunk stating "35% discount" present in context, the agent answered "25%"; with no chunk, it hallucinated "27%". Retrieval is correct (proven via `/admin/kb-probe`), but generation isn't faithful. Fixes to explore: stricter "answer ONLY from context, cite the chunk, say 'not in KB' otherwise" prompting; lower temperature; a faithfulness eval (LLM-as-judge or string-grounding check) in the Week 2 eval harness. **This is prime Week 2 (evals) material.**

- **Reranking + recall@k** — current retrieval is raw cosine top-K across namespaces; add a reranker and measure recall@k.
