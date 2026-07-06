"""
eval/runner.py

Step 1 of the eval harness: run all test cases against the live API
and record raw results.

What it does:
  1. Loads all test cases from cases/
  2. Gets a JWT token for each required role from /dev/token
  3. Calls /api/v1/account or /api/v1/enablement for each case
  4. Records: response text, latency, tools used, HTTP status, errors
  5. Writes raw results to eval/results/run_{timestamp}.json

Usage:
  python eval/runner.py
  python eval/runner.py --cases cases/enablement.json   # single file
  python eval/runner.py --dry-run                        # print cases only
"""

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

# ── Config ────────────────────────────────────────────────────────────────────

# Load .env from the evaluation-harness directory
HARNESS_DIR = Path(__file__).parent.parent
load_dotenv(HARNESS_DIR / ".env")

BASE_URL = os.environ.get("BASE_URL", "https://se-intel-portfolio.stephenmack96.workers.dev")
RESULTS_DIR = Path(__file__).parent / "results"
CASES_DIR = HARNESS_DIR / "cases"
TIMEOUT = 60  # seconds per request

# ── Colours for terminal output ────────────────────────────────────────────────
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
DIM    = "\033[2m"
BOLD   = "\033[1m"
RESET  = "\033[0m"


def log(msg: str, colour: str = "") -> None:
    print(f"{colour}{msg}{RESET}")


# ── Token cache — one token per role per run ───────────────────────────────────

_token_cache: dict[str, str] = {}

def get_token(client: httpx.Client, role: str, org_id: str = "eval-org") -> str:
    """
    Get (or reuse) a dev JWT for a given role + org.

    Tokens are cached per (role, org_id). orgId matters for faithfulness cases:
    a case that probes acme's private "35% discount" chunk must run under
    orgId=acme, or the org-isolation filter (correctly) hides that chunk.
    """
    cache_key = f"{role}:{org_id}"
    if cache_key in _token_cache:
        return _token_cache[cache_key]

    user_id = f"eval-{role}-{uuid.uuid4().hex[:6]}"
    names = {
        "ae": "Eva AE",
        "se": "Sam SE",
        "csm": "Casey CSM",
        "tam": "Taylor TAM",
        "sales_manager": "Morgan Manager",
    }

    resp = client.post(
        f"{BASE_URL}/dev/token",
        json={
            "userId": user_id,
            "role": role,
            "name": names.get(role, f"Eval {role.upper()}"),
            "orgId": org_id,
        },
        timeout=15,
    )
    resp.raise_for_status()
    token = resp.json()["token"]
    _token_cache[cache_key] = token
    return token


# ── Load test cases ────────────────────────────────────────────────────────────

def load_cases(case_files: list[Path]) -> list[dict]:
    cases = []
    for f in case_files:
        with open(f) as fh:
            data = json.load(fh)
        for case in data:
            case["_source_file"] = f.name
        cases.extend(data)
    return cases


# ── Run a single test case ─────────────────────────────────────────────────────

