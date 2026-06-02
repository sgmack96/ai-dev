"""
eval/report.py

Step 3 of the eval harness: generate a scored report and regression diff.

What it does:
  1. Reads the most recent judged results file
  2. Prints a full score report (per case, per agent, per role)
  3. Compares against the previous run to detect regressions / improvements
  4. Exits with code 1 if pass rate < 80% (useful for CI)

Usage:
  python eval/report.py                        # report on latest run
  python eval/report.py eval/results/run_X.json
  python eval/report.py --no-regression        # skip diff, just report
  python eval/report.py --ci                   # exit 1 if pass rate < 80%
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

# ── Colours ────────────────────────────────────────────────────────────────────
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
BLUE   = "\033[34m"
DIM    = "\033[2m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

RESULTS_DIR    = Path(__file__).parent / "results"
PASS_THRESHOLD = 8
CI_PASS_RATE   = 80.0  # % of cases that must pass for CI green


# ── Helpers ────────────────────────────────────────────────────────────────────

def score_bar(score: int, max_score: int = 12) -> str:
    """Visual bar: ████░░ style."""
    filled = round((score / max_score) * 10)
    bar    = "█" * filled + "░" * (10 - filled)
    colour = GREEN if score >= PASS_THRESHOLD else (YELLOW if score >= 6 else RED)
    return f"{colour}{bar}{RESET} {score}/{max_score}"


def dim_bar(score: int, max_score: int = 3) -> str:
    filled = round((score / max_score) * 4)
    bar    = "■" * filled + "·" * (4 - filled)
    colour = GREEN if score >= 2 else (YELLOW if score == 1 else RED)
    return f"{colour}{bar}{RESET}"


def load_run(path: Path) -> dict:
    with open(path) as fh:
        return json.load(fh)


def find_runs(n: int = 2) -> list[Path]:
    """Return the n most recent judged run files."""
    all_runs = sorted(RESULTS_DIR.glob("run_*.json"), reverse=True)
    judged   = []
    for r in all_runs:
        try:
            data = load_run(r)
            if data.get("meta", {}).get("judged"):
                judged.append(r)
        except Exception:
            continue
        if len(judged) >= n:
            break
    return judged


def avg(values: list) -> float:
    return sum(values) / len(values) if values else 0.0


def delta_str(current: float, previous: float) -> str:
    diff = current - previous
    if abs(diff) < 0.05:
        return f"{DIM}(no change){RESET}"
    if diff > 0:
        return f"{GREEN}(+{diff:.1f}){RESET}"
    return f"{RED}({diff:.1f}){RESET}"


# ── Report ─────────────────────────────────────────────────────────────────────

def print_report(data: dict, prev_data: Optional[dict] = None) -> float:
    """
    Print the full report. Returns overall pass rate (0-100).
    """
    meta    = data["meta"]
    results = [r for r in data["results"] if r.get("scores") is not None]

    if not results:
        print(f"{RED}No judged results found in this run file.{RESET}")
        print("Run judge.py first: python eval/judge.py --latest")
        return 0.0

    run_id   = meta["run_id"]
    ran_at   = meta.get("ran_at", "unknown")
    base_url = meta.get("base_url", "")

    # ── Header ──────────────────────────────────────────────────────────────────
    print(f"\n{BOLD}{CYAN}{'━' * 60}{RESET}")
    print(f"{BOLD}{CYAN}  SE Intel Eval Report{RESET}")
    print(f"{BOLD}{CYAN}{'━' * 60}{RESET}")
    print(f"  Run:     {DIM}{run_id}{RESET}")
    print(f"  At:      {DIM}{ran_at}{RESET}")
    print(f"  Target:  {DIM}{base_url}{RESET}")
    print(f"  Cases:   {len(results)} judged")
    print()

    # ── Per-case scores ─────────────────────────────────────────────────────────
    print(f"{BOLD}Per-Case Scores{RESET}  (G=Groundedness R=Relevance RA=Role-Appropriateness A=Actionability)")
    print(f"{'─' * 60}")

    for r in sorted(results, key=lambda x: x["id"]):
        s      = r["scores"]
        passed = r["passed"]
        status = f"{GREEN}PASS{RESET}" if passed else f"{RED}FAIL{RESET}"
        bar    = score_bar(r["total_score"])
        dims   = (
            f"G={dim_bar(s['groundedness'])} "
            f"R={dim_bar(s['relevance'])} "
            f"RA={dim_bar(s['role_appropriateness'])} "
            f"A={dim_bar(s['actionability'])}"
        )
        latency = f"{r.get('latency_ms', 0) / 1000:.1f}s"
        print(
            f"  {r['id']:10s} [{r['role']:14s}]  {status}  "
            f"{bar}  {dims}  {DIM}{latency}{RESET}"
        )
        if not passed:
            # Print reasoning for failed cases
            reasoning = r.get("judge_reasoning", "")
            if reasoning:
                # Word-wrap at 70 chars
                words   = reasoning.split()
                line    = "    → "
                wrapped = []
                for word in words:
                    if len(line) + len(word) + 1 > 74:
                        wrapped.append(line)
                        line = "      " + word + " "
                    else:
                        line += word + " "
                wrapped.append(line)
                for wl in wrapped:
                    print(f"{DIM}{wl.rstrip()}{RESET}")

    print()

    # ── By agent ────────────────────────────────────────────────────────────────
    print(f"{BOLD}By Agent{RESET}")
    print(f"{'─' * 40}")
    for agent in ["account", "enablement"]:
        agent_results = [r for r in results if r["agent"] == agent]
        if not agent_results:
            continue
        scores    = [r["total_score"] for r in agent_results]
        passed_n  = sum(1 for r in agent_results if r["passed"])
        avg_score = avg(scores)
        avg_lat   = avg([r.get("latency_ms", 0) for r in agent_results]) / 1000
        bar       = score_bar(round(avg_score))
        prev_avg  = None

        if prev_data:
            prev_results = [r for r in prev_data.get("results", [])
                           if r.get("scores") and r["agent"] == agent]
            if prev_results:
                prev_avg = avg([r["total_score"] for r in prev_results])

        diff = f"  {delta_str(avg_score, prev_avg)}" if prev_avg is not None else ""
        print(
            f"  {agent:12s}  {passed_n}/{len(agent_results)} passed  "
            f"avg {bar}{diff}  {DIM}{avg_lat:.1f}s avg latency{RESET}"
        )

    print()

    # ── By role ─────────────────────────────────────────────────────────────────
    print(f"{BOLD}By Role{RESET}")
    print(f"{'─' * 40}")
    for role in ["ae", "se", "csm", "tam", "sales_manager"]:
        role_results = [r for r in results if r["role"] == role]
        if not role_results:
            continue
        scores   = [r["total_score"] for r in role_results]
        passed_n = sum(1 for r in role_results if r["passed"])
        avg_s    = avg(scores)
        colour   = GREEN if avg_s >= PASS_THRESHOLD else (YELLOW if avg_s >= 6 else RED)
        print(
            f"  {role:15s}  {passed_n}/{len(role_results)} passed  "
            f"{colour}avg {avg_s:.1f}/12{RESET}"
        )

    print()

    # ── Overall ─────────────────────────────────────────────────────────────────
    total_passed = sum(1 for r in results if r["passed"])
    all_scores   = [r["total_score"] for r in results]
    overall_avg  = avg(all_scores)
    pass_rate    = (total_passed / len(results) * 100) if results else 0
    overall_bar  = score_bar(round(overall_avg))

    prev_overall = None
    if prev_data:
        prev_judged = [r for r in prev_data.get("results", []) if r.get("scores")]
        if prev_judged:
            prev_overall = avg([r["total_score"] for r in prev_judged])

    diff = f"  {delta_str(overall_avg, prev_overall)}" if prev_overall is not None else ""

    status_colour = GREEN if pass_rate >= CI_PASS_RATE else RED
    print(f"{BOLD}Overall{RESET}")
    print(f"{'─' * 40}")
    print(
        f"  {total_passed}/{len(results)} cases passed "
        f"({status_colour}{pass_rate:.0f}%{RESET})"
    )
    print(f"  Average score: {overall_bar}{diff}")

    if pass_rate < CI_PASS_RATE:
        print(
            f"\n  {RED}{BOLD}Below CI threshold ({CI_PASS_RATE:.0f}%). "
            f"Check failed cases above.{RESET}"
        )
    else:
        print(f"\n  {GREEN}{BOLD}All checks passed.{RESET}")

    print(f"{BOLD}{CYAN}{'━' * 60}{RESET}\n")

    return pass_rate


# ── Regression diff ────────────────────────────────────────────────────────────

def print_regression(current: dict, previous: dict) -> None:
    curr_by_id = {r["id"]: r for r in current["results"] if r.get("scores")}
    prev_by_id = {r["id"]: r for r in previous["results"] if r.get("scores")}

    common = set(curr_by_id) & set(prev_by_id)
    if not common:
        return

    regressions   = []
    improvements  = []

    for case_id in sorted(common):
        curr_score = curr_by_id[case_id]["total_score"]
        prev_score = prev_by_id[case_id]["total_score"]
        diff       = curr_score - prev_score

        if diff <= -2:
            regressions.append((case_id, prev_score, curr_score, diff))
        elif diff >= 2:
            improvements.append((case_id, prev_score, curr_score, diff))

    if not regressions and not improvements:
        print(f"{DIM}  No significant changes vs previous run (±1 within noise){RESET}\n")
        return

    if regressions:
        print(f"{BOLD}{RED}Regressions (dropped ≥2 points):{RESET}")
        for case_id, prev_s, curr_s, diff in regressions:
            print(f"  {case_id:10s}  {prev_s}/12 → {curr_s}/12  {RED}({diff}){RESET}")
        print()

    if improvements:
        print(f"{BOLD}{GREEN}Improvements (gained ≥2 points):{RESET}")
        for case_id, prev_s, curr_s, diff in improvements:
            print(f"  {case_id:10s}  {prev_s}/12 → {curr_s}/12  {GREEN}(+{diff}){RESET}")
        print()


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="SE Intel eval report generator")
    parser.add_argument(
        "results_file",
        nargs="?",
        help="Path to a judged results JSON file. Defaults to the latest.",
    )
    parser.add_argument(
        "--no-regression",
        action="store_true",
        help="Skip regression comparison with the previous run",
    )
    parser.add_argument(
        "--ci",
        action="store_true",
        help=f"Exit with code 1 if pass rate < {CI_PASS_RATE}%",
    )
    args = parser.parse_args()

    # Resolve results file
    if args.results_file:
        current_path = Path(args.results_file)
        if not current_path.exists():
            print(f"{RED}File not found: {current_path}{RESET}")
            sys.exit(1)
        current_data = load_run(current_path)
        # Find previous run for regression (best effort)
        all_judged = find_runs(2)
        prev_data  = load_run(all_judged[1]) if len(all_judged) >= 2 else None
    else:
        judged_runs = find_runs(2)
        if not judged_runs:
            print(f"{RED}No judged run files found in {RESULTS_DIR}{RESET}")
            print("Run: python eval/runner.py && python eval/judge.py --latest")
            sys.exit(1)
        current_data = load_run(judged_runs[0])
        prev_data    = load_run(judged_runs[1]) if len(judged_runs) >= 2 else None

    if not current_data.get("meta", {}).get("judged"):
        print(f"{YELLOW}This run has not been judged yet.{RESET}")
        print("Run: python eval/judge.py --latest")
        sys.exit(1)

    # Print main report
    pass_rate = print_report(current_data, prev_data)

    # Regression diff
    if not args.no_regression and prev_data and prev_data.get("meta", {}).get("judged"):
        prev_run_id = prev_data["meta"]["run_id"]
        print(f"{BOLD}Regression vs {DIM}{prev_run_id}{RESET}{BOLD}:{RESET}")
        print_regression(current_data, prev_data)

    # CI exit code
    if args.ci and pass_rate < CI_PASS_RATE:
        sys.exit(1)


if __name__ == "__main__":
    main()
