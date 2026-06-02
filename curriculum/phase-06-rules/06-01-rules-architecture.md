# Module 6.1 — Rules Engine Architecture
> **Dashboard Location:** macksportreport.com → Rules → Overview
> **Estimated Time:** 60 minutes
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Is the Cloudflare Ruleset Engine?

The Cloudflare Ruleset Engine is the unified framework that powers every rule-based decision Cloudflare makes for your traffic. WAF rules, transform rules, cache rules, redirect rules, rate limiting rules — all of them run inside this single, ordered pipeline called the **Ruleset Engine**.

Before the Ruleset Engine existed, Cloudflare had a patchwork of separate systems: Page Rules, Firewall Rules, Rate Limiting, Transform Rules. Each had its own syntax, its own limits, its own edge behavior. The Ruleset Engine unified all of these under one consistent model:

- **One expression language** (Wireshark-inspired filter syntax)
- **One ordering model** (phases, then priority within phases)
- **One API** (the Rulesets API, replacing the old Firewall Rules API)
- **One Terraform resource** (`cloudflare_ruleset`)

For a Solutions Engineer, understanding this architecture is essential because:
1. You can explain to customers how rules interact and why order matters
2. You can debug rule conflicts and unexpected behavior
3. You can scope professional services engagements around rules migrations
4. You can design complex, multi-condition rule chains for enterprise customers

### The Phase Pipeline

Every HTTP request that hits Cloudflare traverses a sequence of **phases** in a deterministic order. A phase is a logical stage in request/response processing. Rules execute within their assigned phase, and phases execute in a fixed sequence.

**Inbound Request Phases (in order):**

| Phase | What Runs Here |
|---|---|
| `http_request_firewall_custom` | Custom WAF rules (your own allow/block/challenge logic) |
| `http_request_transform` | URL rewrites, request header modifications |
| `http_request_firewall_managed` | Cloudflare Managed WAF rulesets (OWASP, CF Managed) |
| `http_request_rate_limit` | Rate limiting rules |
| `http_request_cache_settings` | Cache Rules (override TTL, cache everything, bypass) |
| `http_request_dynamic_redirect` | Single Redirects |
| `http_request_bulk_redirects` | Bulk Redirects (list-based) |

**Outbound Response Phases (in order):**

| Phase | What Runs Here |
|---|---|
| `http_response_headers_transform` | Response header modifications |
| `http_response_firewall_managed` | Response scanning rules |

**Key insight:** Phases are not configurable. You cannot reorder phases. A transform rule will always run after custom firewall rules and before managed WAF rules. This is by design.

---

## Deep Dive (Architect-Level)

### Rule Priority Within a Phase

Within any single phase, you may have multiple rules. These execute in **ascending numeric priority order** — the rule with the **lowest priority number executes first**.

```
Rule A — priority 1   ← executes first
Rule B — priority 100 ← executes second
Rule C — priority 1000 ← executes third
```

When you create rules in the dashboard, Cloudflare assigns priorities automatically (typically incrementing by 1000). You can reorder via drag-and-drop or by directly setting priority values via API.

**Why this matters:** If Rule A blocks a request, Rule B never fires. If Rule A issues a "skip" action, you can bypass Rule B. Rule ordering is a security and performance decision.

### Rule Actions and the Action Hierarchy

Each rule has an **action** — what Cloudflare does when the rule matches:

| Action | Description |
|---|---|
| `block` | Return 403 (or custom response) |
| `challenge` | Present CAPTCHA/Turnstile challenge |
| `js_challenge` | JavaScript challenge (non-interactive) |
| `managed_challenge` | Cloudflare-selected challenge type |
| `log` | Log the match, take no other action |
| `skip` | Bypass subsequent rules (see below) |
| `rewrite` | Modify URL, headers (Transform Rules phase) |
| `redirect` | HTTP redirect to a new URL |
| `set_cache_settings` | Override cache behavior |
| `execute` | Execute a managed ruleset |

### Skip Rules: Bypassing the Pipeline

The `skip` action is one of the most powerful tools in the Ruleset Engine. A skip rule says: "if this condition is true, skip these other rules."

**Skip granularity options:**
- Skip all remaining rules in the current ruleset
- Skip a specific ruleset (e.g., skip the entire OWASP managed ruleset)
- Skip specific rules by ID
- Skip all remaining phases

