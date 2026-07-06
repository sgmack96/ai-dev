#!/usr/bin/env bash
# tests/health-probe.sh
#
# Week 3 capstone probe — verifies the observability + SLO system end-to-end.
# Calls /admin/health-scorecard and asserts:
#   1. The endpoint returns HTTP 200
#   2. At least one org has data (metrics are being written)
#   3. No org has errorRatePct above the SLO target (5%)
#   4. p95 latency is reported (not zero — proves the percentile calc works)
#
# No LLM in the path. Every assertion is deterministic.
#
# Usage:
#   cd evaluation-harness
#   ./tests/health-probe.sh
#
# CI mode (exit 1 on any failure):
#   ./tests/health-probe.sh --ci
#
# Requirements:
#   - curl and jq installed
#   - JWT_SECRET available (reads from ../../.dev.vars)
#   - Worker deployed at BASE_URL

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$(cd "$HARNESS_DIR/.." && pwd)"

# Load BASE_URL from .env if present
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
WINDOW=168   # 7-day window — wide enough to always have data in a dev system
for arg in "$@"; do
  case $arg in
    --ci) CI_MODE=true ;;
    --window=*) WINDOW="${arg#*=}" ;;
  esac
done

# ── Colours ───────────────────────────────────────────────────────────────────

BOLD="\033[1m"
GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
CYAN="\033[36m"
DIM="\033[2m"
RESET="\033[0m"

# ── Fetch scorecard ───────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}SE Intel — Observability Health Probe${RESET}"
echo -e "${DIM}Target: $BASE_URL${RESET}"
echo -e "${DIM}Window: last ${WINDOW}h${RESET}"
echo ""

RESPONSE=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  "$BASE_URL/admin/health-scorecard?window=$WINDOW" \
  -H "Authorization: Bearer $SECRET" \
  -H "CF-Access-Jwt-Assertion: probe" 2>&1)

HTTP_STATUS=$(echo "$RESPONSE" | grep '__HTTP_STATUS__' | sed 's/__HTTP_STATUS__//')
BODY=$(echo "$RESPONSE" | grep -v '__HTTP_STATUS__')

# ── Test runner ───────────────────────────────────────────────────────────────

PASS=0
FAIL=0
RESULTS=()

assert() {
  local name="$1"
  local result="$2"   # "true" or "false"
  local detail="$3"

  echo -e "${DIM}  → $name${RESET}"
  if [ "$result" = "true" ]; then
    echo -e "    ${GREEN}✓ PASS${RESET} — $detail"
    PASS=$((PASS + 1))
    RESULTS+=("PASS|$name")
  else
    echo -e "    ${RED}✗ FAIL${RESET} — $detail"
    FAIL=$((FAIL + 1))
    RESULTS+=("FAIL|$name")
  fi
}

# ── Assertion 1: HTTP 200 ─────────────────────────────────────────────────────

echo -e "${BOLD}Check 1: Endpoint reachable${RESET}"
if [ "$HTTP_STATUS" = "200" ]; then
  assert "http-200" "true" "HTTP $HTTP_STATUS"
else
  assert "http-200" "false" "HTTP $HTTP_STATUS — endpoint returned error"
  echo -e "  ${DIM}Response body: $BODY${RESET}"
  # Fail fast — can't run further assertions without a valid response
  echo ""
  echo -e "${RED}${BOLD}HEALTH PROBE FAILED${RESET} — endpoint unreachable"
  if [ "$CI_MODE" = true ]; then exit 1; fi
  exit 0
fi

# ── Assertion 2: At least one org has data ────────────────────────────────────

echo ""
echo -e "${BOLD}Check 2: Metrics are being written${RESET}"
ORG_COUNT=$(echo "$BODY" | jq '.orgCount // 0')
if [ "$ORG_COUNT" -gt 0 ]; then
  assert "orgs-have-data" "true" "$ORG_COUNT org(s) have request_metrics rows"
else
  assert "orgs-have-data" "false" "orgCount=0 — no metrics rows found. Is writeMetric() wired?"
fi

# ── Assertion 3: Error rate SLO — no org exceeds 5% ──────────────────────────

