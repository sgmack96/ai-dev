#!/usr/bin/env bash
# tests/isolation-test.sh
#
# End-to-end multi-tenancy isolation test for SE Intel.
# Calls all three admin probes in sequence and asserts isolationOk: true.
#
# This is the Week 1 capstone artifact — one command, three assertions,
# zero LLM in the test path. Every probe is deterministic.
#
# Usage:
#   cd evaluation-harness
#   ./tests/isolation-test.sh
#
# CI mode (exit 1 on any failure):
#   ./tests/isolation-test.sh --ci
#
# Requirements:
#   - curl and jq installed
#   - JWT_SECRET available (reads from ../../.dev.vars)
#   - Worker deployed at BASE_URL

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$(cd "$HARNESS_DIR/.." && pwd)"

# Load BASE_URL from .env
if [ -f "$HARNESS_DIR/.env" ]; then
  # shellcheck disable=SC1091
  source <(grep '^BASE_URL=' "$HARNESS_DIR/.env")
fi
BASE_URL="${BASE_URL:-https://se-intel-portfolio.stephenmack96.workers.dev}"

# Load JWT_SECRET from project .dev.vars
if [ -f "$PROJECT_DIR/.dev.vars" ]; then
  SECRET=$(grep '^JWT_SECRET=' "$PROJECT_DIR/.dev.vars" | cut -d= -f2-)
fi

if [ -z "${SECRET:-}" ]; then
  echo "Error: JWT_SECRET not found in $PROJECT_DIR/.dev.vars"
  exit 1
fi

# Parse flags
CI_MODE=false
for arg in "$@"; do
  case $arg in
    --ci) CI_MODE=true ;;
  esac
done

# ── Colours ───────────────────────────────────────────────────────────────────

BOLD="\033[1m"
GREEN="\033[32m"
RED="\033[31m"
CYAN="\033[36m"
DIM="\033[2m"
RESET="\033[0m"

# ── Test runner ───────────────────────────────────────────────────────────────

PASS=0
FAIL=0
RESULTS=()

run_probe() {
  local name="$1"
  local endpoint="$2"
  local payload="$3"

  echo -e "${DIM}  → $name${RESET}"

  local response
  response=$(curl -sX POST "$BASE_URL$endpoint" \
    -H "Authorization: Bearer $SECRET" \
    -H "CF-Access-Jwt-Assertion: probe" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>&1)

  local isolation_ok
  isolation_ok=$(echo "$response" | jq -r '.isolationOk // "null"')

  if [ "$isolation_ok" = "true" ]; then
    echo -e "    ${GREEN}✓ PASS${RESET} — isolationOk: true"
    PASS=$((PASS + 1))
    RESULTS+=("PASS|$name")
  else
    echo -e "    ${RED}✗ FAIL${RESET} — isolationOk: $isolation_ok"
    echo -e "    ${DIM}Response: $(echo "$response" | jq -c .)${RESET}"
    FAIL=$((FAIL + 1))
    RESULTS+=("FAIL|$name")
  fi
}

# ── Run all probes ────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}SE Intel — Multi-Tenancy Isolation Test${RESET}"
echo -e "${DIM}Target: $BASE_URL${RESET}"
echo -e "${DIM}Orgs: acme vs portfolio-org${RESET}"
echo ""

echo -e "${BOLD}Layer 1: RAG (Vectorize)${RESET}"
run_probe "kb-probe" "/admin/kb-probe" \
  '{"query":"negotiated Cloudflare discount","role":"se","orgId":"acme"}'

echo ""
echo -e "${BOLD}Layer 2: Memory (DO + KV)${RESET}"
run_probe "memory-probe" "/admin/memory-probe" \
  '{"userId":"isolation-test-user","orgA":"acme","orgB":"portfolio-org"}'

echo ""
echo -e "${BOLD}Layer 3: Audit (D1)${RESET}"
run_probe "audit-probe" "/admin/audit-probe" \
  '{"orgA":"acme","orgB":"portfolio-org"}'

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}Results: ${GREEN}$PASS passed${RESET}, ${RED}$FAIL failed${RESET} (of $((PASS + FAIL)))"
echo ""

printf "  %-20s %s\n" "PROBE" "RESULT"
printf "  %-20s %s\n" "─────" "──────"
for r in "${RESULTS[@]}"; do
  status="${r%%|*}"
  name="${r##*|}"
  if [ "$status" = "PASS" ]; then
    printf "  %-20s ${GREEN}%s${RESET}\n" "$name" "✓ PASS"
  else
    printf "  %-20s ${RED}%s${RESET}\n" "$name" "✗ FAIL"
  fi
done

echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}${BOLD}ISOLATION TEST FAILED${RESET} — $FAIL probe(s) returned isolationOk: false"
  if [ "$CI_MODE" = true ]; then
    exit 1
  fi
else
  echo -e "${GREEN}${BOLD}ALL ISOLATION TESTS PASSED${RESET} — 3/3 layers verified"
  echo -e "${DIM}No LLM in the test path. Every assertion is deterministic.${RESET}"
fi
