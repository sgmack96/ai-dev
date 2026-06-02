# Module 6.5 — Configuration Rules
> **Dashboard Location:** macksportreport.com → Rules → Configuration Rules
> **Estimated Time:** 50 minutes
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Are Configuration Rules?

Configuration Rules allow you to **override zone-level Cloudflare settings on a per-request basis**. Your zone has global settings — "enable Browser Integrity Check for all traffic," "set security level to Medium" — but what if you need those settings to behave differently for specific paths, countries, or request types?

That's Configuration Rules. Without them, you'd have to make a tradeoff: either set the zone-wide setting to the least restrictive level you need anywhere, or block/frustrate legitimate use cases.

### The Classic Problem Configuration Rules Solve

**Example:** macksportreport.com has WAF security level set to "High" to protect the main site. But their `/api/*` endpoints are authenticated — every API consumer sends a Bearer token — and the high security level is blocking legitimate API clients that have "unusual" user agents (mobile SDKs, server-side scripts, automation tools).

**Without Configuration Rules:** You have to choose between:
- Drop security level to "Medium" for the whole zone (weakens protection)
- Block legitimate API clients (breaks the product)

**With Configuration Rules:** Set security level to "Essentially Off" for `/api/*` with a Bearer token header present. Everything else keeps High security. Best of both worlds.

### What Settings Can Configuration Rules Override?

Configuration Rules can override the following zone-level settings per matching request:

**Security Settings:**
- Security Level (Essentially Off / Low / Medium / High / Under Attack)
- Browser Integrity Check (on/off)
- Email Obfuscation (on/off)
- Hotlink Protection (on/off)

**Performance Settings:**
- Cache Level (Bypass / No Query String / Ignore Query String / Standard / Cache Everything)
- Browser Cache TTL
- Edge Cache TTL
- Rocket Loader (on/off)
- Minification (JavaScript / CSS / HTML — on/off per type)
- Polish (image compression: Off / Lossless / Lossy)
- Mirage (mobile image optimization: on/off)
- Automatic HTTPS Rewrites (on/off)

**Feature Toggles:**
- SSL (Flexible / Full / Full Strict — override per path)
- Opportunistic Encryption (on/off)
- Response Buffering (on/off)
- IP Geolocation (on/off)
- True Client IP Header (on/off)

**Note:** The exact available settings depend on your plan. Some settings (like advanced Polish options) require Business or Enterprise.

---

## Deep Dive (Architect-Level)

### Configuration Rules vs Cache Rules

There is overlap between Configuration Rules and Cache Rules (Module 6.X covers Cache Rules in detail). Here's when to use each:

| Scenario | Use Configuration Rules | Use Cache Rules |
|---|---|---|
| Set cache level (Bypass, Standard, etc.) | Yes | Yes — Cache Rules preferred |
| Set edge cache TTL | Yes | Yes — Cache Rules preferred |
| Set browser cache TTL | Yes | Yes — Cache Rules preferred |
| Disable WAF features per path | Yes | No |
| Toggle Rocket Loader per path | Yes | No |
| Toggle Polish/Mirage per path | Yes | No |
| Set security level per path | Yes | No |
| Serve stale while revalidate | No | Yes |
| Cache key customization | No | Yes |

**Recommendation:** For cache-specific settings, prefer Cache Rules (more powerful, purpose-built). For security and performance feature overrides (security level, browser integrity, Rocket Loader, Polish), use Configuration Rules.

### Security Level: Understanding the Grades

When you override Security Level via a Configuration Rule, here's what each level actually means:

| Security Level | What Happens | Cloudflare Threat Score Threshold |
|---|---|---|
| **Essentially Off** | Only blocks the most severe threats | >49 |
| **Low** | Reduced challenge rate | >24 |
| **Medium** | Standard challenge rate | >14 |
| **High** | Aggressive challenge rate | >0 |
| **Under Attack** | JS challenge for all visitors | All visitors |

Threat score is calculated by Cloudflare based on the visitor's IP reputation, ASN reputation, behavior patterns, and other signals.

