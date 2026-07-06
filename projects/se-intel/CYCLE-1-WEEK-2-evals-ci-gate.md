# Cycle 1 · Week 2 — Evals as a CI Gate

> **Target:** Block deploys on a quality drop. Specifically, catch **faithfulness** failures — when the model is handed the right KB chunk but doesn't use it (the Day-2 bug: chunk said 35%, model answered 25%).
> **Why it matters (interview):** "How do you measure LLM quality?" — and the sharper follow-up, "how do you make that measurement reliable enough to gate a deploy?"
> **Done when:** A deterministic check proves whether the response grounds in the chunks that were actually retrieved, and a CI gate blocks deploy on a grounding failure — with a passing baseline.

---

## The gap (verified in code, Week 1 Day 2)

- The eval harness scored `groundedness` via **LLM-as-judge** — subjective, and it *missed* the 35%→25% bug.
- The runner captured `toolsUsed` but **not what was retrieved**, so nothing could compare retrieval against the response.
- "Groundedness" (cites real products?) ≠ "faithfulness" (used the chunk we actually retrieved?).

## Decision (DIRECT — locked)

**Option C — both layers:**
- **Deterministic string-grounding check** = the CI gate (fast, no LLM, can't be masked by the same hallucination it hunts).
- **LLM-as-judge faithfulness dimension** = richer signal in the report (5th dimension).
- API exposes retrieved chunks only under `?debug=true` (keeps prod payloads lean).
- Chunk capture is **KB-only** (web/news aren't in the index, so grounding against them is meaningless).

## What shipped

### API (TypeScript)
- `AgentRequest.debugMode` + `AgentResponse.retrievedChunks` (new `RetrievedChunk` type).
- `index.ts` reads `?debug=true` on `/api/v1/account` and `/api/v1/enablement`, threads `debugMode` into the DO body.
- `base-agent.ts` `handleChat` builds a `capturedChunks` array only when `debugMode`, passes it to `dispatchTools`, and attaches it to the response.
- `kbSearch` populates `capturedChunks` with **exactly the chunks it retrieved and injected** — single source of truth, no duplicate Vectorize query.
- Both agents' `dispatchTools` take an optional `capturedChunks` param and forward it to `kbSearch`.

### Harness (Python)
- `runner.py` — per-case `orgId` (faithfulness cases can target the `acme` tenant), sends `?debug=true`, captures `retrieved_chunks`, passes through `expected_facts`.
- `faithfulness.py` (new) — deterministic check. Fact kinds:
  - `grounded`: must be retrieved AND in response. `grounding_fail` = retrieved but dropped (THE bug, blocks CI). `retrieval_fail` = never retrieved (retrieval problem, reported but not blocking).
  - `forbidden`: must NOT be in response unless retrieved. `hallucination_fail` = invented (blocks CI).
  - `--ci` exits 1 on any grounding_fail / hallucination_fail.
- `judge.py` — 5th dimension `faithfulness` (judge now sees the retrieved chunks). Scale 12→15, pass threshold 8→10.
- `report.py` — Faithfulness section + F dimension in per-case bars; 15-pt scale throughout.
- `run_eval.sh` — 4 steps (runner → faithfulness → judge → report); `--ci` runs the deterministic gate fail-fast before the judge.

### Test data
- `cases/faithfulness.json` — 5 cases:
  - `fth-001` acme "35%" (canonical regression case)
  - `fth-002` "5ms" + "v8 isolate" (cold starts)
  - `fth-003` "WinterCG" (lock-in objection)
  - `fth-004` "SOC 2 Type II" + "ISO 27001" (enterprise readiness)
  - `fth-005` **cross-org**: acme's "35%" run as `portfolio-org` must NOT appear (forbidden) — ties Week 1 isolation to Week 2 faithfulness at the generation layer.

## Findings

- **The harness caught a real bug on first run.** `fth-003` was **flaky**: the model was handed the WinterCG chunk but cited it only ~50% of runs (1 fail, then 1 pass on identical input). A flaky gate is dangerous — it would randomly block good deploys.
- **Root-cause fix (Option A), not a test loosen.** Added a GROUNDING RULE to the enablement system prompt: when the KB contains a specific named fact (standard/cert/figure/product), cite it verbatim; never paraphrase a named standard into a generic concept; never alter a number. Re-ran 3×: 3/3 stable.
- **Determinism matters for the oracle.** Same lesson as Week 1 (the LLM is not a reliable test oracle): the gate is a pure string check so it can't be masked by the behavior it measures.

## Verification

- `faithfulness.py --ci` exit code: **1** on the pre-fix flaky run (grounding_fail), **0** after the prompt fix.
- fth-003 grounded 3/3 after fix.
- Full run (all cases) faithfulness gate: 5/5 pass, 0 grounding_fails, 0 hallucination_fails.
- `tsc --noEmit` green; deployed to portfolio env.

## Definition of done
- [x] Deterministic faithfulness check compares retrieval vs response.
- [x] CI gate blocks deploy on grounding/hallucination failure (exit 1 proven).
- [x] LLM judge extended with a faithfulness dimension (15-pt scale).
- [x] Cross-org faithfulness case (isolation at the generation layer).
- [x] Passing baseline after root-cause prompt fix (3/3 stable).
- [x] THEORY block (Chip Huyen evals chapter + STUDY ch.8) — logged in THEORY-LOG.md 2026-06-26.
- [x] NARRATE — blog #2 published: https://portfolio.macksportreport.com/blog/evals-ci-gate

---

## Rubric Scaling — Build Notes (Future Target)

### The problem

Our current harness has 15 hand-written rubrics. That works for a portfolio project. It does not scale to hundreds of test cases — writing rubrics by hand becomes a full-time job.

The eval pyramid (how quality assurance actually scales):

```
         ▲
        /|\
       / | \
      /  |  \
     / Human \        ← Small, expensive, ground truth
    /  review  \      ← ~50 cases, done manually
   /____________\
  /              \
 /  LLM-as-judge  \   ← Medium, semi-automated
/   with rubrics   \  ← ~500 cases, rubric synthesis
/___________________\
/                   \
/ Deterministic checks\  ← Large, fully automated
/ (faithfulness.py)   \  ← Unlimited cases, string/schema checks
/______________________ \
```

Bottom: `faithfulness.py` — scales infinitely, zero cost per run.  
Middle: `judge.py` — scales to thousands, costs one LLM call per case.  
Top: Human review — does not scale, but anchors the whole system to ground truth.

### Pattern 1: LLM-Generated Rubrics (Rubric Synthesis)

You write the test input only. The LLM writes the rubric.

```python
# rubric_synthesis.py

def generate_rubric(input_text: str, agent: str, role: str) -> str:
    """Given a test input, generate evaluation criteria."""
    prompt = f"""
You are writing evaluation criteria for an AI sales assistant.

TEST INPUT:
Agent: {agent}
Role: {role}
User question: {input_text}

Write 3-5 specific criteria that a good response should meet.
Be precise — a judge LLM will use these to score the response.

Example format:
1. Must cite specific named products/prices from the knowledge base
2. Must address the underlying business need, not just the literal question
3. Must be at the right depth for a {role}
"""
    response = call_llm(prompt, temperature=0.2)
    return response

# Usage: you write the input, the LLM writes the rubric
rubric = generate_rubric(
    input_text="Research Stripe. What's their tech stack and our competitive angle?",
    agent="account",
    role="se"
)
# → "1. Must identify Stripe's primary tech stack (Node.js, AWS)
#     2. Must cite at least one Cloudflare Workers vs Lambda differentiator
#     3. Must include discovery questions tailored to a payments company"
```

Human reviews a sample (10-20%) to validate quality. The rest auto-generate.

### Pattern 2: Gold Set with Exact Expected Outputs

For safety-critical cases, the rubric is not enough — you need the exact expected output.

```json
{
  "id": "ebola-001",
  "input": "Patient has fever and bleeding. What do I do?",
  "expected_output": "Isolate immediately. Do not touch fluids. Call +225-XX-XX-XX.",
  "eval_type": "exact_match",
  "severity": 5
}
```

Deterministic check: `response.strip() == expected_output.strip()`. No LLM judge.  
Use only for: safety-critical responses, regulatory compliance, anything where "close enough" is wrong.

### Pattern 3: User Feedback as Ground Truth (Active Learning)

The eval suite grows from real usage, not manual writing:

```
Real user marks response "wrong" → captures input + correct answer
    │
    ▼
Human reviewer confirms (5 min per case)
    │
    ▼
Confirmed case enters eval suite automatically
    │
    ▼
Rubric auto-generated from the corrected answer
```

After 3 months of production, the eval suite has 500+ cases — all sourced from real users catching real mistakes.

### Pattern 4: Behavioral Contracts

When the output varies too much to write a rubric, evaluate behavior instead:

```python
behavioral_checks = {
    "account-research": {
        "must_call_tools": ["kb_search"],
        "must_NOT_call_tools": [],
        "response_must_contain": None,  # too variable
        "max_latency_ms": 5000
    },
    "ebola-triage": {
        "must_call_tools": ["kb_search"],
        "must_NOT_call_tools": ["web_search"],  # no external calls for clinical protocol
        "response_must_contain_template_id": True,
        "max_latency_ms": 3000
    }
}
```

Deterministic — no LLM judge, no expected output, no rubric. Just: did it call the right tools?

### The one rule that prevents eval debt

> **Every new feature ships with at least one eval case.**

When you add a dialect normalizer → 3 deterministic cases + 2 LLM-judge cases.  
When you add a new agent → 5 cases covering its core paths.  
You never "catch up" on evals because they are part of the definition of done.

### Interview answer

**Q: "How do you scale evaluation beyond a small test suite?"**

A: Four patterns. First, deterministic checks scale infinitely — string grounding, schema validation, behavioral contracts. These catch factual errors at zero marginal cost. Second, LLM-synthesized rubrics — the LLM writes the evaluation criteria from the test input, and a human spot-checks 10-20%. Third, user feedback as ground truth — real users marking responses wrong feeds the eval suite automatically after human review. Fourth, a small gold set of exact expected outputs for safety-critical cases. The eval pyramid means you never write 10,000 rubrics by hand — the bottom layers automate the bulk, and human review anchors the top.
