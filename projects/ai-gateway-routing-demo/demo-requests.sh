#!/bin/bash
# AI Gateway Dynamic Routing — Demo Requests
# Sends 4 requests with different metadata tags and shows which model served each one.
#
# Usage:
#   export ACCOUNT_ID="your-cloudflare-account-id"
#   export GATEWAY_ID="your-gateway-id"
#   export CF_AIG_TOKEN="your-ai-gateway-auth-token"
#   chmod +x demo-requests.sh
#   ./demo-requests.sh

set -e

# ── Variables ──────────────────────────────────────────────────────────────────
ACCOUNT_ID="${ACCOUNT_ID:?Set ACCOUNT_ID env var}"
GATEWAY_ID="${GATEWAY_ID:?Set GATEWAY_ID env var}"
CF_AIG_TOKEN="${CF_AIG_TOKEN:?Set CF_AIG_TOKEN env var}"
GATEWAY_URL="https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/compat/chat/completions"

# ── Helper ─────────────────────────────────────────────────────────────────────
run_request() {
  local label="$1"
  local workflow="$2"
  local prompt="$3"
  local expected_model="$4"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ${label}"
  echo "  workflow: ${workflow}"
  echo "  expected: ${expected_model}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local metadata
  metadata=$(printf '{"team":"engineering","workflow":"%s","userId":"smack"}' "${workflow}")

  response=$(curl -s -D - -X POST "${GATEWAY_URL}" \
    --header "cf-aig-authorization: Bearer ${CF_AIG_TOKEN}" \
    --header "Content-Type: application/json" \
    --header "cf-aig-metadata: ${metadata}" \
    --data "$(printf '{"model":"dynamic/engineering","messages":[{"role":"user","content":"%s"}]}' "${prompt}")" \
    2>/dev/null)

  model=$(echo "${response}"  | grep -i "cf-aig-model"    | awk '{print $2}' | tr -d '\r')
  provider=$(echo "${response}" | grep -i "cf-aig-provider" | awk '{print $2}' | tr -d '\r')
  status=$(echo "${response}"  | grep -i "HTTP/"           | awk '{print $2}' | tr -d '\r')

  echo "  status:   ${status:-unknown}"
  echo "  model:    ${model:-unknown}"
  echo "  provider: ${provider:-unknown}"

  if [ "${model}" = "${expected_model}" ]; then
    echo "  result:   ✓ Routed correctly"
  else
    echo "  result:   ✗ Unexpected model — check route config"
  fi
}

# ── Main ───────────────────────────────────────────────────────────────────────
echo ""
echo "AI Gateway Dynamic Routing Demo"
echo "Route: dynamic/engineering"
echo "Gateway: ${GATEWAY_URL}"

# Request 1 — Code Review → gpt-4.1
run_request \
  "1 / 4 — Code Review" \
  "code_review" \
  "Review this TypeScript for edge cases: function divide(a: number, b: number): number { return a \/ b; }" \
  "gpt-4.1"

# Request 2 — Meeting Prep → gpt-4o-mini
run_request \
  "2 / 4 — Meeting Prep" \
  "meeting_prep" \
  "Summarize in 3 bullets: We discussed Q3 roadmap. Sarah raised timeline concerns. Tom suggested deprioritizing mobile. Decision: push mobile to Q4, focus on API stability." \
  "gpt-4o-mini"

# Request 3 — Incident Triage → gpt-4.1
run_request \
  "3 / 4 — Incident Triage" \
  "incident_triage" \
  "API returning 503s. Logs: connection timeout to db-primary:5432. Redis cache hit rate dropped from 94% to 12%. Likely causes and immediate remediation steps?" \
  "gpt-4.1"

# Request 4 — Slack Summary → Workers AI llama-3.1-8b
run_request \
  "4 / 4 — Slack Summary" \
  "slack_summary" \
  "Summarize this Slack thread in one sentence: Alex: anyone know why staging is slow? Jordan: probably the new deploy. Alex: yeah just rolled back. Jordan: confirmed, back to normal." \
  "@cf\/meta\/llama-3.1-8b-instruct"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done. Check the AI Gateway dashboard to see cost per request."
echo "  Filter logs by metadata.workflow to see breakdown by task type."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