**Use case:** For an admin panel (`/admin/*`), you might want "High" security level regardless of zone setting. For an API endpoint with authenticated users (`/api/v2/*` with Bearer token), "Essentially Off" makes sense because you've already authenticated them at the application layer.

### SSL Override Per Path

Configuration Rules can override the SSL mode for specific paths. This is a genuine enterprise edge case:

**Scenario:** You have a legacy path `/legacy-api/*` that only supports HTTP connections between Cloudflare and origin (the origin server is old and doesn't support TLS). Your entire zone is configured for "Full (Strict)" SSL.

**Solution:** Configuration Rule for `/legacy-api/*` with SSL mode set to "Flexible" (Cloudflare-to-origin connection doesn't require TLS). Everything else stays on "Full (Strict)".

**Warning to customers:** "Flexible" SSL means traffic between Cloudflare and your origin is unencrypted. Never use this as a permanent solution — it's a migration stopgap.

### Minification Override Per Path

A common JavaScript framework issue: Rocket Loader or Minification breaks a specific page that uses an unconventional script loading pattern.

Rather than disabling minification for the whole zone (which affects performance everywhere else), create a Configuration Rule:

```
Match: http.request.uri.path eq "/checkout"
Action: Disable Rocket Loader, Disable JavaScript Minification
```

This is surgical — only that path is affected.

### Browser Cache TTL Override

Configuration Rules can set browser cache TTL (what the browser caches locally), which is separate from edge cache TTL (how long Cloudflare caches at the edge):

```
# For /static/* — tell browsers to cache aggressively
Match: starts_with(http.request.uri.path, "/static/")
Browser Cache TTL: 1 year

# For /account/* — don't cache in browser
Match: starts_with(http.request.uri.path, "/account/")
Browser Cache TTL: No cache (browser respects freshness headers)
```

**Note:** Configuration Rules set a `Cache-Control: max-age=N` override. If your origin sends `Cache-Control: no-cache`, Cloudflare respects the origin header unless Cache Rules say otherwise.

### Combining Multiple Settings in One Rule

A single Configuration Rule can override multiple settings simultaneously:

```
Rule: "API Endpoint Optimization"
Match: (starts_with(http.request.uri.path, "/api/")) and
       (http.request.headers["Authorization"] matches "^Bearer ")

Actions:
  - Security Level: Essentially Off
  - Browser Integrity Check: Off
  - Cache Level: Bypass
  - SSL: Full (Strict)
  - Email Obfuscation: Off
```

One rule, six setting overrides, all conditional on having a Bearer token present.

### Rule Priority and Conflicts

If two Configuration Rules both match a request but configure the same setting differently, the rule with **lower priority number** (executes first) wins for each setting.

**Important:** This is NOT like CSS specificity. It's first-match-wins per setting. If Rule 1 sets Security Level to "High" and Rule 2 (executed after) sets Security Level to "Low", the request gets Security Level "Low" because the last writer wins.

**Best practice:** Be explicit and use narrow match conditions to avoid overlap.

### Terraform: Configuration Rules

```hcl
resource "cloudflare_ruleset" "config_rules" {
  zone_id     = var.zone_id
  name        = "Configuration Rules"
  description = "Override settings per path/condition"
  kind        = "zone"
  phase       = "http_request_cache_settings"  # config rules phase

  rules {
    action = "set_config"
    action_parameters {
      security_level    = "essentially_off"
      bic               = false   # Browser Integrity Check
      email_obfuscation = false
      cache             = false   # Bypass cache
    }
    expression  = "(starts_with(http.request.uri.path, \"/api/\")) and (http.request.headers[\"Authorization\"][*] matches \"^Bearer \")"
    description = "API endpoints: reduced security, bypass cache"
    enabled     = true
  }

  rules {
    action = "set_config"
    action_parameters {
      security_level = "high"
      bic            = true
      hotlink_protection = true
    }
    expression  = "starts_with(http.request.uri.path, \"/admin/\")"
    description = "Admin: maximum security"
    enabled     = true
  }
}
```

---

## Dashboard Walkthrough

### Step 1: Navigate to Configuration Rules
1. macksportreport.com → **Rules** → **Configuration Rules**
2. Overview shows existing rules with status (active/paused) and expression summary

### Step 2: Create an API Security Override Rule
1. **+ Create rule**
2. Name: "API Endpoints — Reduced Security"
3. Match: Toggle to **Custom filter expression**
4. Expression: `(starts_with(http.request.uri.path, "/api/")) and (http.request.headers["Authorization"][*] matches "^Bearer ")`
5. Under Settings to Override:
   - Click **Security Level** → Set to **Essentially Off**
   - Click **Browser Integrity Check** → **Off**
   - Click **Email Obfuscation** → **Off**
6. **Save and deploy**

### Step 3: Create an Admin Hardening Rule
1. **+ Create rule**
2. Name: "Admin Panel — Maximum Security"
3. Expression: `starts_with(http.request.uri.path, "/admin/")`
4. Settings:
   - Security Level: **High**
   - Browser Integrity Check: **On**
   - Hotlink Protection: **On**
5. **Save and deploy**

### Step 4: Create a Performance Override for Static Assets
1. **+ Create rule**
2. Name: "Static Assets — Disable Dynamic Features"
3. Expression: `starts_with(http.request.uri.path, "/static/")`
4. Settings:
   - Rocket Loader: **Off** (static files don't need it)
   - Mirage: **Off** (they're already optimized)
   - Email Obfuscation: **Off**
5. **Save and deploy**

### Step 5: Review Rule Order
1. Back on main Configuration Rules list
2. Notice rules are numbered 1, 2, 3 — drag to reorder if priority matters for overlapping conditions

---

## Hands-On Lab

### Prerequisites
```bash
export CF_API_TOKEN="your_api_token"
export ZONE_ID="your_zone_id"
```

### Lab 1: Find Configuration Rules Phase

```bash
# Configuration rules run in http_config_settings phase
CONFIG_RULESET_ID=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq -r '.result[] | select(.phase == "http_config_settings") | .id')

echo "Config Rules Ruleset ID: ${CONFIG_RULESET_ID}"
```

### Lab 2: Check Current Zone Security Level (Baseline)

```bash
# Get current zone security level setting (what we're overriding FROM)
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/security_level" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '{setting: .result.id, value: .result.value}'
```

### Lab 3: Create a Security Override Rule

```bash
# Create config rule: override security level for API paths
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${CONFIG_RULESET_ID}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "set_config",
    "action_parameters": {
      "security_level": "essentially_off",
      "bic": false
    },
    "expression": "starts_with(http.request.uri.path, \"/api/\")",
    "description": "Lab: Reduce security for API paths",
    "enabled": true
  }' | jq '{id: .result.id, action: .result.action, description: .result.description}'
```

### Lab 4: Verify the Override with Test Request

```bash
# Make a request to an API path and check CF response headers
# CF-RAY header always present; look for lack of challenge/CAPTCHA
curl -sv https://macksportreport.com/api/test 2>&1 | grep -E "CF-RAY|cf-ray|< HTTP"

# Compare with a non-API path (should have normal security level behavior)
curl -sv https://macksportreport.com/ 2>&1 | grep -E "CF-RAY|cf-ray|< HTTP"
```

### Lab 5: Create a Rocket Loader Disable Rule for Checkout

```bash
# Disable Rocket Loader on checkout to prevent JS timing issues
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${CONFIG_RULESET_ID}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "set_config",
    "action_parameters": {
      "rocket_loader": false,
      "mirage": false
    },
    "expression": "(starts_with(http.request.uri.path, \"/checkout\")) or (starts_with(http.request.uri.path, \"/cart\"))",
    "description": "Lab: Disable Rocket Loader and Mirage for checkout/cart",
    "enabled": true
  }' | jq '{id: .result.id, description: .result.description}'
```

### Lab 6: Review All Configuration Rules

```bash
# List all configuration rules with their expressions and settings
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${CONFIG_RULESET_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result.rules[] | {
    description,
    enabled,
    expression,
    settings: .action_parameters
  }'
```

---

## Demo Script (2 Minutes)

**Audience:** Security-conscious CTO at an API-first SaaS company

---

*"Here's the tension every SaaS company faces: you want aggressive WAF protection, but your API has thousands of clients — mobile SDKs, third-party integrations, automation scripts — and they all look 'weird' to a high-sensitivity WAF. You end up either blocking legitimate customers or weakening your security posture."*

[Navigate to Configuration Rules → Create rule]

*"Configuration Rules break that tradeoff. Watch: I set the entire zone security level to 'High' — that means aggressive challenge rates for anything suspicious. But then I add one rule: 'for requests to `/api/*` that have a valid Bearer token in the Authorization header, drop to Essentially Off and disable Browser Integrity Check.'"*

*"Think about what this says: if you've authenticated — if you have a valid token — you've already passed our auth gate. Challenging you again with CAPTCHA is security theater that just breaks your integration. But if you hit `/api/*` WITHOUT a token, you're unauthenticated and you get the full High security treatment."*

[Show the expression]

*"`starts_with(http.request.uri.path, '/api/') and http.request.headers['Authorization'] matches '^Bearer'` — that's one expression, two conditions, and it cleanly separates your security posture for authenticated vs unauthenticated requests."*

---

## Competitive Context

| Feature | Cloudflare Configuration Rules | AWS WAF per-rule actions | Akamai Adaptive Security Engine | Imperva |
|---|---|---|---|---|
| **Per-path security level** | Yes | Partial (block/allow/count per rule) | Yes | Yes |
| **Per-path feature toggles** | Yes — broad set of Cloudflare features | No | Some features | No |
| **Cache behavior override** | Yes | No — separate CloudFront config | Some | No |
| **Performance feature override** | Yes (Rocket Loader, Polish, Mirage) | No — not a CDN | No | No |
| **SSL mode per path** | Yes | N/A | Limited | N/A |
| **Expression-based matching** | Yes — full rules language | Yes | Yes — proprietary | Yes — proprietary |
| **Combined security + perf rule** | Yes — one rule, multiple settings | No — separate services | Partial | No |
| **No-code dashboard** | Yes | Basic | Yes | Yes |
| **Terraform support** | Yes | Yes | Limited | Limited |

**Key differentiator:** Cloudflare is unique in combining **security settings, performance settings, and feature toggles** in a single rule type. AWS requires separate configuration across WAF, CloudFront behaviors, and Lambda@Edge to achieve equivalent flexibility. This means fewer moving parts, fewer configuration surfaces, and simpler auditing.

---

## Self-Check Questions

**Question 1:** A customer is running an e-commerce site. The checkout page (`/checkout`) breaks when JavaScript minification is enabled because of a third-party payment widget. What Configuration Rule do you create, and why is Configuration Rules the right tool (vs disabling minification zone-wide)?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 2:** Explain the difference between Security Level (a Configuration Rule setting) and WAF sensitivity (adjusting WAF managed rules). A customer says "I turned security level to High but I'm still seeing malicious traffic." What's the gap in their mental model?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 3:** A customer wants to override SSL mode to "Flexible" for `/legacy/*` but keep "Full (Strict)" everywhere else. Walk them through the risks of this setup and any monitoring you'd recommend.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 4:** Two Configuration Rules both match a request: Rule A (priority 1) sets Security Level to "High", Rule B (priority 2) sets Security Level to "Essentially Off". What security level does the request actually get? Why?

```
Your answer:
_______________________________________________
_______________________________________________
```

**Question 5:** A customer asks why they should use Configuration Rules instead of just setting different zone-level defaults for different hostnames (using separate zones per subdomain). What are the operational drawbacks of the "one zone per subdomain" approach?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

---

## Sources

- [Configuration Rules Documentation](https://developers.cloudflare.com/rules/configuration-rules/)
- [Configuration Rules — Available Settings](https://developers.cloudflare.com/rules/configuration-rules/settings/)
- [Configuration Rules — Examples](https://developers.cloudflare.com/rules/configuration-rules/examples/)
- [Security Level Explained](https://developers.cloudflare.com/waf/tools/security-level/)
- [Browser Integrity Check](https://developers.cloudflare.com/waf/tools/browser-integrity-check/)
- [Rocket Loader Documentation](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/)
- [Rules Language Reference](https://developers.cloudflare.com/ruleset-engine/rules-language/)
