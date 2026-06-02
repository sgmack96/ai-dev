"""
eval/judge.py

Step 2 of the eval harness: score each raw result using LLM-as-judge.

The judge is Llama 3.3 70B running on Cloudflare Workers AI (free tier).
For each test case result it:
  1. Builds a structured scoring prompt
  2. Calls the Workers AI REST API
  3. Parses the JSON scores (groundedness, relevance, role_appropriateness, actionability)
  4. Writes scores back into the results file in-place

Scoring dimensions (0-3 each, 12 points total):
  groundedness        — does it cite real products/facts or hallucinate?
  relevance           — does it answer what was actually asked?
  role_appropriateness — is the depth/tone right for the role?
  actionability       — can a rep use this in a call TODAY?

Pass threshold: 8/12

Usage:
  python eval/judge.py eval/results/run_20260602_143022.json
  python eval/judge.py --latest                  # judge the most recent run
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

# ── Config ────────────────────────────────────────────────────────────────────

HARNESS_DIR = Path(__file__).parent.parent
load_dotenv(HARNESS_DIR / ".env")

CF_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "")
CF_API_TOKEN  = os.environ.get("CF_API_TOKEN", "")
RESULTS_DIR   = Path(__file__).parent / "results"

# Cloudflare Workers AI REST endpoint
JUDGE_MODEL   = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
CF_AI_URL     = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{JUDGE_MODEL}"

PASS_THRESHOLD = 8   # out of 12
RETRY_ATTEMPTS = 2
RETRY_DELAY_S  = 3

# ── Colours ────────────────────────────────────────────────────────────────────
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
DIM    = "\033[2m"
BOLD   = "\033[1m"
RESET  = "\033[0m"


# ── Judge prompt ───────────────────────────────────────────────────────────────

def build_judge_prompt(result: dict) -> str:
    tools_str = ", ".join(result.get("tools_used") or []) or "none"
    latency   = result.get("latency_ms", 0)
    response  = result.get("response") or ""

    # Truncate very long responses to keep prompt manageable
    if len(response) > 1500:
        response = response[:1500] + "\n[... response truncated for evaluation ...]"

    return f"""You are a rigorous evaluator for an enterprise AI sales assistant called SE Intel.
Your job is to score a response on four dimensions. Be critical — a score of 3 means genuinely excellent, not just acceptable. A score of 2 means good. A score of 1 means acceptable but flawed. A score of 0 means failing.

=== TEST CASE ===
ID: {result['id']}
Agent: {result['agent']}
User role: {result['role']}
Question asked: {result['input']}

=== EVALUATION RUBRIC ===
{result['rubric']}

=== ACTUAL RESPONSE ===
{response}

=== METADATA ===
Tools used: {tools_str}
Response latency: {latency}ms

=== SCORING INSTRUCTIONS ===
Score each dimension 0-3:

1. GROUNDEDNESS (0-3)
   3 = Cites specific Cloudflare products by name, real pricing tiers, documented patterns from the KB
   2 = Mostly correct with real product names, minor unverifiable claims
   1 = Some correct facts but also vague or unverifiable claims
   0 = Hallucinated specifics, wrong product names, invented pricing figures

2. RELEVANCE (0-3)
   3 = Directly answers the question AND addresses the implicit underlying need
   2 = Answers the main question
   1 = Partially answers but misses key aspects
   0 = Does not answer the question asked

3. ROLE_APPROPRIATENESS (0-3)
   3 = Depth and tone perfectly calibrated to the {result['role']} role
   2 = Appropriate for the role with minor mismatches
   1 = Somewhat wrong depth (too technical for AE, or too shallow for SE, or off-topic for manager)
   0 = Clearly wrong role calibration (technical deep-dive for AE, or pure product pitch to a manager asking about deal strategy)

4. ACTIONABILITY (0-3)
   3 = A real sales rep could use this verbatim in a customer call today
   2 = Usable with minor modification
   1 = Contains useful information but needs significant reframing to use
   0 = Cannot be used in a sales context without complete rewriting

=== IMPORTANT ===
You MUST respond with ONLY valid JSON. No preamble, no explanation outside the JSON.
The "reasoning" field must explain your scores in 2-3 sentences.