def run_case(client: httpx.Client, case: dict) -> dict:
    """
    Call the agent API for one test case.
    Returns a result dict merging the original case with actual API output.
    """
    agent   = case["agent"]    # "account" or "enablement"
    role    = case["role"]
    message = case["input"]
    case_id = case["id"]
    org_id  = case.get("orgId", "eval-org")

    token     = get_token(client, role, org_id)
    thread_id = f"eval-{case_id}-{uuid.uuid4().hex[:8]}"
    # ?debug=true makes the API return the raw KB chunks it retrieved, so the
    # faithfulness checker can compare retrieval against the generated response.
    endpoint  = f"{BASE_URL}/api/v1/{agent}?debug=true"

    start = time.time()
    error = None
    response_text = None
    tools_used: list[str] = []
    retrieved_chunks: list[dict] = []
    http_status = None

    try:
        resp = client.post(
            endpoint,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
            json={"message": message, "threadId": thread_id},
            timeout=TIMEOUT,
        )
        http_status = resp.status_code
        elapsed_ms  = int((time.time() - start) * 1000)

        if resp.status_code == 200:
            data             = resp.json()
            response_text    = data.get("response", "")
            tools_used       = data.get("toolsUsed") or []
            retrieved_chunks = data.get("retrievedChunks") or []
        else:
            error = f"HTTP {resp.status_code}: {resp.text[:200]}"

    except httpx.TimeoutException:
        elapsed_ms = int((time.time() - start) * 1000)
        error = f"Timeout after {TIMEOUT}s"
    except Exception as exc:
        elapsed_ms = int((time.time() - start) * 1000)
        error = str(exc)

    # Latency check
    max_ms   = case.get("expected", {}).get("max_latency_ms", 35000)
    too_slow = elapsed_ms > max_ms if error is None else False

    return {
        # Original case fields
        "id":           case_id,
        "agent":        agent,
        "role":         role,
        "orgId":        org_id,
        "input":        message,
        "rubric":       case.get("rubric", ""),
        "expected":     case.get("expected", {}),
        "expected_facts": case.get("expected_facts", []),  # used by faithfulness.py
        "_source_file": case.get("_source_file", ""),

        # Actual results
        "response":         response_text,
        "tools_used":       tools_used,
        "retrieved_chunks": retrieved_chunks,  # raw KB chunks the agent retrieved (debug mode)
        "latency_ms":       elapsed_ms,
        "http_status":      http_status,
        "error":            error,
        "too_slow":         too_slow,

        # Placeholder — faithfulness.py fills these in
        "faithfulness":     None,

        # Placeholder — judge.py fills these in
        "scores":          None,
        "total_score":     None,
        "passed":          None,
        "judge_reasoning": None,
    }


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="SE Intel eval runner")
    parser.add_argument(
        "--cases",
        nargs="*",
        help="Paths to case JSON files. Defaults to all files in cases/",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print test cases without calling the API",
    )
    args = parser.parse_args()

    # Resolve case files
    if args.cases:
        case_files = [Path(f) for f in args.cases]
    else:
        case_files = sorted(CASES_DIR.glob("*.json"))

    if not case_files:
        log("No case files found. Expected JSON files in cases/", RED)
        sys.exit(1)

    cases = load_cases(case_files)

    if args.dry_run:
        log(f"\n{BOLD}Dry run — {len(cases)} test cases:{RESET}")
        for c in cases:
            log(f"  {c['id']:10s}  {c['agent']:12s}  role={c['role']:15s}  {c['input'][:60]}")
        return

    # Validate env
    if not BASE_URL:
        log("BASE_URL not set in .env", RED)
        sys.exit(1)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_path  = RESULTS_DIR / f"run_{timestamp}.json"

    log(f"\n{BOLD}{CYAN}SE Intel Eval Runner{RESET}")
    log(f"{DIM}Target: {BASE_URL}{RESET}")
    log(f"{DIM}Cases:  {len(cases)} across {len(case_files)} file(s){RESET}")
    log(f"{DIM}Output: {out_path}{RESET}\n")

    results = []
    passed_latency = 0
    errored = 0

    with httpx.Client() as client:
        # Pre-fetch tokens for all required (role, org) pairs.
        # org matters: faithfulness cases targeting acme's private chunks must
        # run under orgId=acme or the isolation filter hides those chunks.
        pairs_needed = sorted({(c["role"], c.get("orgId", "eval-org")) for c in cases})
        log(f"Fetching tokens for {len(pairs_needed)} role/org pair(s)")
        for role, org_id in pairs_needed:
            try:
                get_token(client, role, org_id)
                log(f"  {GREEN}✓{RESET} {role} @ {org_id}")
            except Exception as exc:
                log(f"  {RED}✗{RESET} {role} @ {org_id}: {exc}")
                sys.exit(1)

        print()

        # Run cases
        for i, case in enumerate(cases, 1):
            label = f"[{i:02d}/{len(cases)}] {case['id']:10s} role={case['role']:15s}"
            print(f"{label}", end="", flush=True)

            result = run_case(client, case)
            results.append(result)

            if result["error"]:
                log(f"  {RED}ERROR{RESET} {result['error'][:60]}", "")
                errored += 1
            elif result["too_slow"]:
                log(f"  {YELLOW}SLOW{RESET}  {result['latency_ms']}ms (max {result['expected'].get('max_latency_ms')}ms)")
            else:
                log(f"  {GREEN}✓{RESET}  {result['latency_ms']}ms")
                passed_latency += 1

    # Write raw results
    run_meta = {
        "run_id":     timestamp,
        "base_url":   BASE_URL,
        "total":      len(results),
        "errored":    errored,
        "too_slow":   sum(1 for r in results if r["too_slow"]),
        "ran_at":     datetime.now(timezone.utc).isoformat(),
        "judged":     False,  # judge.py sets this to True
    }

    output = {"meta": run_meta, "results": results}
    with open(out_path, "w") as fh:
        json.dump(output, fh, indent=2)

    print()
    log(f"{BOLD}Runner complete{RESET}")
    log(f"  Total:   {len(results)}")
    log(f"  OK:      {GREEN}{passed_latency}{RESET}")
    log(f"  Slow:    {YELLOW}{run_meta['too_slow']}{RESET}")
    log(f"  Errors:  {RED}{errored}{RESET}")
    log(f"\nResults written to: {DIM}{out_path}{RESET}")
    log(f"Next step: {CYAN}python eval/judge.py {out_path}{RESET}\n")


if __name__ == "__main__":
    main()