**Use case example:** You have a known-good IP range (your internal penetration testing team). You want their traffic to bypass the WAF entirely:

```
# Skip rule
IF ip.src in {203.0.113.0/24}
THEN skip → Cloudflare Managed Ruleset (WAF), OWASP Ruleset
```

Without this skip rule, every pentest request would trigger WAF alerts. With it, their traffic flows through clean.

### Rule Chaining: AND / OR / NOT Logic

The Ruleset Engine expression language supports full boolean logic:

```
# AND — all conditions must match
(http.request.uri.path starts_with "/api") and (http.request.method eq "POST")

# OR — any condition must match
(ip.src.country eq "CN") or (ip.src.country eq "RU")

# NOT — condition must not match
not (ip.src in $trusted_ips)

# Grouped logic
(http.request.uri.path starts_with "/admin") and
(not (ip.src in {10.0.0.0/8})) and
(not cf.client.bot_score lt 30)
```

**Nested grouping with parentheses** follows standard boolean algebra. Complex enterprise rules often combine 5-10 conditions.

### Plan Limits

| Plan | Rules per Phase | Rulesets | Notes |
|---|---|---|---|
| Free | 5 custom rules | — | Basic protection only |
| Pro | 20 custom rules | — | Sufficient for small sites |
| Business | 100 custom rules | — | Most SMB use cases |
| Enterprise | Unlimited | Multiple | Account-level rulesets, nested rulesets |

**Selling insight:** For customers hitting the 100-rule limit on Business, the path to Enterprise is often justified by rules capacity alone. An e-commerce site with 50+ product categories, 20+ countries with different fraud patterns, and custom bot rules can exhaust 100 rules quickly.

### Account-Level Rulesets

Enterprise customers can create **account-level rulesets** that apply rules across all zones in the account simultaneously. This is critical for:

- MSPs managing hundreds of customer domains
- Enterprises with dozens of subdomains and properties
- Applying global security policies without per-zone configuration

**Architecture:** Account ruleset → "executes" into each zone → zone-level rules still apply after account rules.

```
Account Ruleset (applies to all zones)
  └── Block known malicious IPs (IP Intelligence feed)
  └── Block high-risk countries for all zones
  └── Skip WAF for internal monitoring tools

Zone Ruleset: macksportreport.com
  └── Custom rules specific to this zone
  └── Managed WAF (Cloudflare + OWASP)
```

### Rules vs. Page Rules: The Migration Story

This is a critical topic for SE customer conversations. Almost every existing customer has Page Rules. You must know the difference.

| Feature | Page Rules (Legacy) | Rules Engine (New) |
|---|---|---|
| URL Matching | Glob patterns (`*`) | Full expression language |
| Logic | Single condition | AND/OR/NOT boolean logic |
| Actions per rule | Multiple actions bundled | One action per rule, compose via priority |
| Phase awareness | No | Yes — explicit phase placement |
| API | Old Firewall Rules API | Rulesets API |
| Terraform | `cloudflare_page_rule` | `cloudflare_ruleset` |
| Limit (Free) | 3 | 5 custom WAF rules |
| Future | Being deprecated | Actively developed |

**The customer conversation:** "Page Rules work fine for simple redirects and cache overrides. But they can't do multi-condition logic, they don't support the expression language, and they're not receiving new features. For anything complex — or if you want to future-proof your setup — you should be migrating to the new Rules Engine."

### Terraform: `cloudflare_ruleset`

```hcl
resource "cloudflare_ruleset" "example" {
  zone_id     = var.zone_id
  name        = "Custom WAF Rules"
  description = "Block bad actors, skip trusted IPs"
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  rules {
    action = "skip"
    action_parameters {
      ruleset = "current"
    }
    expression  = "ip.src in {203.0.113.0/24}"
    description = "Skip WAF for pentest IPs"
    enabled     = true
  }

  rules {
    action      = "block"
    expression  = "(http.request.uri.path contains \"../\") or (http.request.uri.path contains \"..%2F\")"
    description = "Block path traversal attempts"
    enabled     = true
    priority    = 100
  }
}
```

**Key Terraform fields:**
- `kind`: `zone` (zone-level) or `root` (account-level)
- `phase`: which phase this ruleset belongs to
- `rules[].action_parameters`: phase-specific configuration for the action
- `rules[].enabled`: toggle without deleting

