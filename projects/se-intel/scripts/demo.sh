#!/usr/bin/env bash
# demo.sh — SE Intel end-to-end demo
#
# Shows:
#   1. Health check
#   2. Auth enforcement (no token → 401)
#   3. Dev token generation (SE role)
#   4. AccountIntelAgent — company research
#   5. EnablementAgent — objection handling
#   6. RBAC in action — AE gets public KB only
#   7. Manager role — gets deal strategy KB
#   8. Audit log — D1 shows all requests
#
# Usage:
#   chmod +x scripts/demo.sh
#   ./scripts/demo.sh
#
# Requirements: curl, jq

set -e

BASE="https://se-intel-portfolio.stephenmack96.workers.dev"
BOLD="\033[1m"
DIM="\033[2m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

# ── helpers ───────────────────────────────────────────────────────────────────
header() { echo -e "\n${BOLD}${CYAN}━━━ $1 ${RESET}"; }
ok()     { echo -e "${GREEN}✓${RESET} $1"; }
info()   { echo -e "${DIM}  $1${RESET}"; }
result() { echo -e "${YELLOW}→${RESET} $1"; }

pause() {
  if [ "${CI:-}" != "true" ]; then
    echo -e "\n${DIM}Press Enter to continue...${RESET}"
    read -r
  fi
}

# ── 1. Health ─────────────────────────────────────────────────────────────────
header "1. Health Check"
HEALTH=$(curl -s "$BASE/health")
STATUS=$(echo "$HEALTH" | jq -r '.status')
ENV=$(echo "$HEALTH"   | jq -r '.environment')
ok "Worker is live"
info "status: $STATUS  |  environment: $ENV"
info "agents: $(echo "$HEALTH" | jq -r '.agents | join(", ")')"

pause

# ── 2. Auth enforcement ───────────────────────────────────────────────────────
header "2. Auth Enforcement — no token → 401"
UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/v1/account" \
  -H "Content-Type: application/json" \
  -d '{"message":"test"}')
ok "Got HTTP $UNAUTH (expected 401)"
info "JWT required for all /api/* routes"

pause

# ── 3. Dev token — SE role ────────────────────────────────────────────────────
header "3. Get Dev Token (role: se)"
SE_TOKEN=$(curl -s -X POST "$BASE/dev/token" \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","role":"se","name":"Alice Chen","orgId":"cloudflare"}' \
  | jq -r '.token')
ok "Token obtained"
info "Token (first 40 chars): ${SE_TOKEN:0:40}..."
info "Expires in 24h — HS256 signed, includes role + orgId claims"

pause

# ── 4. AccountIntelAgent — company research ────────────────────────────────────
header "4. AccountIntelAgent — Research Stripe"
info "Sending: 'Research Stripe — tech stack and Cloudflare opportunity'"
info "Tools: kb_search (public namespace), web_search (SE role has access)"
echo ""

ACC=$(curl -s -X POST "$BASE/api/v1/account" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SE_TOKEN" \
  -d '{"message":"Research Stripe — what is their tech stack and Cloudflare opportunity?","threadId":"demo-account-001"}')

echo "$ACC" | jq '{latencyMs: .latencyMs, toolsUsed: .toolsUsed, model: .model}'
echo ""
result "Response (first 400 chars):"
echo "$ACC" | jq -r '.response' | head -c 400
echo "..."

pause

# ── 5. EnablementAgent — objection handling ────────────────────────────────────
header "5. EnablementAgent — Handle Lambda Objection"
info "Sending: 'How does Workers compare to Lambda? Prospect asking about vendor lock-in'"
info "Tools: kb_search (public + se_only namespaces for SE role)"
echo ""

ENBL=$(curl -s -X POST "$BASE/api/v1/enablement" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SE_TOKEN" \
  -d '{"message":"How does Cloudflare Workers compare to AWS Lambda? Prospect is asking about vendor lock-in.","threadId":"demo-enablement-001"}')

echo "$ENBL" | jq '{latencyMs: .latencyMs, toolsUsed: .toolsUsed, model: .model}'
echo ""
result "Response (first 400 chars):"
echo "$ENBL" | jq -r '.response' | head -c 400
echo "..."

pause

# ── 6. RBAC — AE role gets public KB only ────────────────────────────────────
header "6. RBAC in Action — AE role (public KB only)"
AE_TOKEN=$(curl -s -X POST "$BASE/dev/token" \
  -H "Content-Type: application/json" \
  -d '{"userId":"bob","role":"ae","name":"Bob Liang","orgId":"cloudflare"}' \
  | jq -r '.token')
ok "AE token obtained (role: ae)"
info "AE only has access to 'public' namespace — no se_only or manager_only"

AE_RESP=$(curl -s -X POST "$BASE/api/v1/enablement" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AE_TOKEN" \
  -d '{"message":"POC pattern for migrating AWS Lambda to Workers","threadId":"demo-ae-001"}')

echo "$AE_RESP" | jq '{toolsUsed: .toolsUsed, latencyMs: .latencyMs}'
info "Same tools, but Vectorize filtered to 'public' namespace only"
info "AE cannot access se_only POC guides or manager_only pricing content"

pause

# ── 7. Manager role — deal strategy KB ───────────────────────────────────────
header "7. Manager Role — Deal Strategy + Pricing"
MGR_TOKEN=$(curl -s -X POST "$BASE/dev/token" \
  -H "Content-Type: application/json" \
  -d '{"userId":"carol","role":"sales_manager","name":"Carol Davis","orgId":"cloudflare"}' \
  | jq -r '.token')
ok "Manager token obtained (role: sales_manager)"
info "Manager gets public + se_only + manager_only namespaces (all 102 chunks)"

MGR_RESP=$(curl -s -X POST "$BASE/api/v1/enablement" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MGR_TOKEN" \
  -d '{"message":"Deal is stalled at $250K — discount approval process and how to get executive sponsorship?","threadId":"demo-mgr-001"}')

echo "$MGR_RESP" | jq '{toolsUsed: .toolsUsed, latencyMs: .latencyMs}'
echo ""
result "Response (first 400 chars):"
echo "$MGR_RESP" | jq -r '.response' | head -c 400
echo "..."

pause

# ── 8. Audit log ──────────────────────────────────────────────────────────────
header "8. D1 Audit Log — All Requests Captured"
info "Querying: SELECT role, agent_type, tools_used, response_latency_ms FROM audit_log ORDER BY timestamp DESC LIMIT 6"
echo ""

npx --yes wrangler d1 execute se-intel-portfolio-db \
  --command="SELECT role, agent_type, tools_used, response_latency_ms FROM audit_log ORDER BY timestamp DESC LIMIT 6;" \
  --remote 2>/dev/null | grep -A 100 '"results"' | head -50

echo ""
ok "Every request logged: user, role, agent, tools used, latency"
info "Used for: usage analytics, eval harness replay, security audit, cost tracking"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}━━━ Demo Complete ━━━${RESET}"
echo ""
echo -e "  Live URL:    ${CYAN}$BASE${RESET}"
echo -e "  UI:          ${CYAN}$BASE/${RESET}"
echo -e "  Health:      ${CYAN}$BASE/health${RESET}"
echo -e "  Dev tokens:  POST $BASE/dev/token"
echo ""
echo -e "  Agents:      AccountIntelAgent  |  EnablementAgent"
echo -e "  KB chunks:   102 (public: 80, se_only: 12, manager_only: 10)"
echo -e "  RBAC roles:  ae  |  se  |  csm  |  tam  |  sales_manager"
echo -e "  Stack:       Workers + Durable Objects + Vectorize + D1 + KV + Workers AI"
echo ""