echo ""
echo -e "${BOLD}Check 3: Error rate SLO (target: ≤5%)${RESET}"
ORGS=$(echo "$BODY" | jq -c '.orgs[]')
ERROR_RATE_OK=true
while IFS= read -r org; do
  ORG_ID=$(echo "$org" | jq -r '.orgId')
  ERROR_PCT=$(echo "$org" | jq -r '.errorRatePct')
  SLO_PASSING=$(echo "$org" | jq -r '.slos.errorRate.passing')
  echo -e "${DIM}  → $ORG_ID: errorRate=${ERROR_PCT}% (passing: $SLO_PASSING)${RESET}"
  if [ "$SLO_PASSING" != "true" ]; then
    ERROR_RATE_OK=false
  fi
done <<< "$ORGS"

if [ "$ERROR_RATE_OK" = "true" ]; then
  assert "error-rate-slo" "true" "All orgs within 5% error rate SLO"
else
  assert "error-rate-slo" "false" "One or more orgs exceeded 5% error rate SLO"
fi

# ── Assertion 4: p95 latency is reported (non-zero) ──────────────────────────

echo ""
echo -e "${BOLD}Check 4: p95 latency is calculated (percentile math works)${RESET}"
P95_VALUES=$(echo "$BODY" | jq '[.orgs[].p95LatencyMs]')
ALL_NONZERO=$(echo "$P95_VALUES" | jq 'all(. > 0)')

if [ "$ALL_NONZERO" = "true" ]; then
  # Show the actual p95 values + SLO status for each org
  while IFS= read -r org; do
    ORG_ID=$(echo "$org" | jq -r '.orgId')
    P95=$(echo "$org" | jq -r '.p95LatencyMs')
    TARGET=$(echo "$org" | jq -r '.slos.latency.targetMs')
    LAT_PASSING=$(echo "$org" | jq -r '.slos.latency.passing')
    if [ "$LAT_PASSING" = "true" ]; then
      echo -e "${DIM}  → $ORG_ID: p95=${P95}ms / target=${TARGET}ms ${GREEN}✓${RESET}${RESET}"
    else
      echo -e "${DIM}  → $ORG_ID: p95=${P95}ms / target=${TARGET}ms ${YELLOW}⚠ above target${RESET}${RESET}"
    fi
  done <<< "$ORGS"
  assert "p95-calculated" "true" "All orgs have non-zero p95 — percentile calculation working"
else
  assert "p95-calculated" "false" "One or more orgs has p95=0 — latency data missing or percentile calc broken"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}Results: ${GREEN}$PASS passed${RESET}, ${RED}$FAIL failed${RESET} (of $((PASS + FAIL)))"
echo ""

# Print the actual health status from the scorecard
OVERALL_STATUS=$(echo "$BODY" | jq -r '.status')
if [ "$OVERALL_STATUS" = "healthy" ]; then
  echo -e "  Scorecard status: ${GREEN}${BOLD}healthy${RESET}"
else
  echo -e "  Scorecard status: ${YELLOW}${BOLD}degraded${RESET} (latency SLO above target — see p95 above)"
fi

echo ""
printf "  %-30s %s\n" "CHECK" "RESULT"
printf "  %-30s %s\n" "─────" "──────"
for r in "${RESULTS[@]}"; do
  status="${r%%|*}"
  name="${r##*|}"
  if [ "$status" = "PASS" ]; then
    printf "  %-30s ${GREEN}%s${RESET}\n" "$name" "✓ PASS"
  else
    printf "  %-30s ${RED}%s${RESET}\n" "$name" "✗ FAIL"
  fi
done

echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}${BOLD}HEALTH PROBE FAILED${RESET} — $FAIL check(s) did not pass"
  if [ "$CI_MODE" = true ]; then
    exit 1
  fi
else
  echo -e "${GREEN}${BOLD}ALL HEALTH CHECKS PASSED${RESET} — observability system verified"
  echo -e "${DIM}No LLM in the test path. Every assertion is deterministic.${RESET}"
  echo -e "${DIM}Note: 'degraded' scorecard status is expected when p95 > target —${RESET}"
  echo -e "${DIM}that means the SLO detection is working, not that the probe failed.${RESET}"
fi
