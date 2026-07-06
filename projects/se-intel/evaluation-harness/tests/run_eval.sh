#!/usr/bin/env bash
# tests/run_eval.sh
#
# One command to run the full SE Intel eval harness:
#   Step 1: runner.py        — call live API (?debug=true), record raw results + retrieved chunks
#   Step 2: faithfulness.py  — deterministic grounding check (the CI gate)
#   Step 3: judge.py         — score each result with LLM-as-judge (incl. faithfulness dim)
#   Step 4: report.py        — print scored report + faithfulness section + regression diff
#
# Usage:
#   cd evaluation-harness
#   ./tests/run_eval.sh
#
#   # CI mode (exit 1 if pass rate < 80%)
#   ./tests/run_eval.sh --ci
#
#   # Single agent
#   ./tests/run_eval.sh --cases cases/enablement.json
#
# Requirements:
#   pip install -r requirements.txt
#   .env file with BASE_URL, CF_ACCOUNT_ID, CF_API_TOKEN

set -e

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HARNESS_DIR"

CI_MODE=false
RUNNER_ARGS=""

# Parse flags
for arg in "$@"; do
  case $arg in
    --ci)           CI_MODE=true ;;
    --cases=*)      RUNNER_ARGS="--cases ${arg#*=}" ;;
    --cases)        shift; RUNNER_ARGS="--cases $1" ;;
  esac
done

BOLD="\033[1m"
CYAN="\033[36m"
DIM="\033[2m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}${CYAN}SE Intel Evaluation Harness${RESET}"
echo -e "${DIM}Directory: $HARNESS_DIR${RESET}"
echo ""

# ── Check Python ──────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "Error: python3 not found. Install Python 3.9+"
  exit 1
fi

# ── Check deps ────────────────────────────────────────────────────────────────
python3 -c "import httpx, dotenv" 2>/dev/null || {
  echo "Installing dependencies..."
  pip install -r requirements.txt -q
}

# ── Check .env ────────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "Error: .env file not found."
  echo "Copy .env.example to .env and fill in CF_ACCOUNT_ID and CF_API_TOKEN"
  exit 1
fi

if grep -q "PASTE_YOUR_NEW_TOKEN_HERE" .env 2>/dev/null; then
  echo "Error: CF_API_TOKEN not set in .env"
  echo "Edit .env and paste your Cloudflare API token"
  exit 1
fi

# ── Step 1: Runner ────────────────────────────────────────────────────────────
echo -e "${BOLD}Step 1/4 — Running test cases${RESET}"
python3 eval/runner.py $RUNNER_ARGS
echo ""

# ── Step 2: Faithfulness (deterministic CI gate) ───────────────────────────────
# Runs BEFORE the LLM judge. In CI mode this gate blocks deploy on any
# grounding_fail / hallucination_fail — deterministic, no LLM, can't be masked.
echo -e "${BOLD}Step 2/4 — Deterministic faithfulness check${RESET}"
if [ "$CI_MODE" = true ]; then
  python3 eval/faithfulness.py --latest --ci
else
  python3 eval/faithfulness.py --latest
fi
echo ""

# ── Step 3: Judge ─────────────────────────────────────────────────────────────
echo -e "${BOLD}Step 3/4 — Scoring with LLM-as-judge${RESET}"
python3 eval/judge.py --latest
echo ""

# ── Step 4: Report ────────────────────────────────────────────────────────────
echo -e "${BOLD}Step 4/4 — Generating report${RESET}"
if [ "$CI_MODE" = true ]; then
  python3 eval/report.py --ci
else
  python3 eval/report.py
fi