{{
  "groundedness": <integer 0-3>,
  "relevance": <integer 0-3>,
  "role_appropriateness": <integer 0-3>,
  "actionability": <integer 0-3>,
  "total": <sum of all four scores>,
  "passed": <true if total >= {PASS_THRESHOLD} else false>,
  "reasoning": "<2-3 sentences explaining the scores>"
}}"""


# ── Call Workers AI REST API ───────────────────────────────────────────────────

def call_judge(client: httpx.Client, prompt: str) -> Optional[dict]:
    """
    Call Cloudflare Workers AI REST API with the judge prompt.
    Returns parsed scores dict or None on failure.
    """
    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        raise RuntimeError(
            "CF_ACCOUNT_ID and CF_API_TOKEN must be set in .env\n"
            "Create a token at: dash.cloudflare.com > My Profile > API Tokens\n"
            "Required permission: Account > Workers AI > Edit"
        )

    payload = {
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a rigorous AI evaluator. "
                    "You always respond with valid JSON only, no other text."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 512,
        "temperature": 0.1,  # low temperature for consistent scoring
    }

    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            resp = client.post(
                CF_AI_URL,
                headers={
                    "Authorization": f"Bearer {CF_API_TOKEN}",
                    "Content-Type":  "application/json",
                },
                json=payload,
                timeout=45,
            )

            if resp.status_code != 200:
                print(f"  {YELLOW}Judge API {resp.status_code} (attempt {attempt}){RESET}")
                if attempt < RETRY_ATTEMPTS:
                    time.sleep(RETRY_DELAY_S)
                continue

            data         = resp.json()
            response_val = data.get("result", {}).get("response", "")

            # Workers AI REST API sometimes returns the JSON object directly
            # (not as a string) when the model responds with structured JSON.
            if isinstance(response_val, dict):
                scores = validate_scores(response_val)
                if scores:
                    return scores
                print(f"  {YELLOW}Score dict invalid (attempt {attempt}): {response_val}{RESET}")
            else:
                raw_text = response_val
                scores = parse_scores(raw_text)
                if scores:
                    return scores
                print(f"  {YELLOW}JSON parse failed (attempt {attempt}): {str(raw_text)[:100]}{RESET}")
            if attempt < RETRY_ATTEMPTS:
                time.sleep(RETRY_DELAY_S)

        except Exception as exc:
            print(f"  {RED}Judge call error (attempt {attempt}): {exc}{RESET}")
            if attempt < RETRY_ATTEMPTS:
                time.sleep(RETRY_DELAY_S)

    return None


def validate_scores(data: dict) -> Optional[dict]:
    """Validate and normalise a scores dict that arrived already parsed."""
    required = {"groundedness", "relevance", "role_appropriateness", "actionability"}
    if not required.issubset(data.keys()):
        return None
    for key in required:
        data[key] = max(0, min(3, int(data.get(key, 0))))
    total  = sum(data[k] for k in required)
    passed = total >= PASS_THRESHOLD
    data["total"]  = total
    data["passed"] = passed
    if "reasoning" not in data:
        data["reasoning"] = ""
    return data


def parse_scores(raw: str) -> Optional[dict]:
    """
    Extract JSON from the model's response.
    The model sometimes wraps JSON in markdown code fences — strip those.
    """
    # Strip markdown code fences if present
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    raw = raw.strip()

    # Find the first { ... } block
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        return None

    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None

    # Validate required fields
    required = {"groundedness", "relevance", "role_appropriateness", "actionability"}
    if not required.issubset(data.keys()):
        return None

    # Clamp scores to 0-3
    for key in required:
        data[key] = max(0, min(3, int(data.get(key, 0))))

    total  = sum(data[k] for k in required)
    passed = total >= PASS_THRESHOLD

    data["total"]  = total
    data["passed"] = passed
    if "reasoning" not in data:
        data["reasoning"] = ""

    return data


# ── Main ───────────────────────────────────────────────────────────────────────

def find_latest_run() -> Optional[Path]:
    runs = sorted(RESULTS_DIR.glob("run_*.json"), reverse=True)
    return runs[0] if runs else None


def main() -> None:
    parser = argparse.ArgumentParser(description="SE Intel LLM-as-judge scorer")
    parser.add_argument(
        "results_file",
        nargs="?",
        help="Path to a runner results JSON file",
    )
    parser.add_argument(
        "--latest",
        action="store_true",
        help="Judge the most recent run file",
    )
    args = parser.parse_args()

    # Resolve results file
    if args.latest:
        results_path = find_latest_run()
        if not results_path:
            print(f"{RED}No run files found in {RESULTS_DIR}{RESET}")
            sys.exit(1)
    elif args.results_file:
        results_path = Path(args.results_file)
    else:
        # Default to latest if no arg given
        results_path = find_latest_run()
        if not results_path:
            print(f"{RED}No results file specified and none found in {RESULTS_DIR}{RESET}")
            print("Run: python eval/runner.py first")
            sys.exit(1)

    if not results_path.exists():
        print(f"{RED}File not found: {results_path}{RESET}")
        sys.exit(1)

    # Validate credentials
    if not CF_ACCOUNT_ID or not CF_API_TOKEN or CF_API_TOKEN == "PASTE_YOUR_NEW_TOKEN_HERE":
        print(f"{RED}CF_ACCOUNT_ID and CF_API_TOKEN must be set in .env{RESET}")
        print(f"Edit: {HARNESS_DIR / '.env'}")
        sys.exit(1)

    with open(results_path) as fh:
        data = json.load(fh)

    results = data["results"]
    meta    = data["meta"]

    print(f"\n{BOLD}{CYAN}SE Intel LLM-as-Judge{RESET}")
    print(f"{DIM}Run:    {meta['run_id']}{RESET}")
    print(f"{DIM}Cases:  {len(results)}{RESET}")
    print(f"{DIM}Model:  {JUDGE_MODEL}{RESET}")
    print(f"{DIM}Pass threshold: {PASS_THRESHOLD}/12{RESET}\n")

    scored = 0
    failed = 0
    errors = 0

    with httpx.Client() as client:
        for i, result in enumerate(results, 1):
            case_id = result["id"]
            role    = result["role"]
            label   = f"[{i:02d}/{len(results)}] {case_id:10s} role={role:15s}"
            print(f"{label}", end="", flush=True)

            # Skip cases that errored during running
            if result.get("error"):
                print(f"  {YELLOW}SKIP{RESET} (runner error: {result['error'][:40]})")
                continue

            prompt = build_judge_prompt(result)
            scores = call_judge(client, prompt)

            if scores is None:
                print(f"  {RED}JUDGE ERROR{RESET}")
                errors += 1
                continue

            # Write scores back into the result
            result["scores"]          = scores
            result["total_score"]     = scores["total"]
            result["passed"]          = scores["passed"]
            result["judge_reasoning"] = scores["reasoning"]

            scored += 1
            status = f"{GREEN}PASS{RESET}" if scores["passed"] else f"{RED}FAIL{RESET}"
            dims   = (
                f"G={scores['groundedness']} "
                f"R={scores['relevance']} "
                f"RA={scores['role_appropriateness']} "
                f"A={scores['actionability']}"
            )
            print(f"  {status}  {scores['total']:2d}/12  {DIM}{dims}{RESET}")

            if not scores["passed"]:
                failed += 1

    # Update meta
    meta["judged"]       = True
    meta["scored"]       = scored
    meta["judge_passed"] = scored - failed
    meta["judge_failed"] = failed
    meta["judge_errors"] = errors
    meta["pass_rate"]    = round((scored - failed) / scored * 100, 1) if scored else 0

    # Write updated results back to the same file
    with open(results_path, "w") as fh:
        json.dump(data, fh, indent=2)

    print(f"\n{BOLD}Judge complete{RESET}")
    print(f"  Scored: {scored}/{len(results)}")
    print(f"  Passed: {GREEN}{scored - failed}{RESET}")
    print(f"  Failed: {RED}{failed}{RESET}")
    print(f"  Errors: {YELLOW}{errors}{RESET}")
    print(f"  Pass rate: {meta['pass_rate']}%")
    print(f"\nScores written to: {DIM}{results_path}{RESET}")
    print(f"Next step: {CYAN}python eval/report.py{RESET}\n")


if __name__ == "__main__":
    main()
