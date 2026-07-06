"""
eval/faithfulness.py

Step 2 of the eval harness (runs BEFORE the LLM judge): a DETERMINISTIC
faithfulness / grounding check. No LLM in the path — pure string matching —
so it can never be masked by the same hallucination it's trying to catch.

The bug this exists to catch (found Day 2 of Week 1):
    The acme KB chunk says "35% discount". Retrieval returned it correctly.
    But the LLM answered "25%". Retrieval was right; *generation* was unfaithful.
    An LLM-as-judge scoring "groundedness" subjectively missed it.

How it works
------------
Each test case may declare `expected_facts`. Two kinds:

  kind="grounded" (default)
    A fact that SHOULD be retrieved and SHOULD appear in the response.
    - retrieval_fail   : expected grounded fact was NOT in any retrieved chunk
                         (a RETRIEVAL problem — reported, but not the CI gate)
    - grounding_fail   : fact WAS retrieved but is MISSING from the response
                         (the faithfulness bug — THIS fails CI)

  kind="forbidden"
    A specific value that must NOT appear in the response unless it was
    actually retrieved (catches invented numbers / hallucinated specifics).
    - hallucination_fail : forbidden value present in response, absent from chunks
                           (THIS fails CI)

Matching is case-insensitive over whitespace-normalized text. Each fact may
carry `aliases` (alternate surface forms that count as the same fact).

Usage:
  python eval/faithfulness.py eval/results/run_X.json
  python eval/faithfulness.py --latest
  python eval/faithfulness.py --latest --ci    # exit 1 on any grounding/hallucination fail
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Optional

RESULTS_DIR = Path(__file__).parent / "results"

# ── Colours ────────────────────────────────────────────────────────────────────
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
DIM    = "\033[2m"
BOLD   = "\033[1m"
RESET  = "\033[0m"


# ── Matching ─────────────────────────────────────────────────────────────────--

def normalize(text: str) -> str:
    """Lowercase + collapse whitespace so '35 %' and '35%' compare predictably."""
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def fact_surfaces(fact: dict) -> list[str]:
    """All surface forms that count as a match for this fact."""
    forms = [fact["fact"]]
    forms.extend(fact.get("aliases", []))
    return [normalize(f) for f in forms if f]


def appears_in(surfaces: list[str], haystack: str) -> bool:
    norm = normalize(haystack)
    return any(s in norm for s in surfaces)


def chunks_text(result: dict) -> str:
    """Concatenate the content of every retrieved chunk into one searchable blob."""
    chunks = result.get("retrieved_chunks") or []
    return "\n".join(c.get("content", "") for c in chunks)


# ── Per-case check ───────────────────────────────────────────────────────────--

def check_case(result: dict) -> Optional[dict]:
    """
    Evaluate one result's faithfulness. Returns a faithfulness dict, or None
    if the case declares no expected_facts (nothing deterministic to check).
    """
    expected_facts = result.get("expected_facts") or []
    if not expected_facts:
        return None

    response = result.get("response") or ""
    chunk_blob = chunks_text(result)

    fact_reports = []
    grounding_fails = 0
    retrieval_fails = 0
    hallucination_fails = 0
    grounded_ok = 0

    for fact in expected_facts:
        kind     = fact.get("kind", "grounded")
        surfaces = fact_surfaces(fact)
        in_chunks   = appears_in(surfaces, chunk_blob)
        in_response = appears_in(surfaces, response)

        report = {
            "fact":        fact["fact"],
            "kind":        kind,
            "in_chunks":   in_chunks,
            "in_response": in_response,
            "status":      "ok",
        }

        if kind == "grounded":
            if not in_chunks:
                report["status"] = "retrieval_fail"   # never retrieved — retrieval problem
                retrieval_fails += 1
            elif not in_response:
                report["status"] = "grounding_fail"    # retrieved but dropped — THE bug
                grounding_fails += 1
            else:
                grounded_ok += 1
        elif kind == "forbidden":
            if in_response and not in_chunks:
                report["status"] = "hallucination_fail"  # invented, not retrieved
                hallucination_fails += 1

        fact_reports.append(report)

    # CI-blocking failures: unfaithful to retrieved context, or invented specifics.
    blocking_fails = grounding_fails + hallucination_fails
    passed = blocking_fails == 0

    return {
        "checked":             True,
        "passed":              passed,
        "grounded_ok":         grounded_ok,
        "grounding_fails":     grounding_fails,
        "retrieval_fails":     retrieval_fails,
        "hallucination_fails": hallucination_fails,
        "facts":               fact_reports,
    }


# ── Main ───────────────────────────────────────────────────────────────────────

def find_latest_run() -> Optional[Path]:
    runs = sorted(RESULTS_DIR.glob("run_*.json"), reverse=True)
    return runs[0] if runs else None


def main() -> None:
    parser = argparse.ArgumentParser(description="SE Intel deterministic faithfulness checker")
    parser.add_argument("results_file", nargs="?", help="Path to a runner results JSON file")
    parser.add_argument("--latest", action="store_true", help="Check the most recent run file")
    parser.add_argument("--ci", action="store_true",
                        help="Exit 1 if any grounding_fail or hallucination_fail is found")
    args = parser.parse_args()

    if args.latest or not args.results_file:
        results_path = find_latest_run()
        if not results_path:
            print(f"{RED}No run files found in {RESULTS_DIR}{RESET}")
            sys.exit(1)
    else:
        results_path = Path(args.results_file)

    if not results_path.exists():
        print(f"{RED}File not found: {results_path}{RESET}")
        sys.exit(1)

    with open(results_path) as fh:
        data = json.load(fh)

    results = data["results"]
    meta    = data["meta"]

    print(f"\n{BOLD}{CYAN}SE Intel Faithfulness Check{RESET} {DIM}(deterministic — no LLM){RESET}")
    print(f"{DIM}Run: {meta['run_id']}{RESET}\n")

    checked       = 0
    case_failures = 0
    total_grounding_fails     = 0
    total_hallucination_fails = 0
    total_retrieval_fails     = 0

    for result in results:
        fcheck = check_case(result)
        result["faithfulness"] = fcheck  # write back (None if no expected_facts)

        if fcheck is None:
            continue

        checked += 1
        case_id = result["id"]
        role    = result["role"]
        org     = result.get("orgId", "eval-org")

        if result.get("error"):
            print(f"  {case_id:10s} {YELLOW}SKIP{RESET} (runner error)")
            continue

        status = f"{GREEN}PASS{RESET}" if fcheck["passed"] else f"{RED}FAIL{RESET}"
        print(f"  {case_id:10s} [{role:14s} @ {org:12s}] {status}")

        for fr in fcheck["facts"]:
            if fr["status"] == "ok":
                tag = f"{GREEN}grounded{RESET}" if fr["kind"] == "grounded" else f"{GREEN}clean{RESET}"
                print(f"      {tag}  \"{fr['fact']}\"  {DIM}chunks={fr['in_chunks']} resp={fr['in_response']}{RESET}")
            elif fr["status"] == "grounding_fail":
                print(f"      {RED}GROUNDING FAIL{RESET}  \"{fr['fact']}\" "
                      f"{RED}was retrieved but missing from response{RESET}")
            elif fr["status"] == "retrieval_fail":
                print(f"      {YELLOW}retrieval miss{RESET}  \"{fr['fact']}\" "
                      f"{DIM}not in any retrieved chunk{RESET}")
            elif fr["status"] == "hallucination_fail":
                print(f"      {RED}HALLUCINATION{RESET}  \"{fr['fact']}\" "
                      f"{RED}in response but never retrieved{RESET}")

        if not fcheck["passed"]:
            case_failures += 1
        total_grounding_fails     += fcheck["grounding_fails"]
        total_hallucination_fails += fcheck["hallucination_fails"]
        total_retrieval_fails     += fcheck["retrieval_fails"]

    # Persist faithfulness results back into the run file
    meta["faithfulness_checked"]      = True
    meta["faithfulness_cases"]        = checked
    meta["faithfulness_case_fails"]   = case_failures
    meta["grounding_fails"]           = total_grounding_fails
    meta["hallucination_fails"]       = total_hallucination_fails
    meta["retrieval_fails"]           = total_retrieval_fails

    with open(results_path, "w") as fh:
        json.dump(data, fh, indent=2)

    blocking = total_grounding_fails + total_hallucination_fails

    print(f"\n{BOLD}Faithfulness summary{RESET}")
    print(f"  Cases with fact checks: {checked}")
    print(f"  {GREEN}Passed:{RESET} {checked - case_failures}   {RED}Failed:{RESET} {case_failures}")
    print(f"  Grounding fails:     {RED if total_grounding_fails else DIM}{total_grounding_fails}{RESET} "
          f"{DIM}(retrieved but not used — faithfulness bug){RESET}")
    print(f"  Hallucination fails: {RED if total_hallucination_fails else DIM}{total_hallucination_fails}{RESET} "
          f"{DIM}(invented, not retrieved){RESET}")
    print(f"  Retrieval misses:    {YELLOW if total_retrieval_fails else DIM}{total_retrieval_fails}{RESET} "
          f"{DIM}(not blocking — retrieval-quality work){RESET}")
    print(f"\nResults written to: {DIM}{results_path}{RESET}\n")

    if args.ci and blocking > 0:
        print(f"{RED}{BOLD}Faithfulness gate FAILED — {blocking} blocking failure(s). "
              f"Deploy blocked.{RESET}\n")
        sys.exit(1)

    if args.ci:
        print(f"{GREEN}{BOLD}Faithfulness gate passed.{RESET}\n")


if __name__ == "__main__":
    main()