---

## Dashboard Walkthrough

### Step 1: Navigate to Rules Overview
1. Log into dash.cloudflare.com
2. Select **macksportreport.com**
3. Click **Rules** in the left sidebar
4. The overview page shows all rule types as cards: Transform Rules, Redirect Rules, Origin Rules, Cache Rules, Configuration Rules, etc.

### Step 2: Explore an Existing Phase
1. Click **Custom Rules** (under the WAF section or Rules → Overview)
2. Notice the **phase name** shown: `http_request_firewall_custom`
3. Each rule shows: Name, Expression, Action, Status (enabled/disabled), Priority (drag handle)
4. Click a rule to see its full expression in the visual builder or expression editor

### Step 3: View Rule Priority
1. Within any ruleset, rules are listed top-to-bottom in priority order
2. The drag handle (≡ icon) on the left lets you reorder
3. Lower in the list = higher priority number = executes later

### Step 4: Try the Expression Editor
1. Create a new custom rule
2. Toggle between **Visual Builder** and **Expression Editor**
3. Visual Builder: dropdown menus for field, operator, value
4. Expression Editor: raw Wireshark-syntax text field
5. Note the **Test Expression** feature — enter a URL or IP to see if it would match

---

## Hands-On Lab

### Prerequisites
- Cloudflare account with macksportreport.com active
- Zone on any paid plan (Pro or higher recommended for 20-rule limit)

### Lab 1: Explore the Phase Pipeline via API

```bash
# Set your credentials
export CF_API_TOKEN="your_api_token"
export ZONE_ID="your_zone_id_for_macksportreport_com"

# List all rulesets for the zone (shows which phases have rules)
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.result[] | {id, name, phase, kind}'
```

Expected output — you'll see entries like:
```json
{"id": "abc123", "name": "default", "phase": "http_request_firewall_custom", "kind": "zone"}
{"id": "def456", "name": "default", "phase": "http_request_cache_settings", "kind": "zone"}
```

### Lab 2: Create a Simple Block Rule via API

```bash
# Get the ruleset ID for http_request_firewall_custom phase
RULESET_ID=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq -r '.result[] | select(.phase == "http_request_firewall_custom") | .id')

echo "Firewall Custom Ruleset ID: ${RULESET_ID}"

# Add a test rule (block requests from specific user agent)
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "block",
    "expression": "(http.user_agent contains \"BadBot/1.0\")",
    "description": "Lab: Block test bad bot",
    "enabled": true
  }' | jq '{id: .result.id, action: .result.action, enabled: .result.enabled}'
```

### Lab 3: Verify Priority Ordering

```bash
# List all rules in the custom firewall phase with their priorities
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RULESET_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result.rules[] | {priority, description, action, enabled}'
```

### Lab 4: Create a Skip Rule

```bash
# Create a skip rule that bypasses subsequent rules for a trusted IP
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "skip",
    "action_parameters": {
      "ruleset": "current"
    },
    "expression": "ip.src eq 203.0.113.1",
    "description": "Lab: Skip all rules for trusted IP",
    "enabled": true
  }' | jq '{id: .result.id, action: .result.action}'
```

**Important:** After creating, reorder via dashboard drag-and-drop to make the skip rule priority 1 (executes first). Without this, the block rules above might fire before the skip rule.

### Lab 5: Test with curl

```bash
# Test that the bad bot is blocked (should return 403)
curl -s -o /dev/null -w "%{http_code}" \
  -H "User-Agent: BadBot/1.0" \
  https://macksportreport.com/

# Test that normal traffic passes (should return 200)
curl -s -o /dev/null -w "%{http_code}" \
  -H "User-Agent: Mozilla/5.0" \
  https://macksportreport.com/
```

### Lab 6: Cleanup

```bash
# Get the rule ID you created in Lab 2
BLOCK_RULE_ID="id_from_lab_2_output"
SKIP_RULE_ID="id_from_lab_4_output"

# Delete both test rules
curl -s -X DELETE \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules/${BLOCK_RULE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.success'

curl -s -X DELETE \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules/${SKIP_RULE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.success'
```

---

## Demo Script (2 Minutes)

**Audience:** Technical champion at a mid-market company migrating from legacy WAF

**Setup:** Browser open to macksportreport.com → Rules in Cloudflare dashboard

---

*"The thing that makes Cloudflare's approach unique is that everything goes through one unified pipeline — we call it the Ruleset Engine."*

[Point to Rules → Overview page]

*"Every rule you create — WAF rules, redirect rules, cache rules, header modifications — they all run in a specific, predictable order called phases. This request [draw a line left-to-right] hits custom WAF rules first, then transforms, then managed WAF, then rate limiting, then cache rules. You can't reorder phases, but you know exactly when each thing fires."*

[Click into Custom Rules]

*"Within each phase, you control priority. Low number runs first. And here's the key feature that most WAF vendors don't have — skip rules. I can say: if this request comes from my internal pentest team [point to IP range], skip the entire managed WAF. No false positives, no blocking my own security team, but everyone else still gets full protection."*

[Show expression editor]

*"And unlike legacy Page Rules with glob matching, every rule uses the same expression language. Wireshark-compatible syntax. You can write rules like: 'if the path starts with /api AND the request is a POST AND the IP isn't in my trusted range — block it.' One rule, three conditions, logical operators. That's the power of the unified engine."*

---

## Competitive Context

| Feature | Cloudflare Rules Engine | AWS WAF + CloudFront Rules | Akamai Kona Site Defender | Fastly |
|---|---|---|---|---|
| **Unified rule language** | Yes — all rule types use same syntax | No — WAF rules, CloudFront functions, Lambda@Edge all different syntax | Partial — Adaptive Security Engine separate from edge logic | Partial — VCL for some, separate WAF |
| **Phase-based pipeline** | Yes — explicit, documented phases | No — fragmented services | Partially documented | VCL subroutines (different model) |
| **Skip/allow rules** | Yes — granular skip to ruleset/rule level | Yes — allow rules | Yes | Yes (via VCL) |
| **Boolean logic in rules** | Full AND/OR/NOT | Full | Full | Full (VCL) |
| **Account-level rulesets** | Yes (Enterprise) | Yes (WAF WebACLs can span accounts) | Yes (policy groups) | Yes |
| **Terraform support** | Yes (`cloudflare_ruleset`) | Yes (`aws_wafv2_web_acl`) | Yes | Yes |
| **Free tier rules** | 5 custom rules | ~$5/month base + per-rule cost | No free tier | No free tier |
| **Managed rule groups** | Yes (CF Managed, OWASP, leaked creds) | Yes (AWS Managed Rules) | Yes (Kona rule sets) | Yes (Signal Sciences) |
| **Dashboard visual builder** | Yes | Basic | Yes | Limited |

**Key differentiator talking point:** AWS WAF alone costs $5/month for the WebACL plus $1/million requests. Add CloudFront Functions and Lambda@Edge and you're paying for 3 separate systems with 3 different syntaxes to accomplish what Cloudflare does in one unified engine with one expression language.

---

## Self-Check Questions

**Question 1:** What is the correct phase order for a request that matches both a custom WAF rule and a rate limiting rule? Which fires first?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 2:** A customer on Business plan asks why they can only create 100 custom rules. You discover they need routing logic for 120 different URL patterns to different backends. What are their options without upgrading to Enterprise?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 3:** Explain the difference between a `skip` action targeting `ruleset: "current"` vs targeting a specific managed ruleset ID.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 4:** A customer has both Page Rules and new-style Redirect Rules configured for the same URL. What happens? Which takes priority?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 5:** Write the expression language syntax to match requests where: the URI path starts with `/checkout`, the country is either US or CA, and the request is NOT from a known bot (cf.client.bot_score > 30 means more likely bot).

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

---

## Sources

- [Cloudflare Ruleset Engine Documentation](https://developers.cloudflare.com/ruleset-engine/)
- [Rules Engine — Phases Reference](https://developers.cloudflare.com/ruleset-engine/reference/phases-list/)
- [Rules Language Reference](https://developers.cloudflare.com/ruleset-engine/rules-language/)
- [Rulesets API Reference](https://developers.cloudflare.com/ruleset-engine/rulesets-api/)
- [Account-Level Rulesets](https://developers.cloudflare.com/ruleset-engine/account-rulesets/)
- [Terraform: cloudflare_ruleset](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/ruleset)
- [Page Rules Migration Guide](https://developers.cloudflare.com/rules/reference/page-rules-migration/)
- [Custom Rules (WAF)](https://developers.cloudflare.com/waf/custom-rules/)
