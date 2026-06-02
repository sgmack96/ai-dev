# Module 6.8 — Page Rules (Legacy)
> **Dashboard Location:** macksportreport.com → Rules → Page Rules
> **Estimated Time:** 50 minutes
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Are Page Rules?

Page Rules are Cloudflare's **legacy rules system** — the original mechanism for overriding zone settings, redirecting URLs, and controlling caching behavior on a per-URL basis. They were the primary rules tool from Cloudflare's early years until the new Ruleset Engine was introduced.

Page Rules are **being deprecated** in favor of the new Rules Engine (Transform Rules, Redirect Rules, Cache Rules, Configuration Rules). However, as a Solutions Engineer you must know Page Rules thoroughly because:

1. **Nearly every existing Cloudflare customer has Page Rules.** During renewals, upsells, and audits, you'll be reviewing Page Rules configurations constantly.
2. **Customers need help migrating.** Moving from Page Rules to the new system requires understanding both.
3. **New customers sometimes ask about Page Rules** from documentation they find online.
4. **Page Rules still work** — they haven't been removed yet, just deprecated from active feature development.

### Page Rules vs New Rules Engine: The Core Differences

| | Page Rules | New Rules Engine |
|---|---|---|
| **URL matching** | Glob patterns (`*` wildcard) | Full expression language (Wireshark-style) |
| **Logic per rule** | Single URL pattern, multiple actions | One action per rule, compose via priority |
| **Multiple conditions** | Not possible — one URL pattern only | Full AND/OR/NOT boolean logic |
| **Expression reuse** | Not possible | Account-level lists, reusable conditions |
| **Future development** | No new features | Actively developed |
| **Plan limits** | 3/20/50/unlimited | Per-rule-type limits |
| **Terraform** | `cloudflare_page_rule` (deprecated) | `cloudflare_ruleset` |

---

## Deep Dive (Architect-Level)

### URL Pattern Matching: Glob Syntax

Page Rules use glob-style patterns, not regex. The only wildcard is `*`:

```
# Match all pages under /blog/
https://macksportreport.com/blog/*

# Match any subdomain
https://*.macksportreport.com/*

# Match specific file extension
https://macksportreport.com/*.jpg

# Match with query string
https://macksportreport.com/search?*
```

**Important glob rules:**
- `*` matches zero or more characters including path separators
- There's no `?` single-character wildcard
- Matching is performed on the full URL including protocol and hostname
- Patterns are matched in priority order (lower number = higher priority)
- The first matching rule wins (unlike CSS where multiple rules combine)

**The $1 back-reference:** The first `*` wildcard in a pattern can be referenced as `$1` in the Forwarding URL destination:

```
Pattern: https://macksportreport.com/old-blog/*
Forward to: https://macksportreport.com/blog/$1
```

This captures whatever `*` matches and inserts it into the destination.

Multiple wildcards: `$1`, `$2`, `$3` etc. each reference the corresponding `*`:

```
Pattern: https://macksportreport.com/sports/*/team/*
Forward to: https://macksportreport.com/teams/$2/sports/$1
```

### Available Page Rule Settings: Complete List

Here are the settings most commonly used in Page Rule configurations:

#### Caching Settings

| Setting | Options | Description |
|---|---|---|
| **Cache Level** | Bypass, No Query String, Ignore Query String, Standard, Cache Everything | Override cache tier |
| **Edge Cache TTL** | 30s to 1 year | How long Cloudflare edge caches the response |
| **Browser Cache TTL** | No change, 30min to 1 year | How long browser caches (adds Cache-Control header) |
| **Bypass Cache on Cookie** | Cookie name pattern | Skip cache if cookie present |
| **Cache Deception Armor** | On/Off | Prevent cache deception attacks |

#### Redirect Settings

| Setting | Options | Description |
|---|---|---|
| **Forwarding URL** | 301 or 302, destination URL | HTTP redirect with $1 back-reference |
| **Always Use HTTPS** | On/Off | Redirect HTTP to HTTPS (301) |

#### Security Settings

| Setting | Options | Description |
|---|---|---|
| **Security Level** | Off, Low, Medium, High, Under Attack | Override zone security level |
| **Browser Integrity Check** | On/Off | Enable/disable BIC |
| **Disable Apps** | — | Turn off Cloudflare Apps for this URL |
| **Disable Security** | — | Disable security features (WAF, etc.) |
| **SSL** | Off, Flexible, Full, Full (Strict) | Override SSL mode |
| **WAF** | On/Off | Enable/disable WAF (Enterprise only) |

#### Performance Settings

| Setting | Options | Description |
|---|---|---|
| **Disable Performance** | — | Disable all performance features |
| **Rocket Loader** | On/Off | Enable/disable Rocket Loader |
| **Minify** | JS/CSS/HTML individually on/off | Override minification |
| **Polish** | Off, Lossless, Lossy | Image optimization |
| **Mirage** | On/Off | Mobile image optimization |
| **Automatic HTTPS Rewrites** | On/Off | Rewrite HTTP URLs in HTML |
| **Opportunistic Encryption** | On/Off | Enable/disable opportunistic encryption |

### Priority Model

Page Rules are numbered 1-N. Lower number = **higher priority** = first to match.

The first matching rule wins, period. Unlike the new Rules Engine where multiple rules can each modify different settings, Page Rules are winner-take-all: only the first matching rule fires.

**Example priority issue:**

```
Rule 1 (priority 1): macksportreport.com/admin/* → Security Level: High
Rule 2 (priority 2): macksportreport.com/* → Cache Level: Cache Everything
```

A request to `/admin/dashboard` matches Rule 1 (security level set to High). But because Rule 1 wins entirely, the cache setting from Rule 2 never applies. If you need BOTH a security override AND a cache setting for `/admin/*`, both actions must be in the same Page Rule.

This is fundamentally different from the new Rules Engine where rules in different phases combine independently.

### Plan Limits

| Plan | Page Rules | Notes |
|---|---|---|
| **Free** | 3 | Very limited — use wisely |
| **Pro** | 20 | Sufficient for most simple sites |
| **Business** | 50 | More flexibility |
| **Enterprise** | Unlimited | Effectively no limit |

Additional Page Rules can be purchased as add-ons: typically $5/month per 5 additional rules on paid plans.

### Common Page Rule Patterns (Customer Audit Checklist)

When auditing an existing customer's Page Rules, look for these common patterns:

**Pattern 1: Forced HTTPS**
```
https://macksportreport.com/*
Action: Always Use HTTPS
```
Migration: Use the "Always Use HTTPS" zone setting instead, or Redirect Rule from http:// to https://

**Pattern 2: Cache Everything for Static Site**
```
https://macksportreport.com/*
Action: Cache Level: Cache Everything, Edge Cache TTL: 1 month
```
Migration: Cache Rule → Cache Everything, Edge TTL 1 month, match `true`

**Pattern 3: Bypass Cache for CMS Admin**
```
https://macksportreport.com/wp-admin/*
https://macksportreport.com/wp-login.php
Action: Cache Level: Bypass
```
Migration: Cache Rule → Bypass Cache, match: `starts_with(http.request.uri.path, "/wp-admin/") or http.request.uri.path eq "/wp-login.php"`

**Pattern 4: Forwarding Redirect**
```
https://macksportreport.com/old-page
Action: Forwarding URL (301): https://macksportreport.com/new-page
```
Migration: Single Redirect Rule → `http.request.uri.path eq "/old-page"` → 301 → `https://macksportreport.com/new-page`

**Pattern 5: Disable Security for API**
```
https://api.macksportreport.com/*
Action: Security Level: Essentially Off, Browser Integrity Check: Off
```
Migration: Configuration Rule → Security Level: Essentially Off, BIC: Off, match: `http.host eq "api.macksportreport.com"`

### Migration Strategy: Page Rules to New Rules

Cloudflare provides a migration guide, but the high-level strategy is:

1. **Audit all existing Page Rules** — export via API, categorize by action type
2. **Group by action type:**
   - Forwarding URLs → Single Redirects or Bulk Redirects
   - Cache Level/TTL settings → Cache Rules
   - Security Level/BIC/SSL → Configuration Rules
   - Minify/Polish/Rocket Loader → Configuration Rules
   - Always HTTPS → Zone setting or Redirect Rule
3. **Create new rules** in respective dashboards with equivalent expressions
4. **Test equivalence** before disabling Page Rules
5. **Disable Page Rules** one by one after verification
6. **Delete Page Rules** once confirmed stable

**Why migrate?** Beyond the functional improvements (boolean logic, no wildcard-only matching), the new system is actively maintained. New security features (e.g., leaked credentials check integration) will only be available in new-style rules.

### Terraform: Page Rules (Legacy) vs Ruleset (New)

**Legacy (don't use for new configs):**
```hcl
resource "cloudflare_page_rule" "cache_everything" {
  zone_id  = var.zone_id
  target   = "https://macksportreport.com/static/*"
  priority = 1
  status   = "active"

  actions {
    cache_level       = "cache_everything"
    edge_cache_ttl    = 86400
    browser_cache_ttl = 3600
  }
}
```

**New (use this):**
```hcl
resource "cloudflare_ruleset" "cache_rules" {
  zone_id     = var.zone_id
  name        = "Cache Rules"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules {
    action = "set_cache_settings"
    action_parameters {
      cache = true
      edge_ttl {
        mode    = "override_origin"
        default = 86400
      }
      browser_ttl {
        mode    = "override_origin"
        default = 3600
      }
    }
    expression  = "starts_with(http.request.uri.path, \"/static/\")"
    description = "Cache static assets aggressively"
    enabled     = true
  }
}
```

---

## Dashboard Walkthrough

### Step 1: Navigate to Page Rules (Legacy View)
1. macksportreport.com → **Rules** → **Page Rules**
2. If on a new account, you'll see the "Legacy" badge and a notice about new Rules

### Step 2: Create a Test Page Rule (for Learning)
1. **+ Create Page Rule**
2. URL matches: `https://macksportreport.com/old-news/*`
3. Click **+ Add a Setting** → **Forwarding URL** → 301 → `https://macksportreport.com/news/$1`
4. **Save and Deploy Rule**

### Step 3: Review an Existing Page Rule
1. Click on any existing rule to expand it
2. Notice the URL pattern uses glob `*`, not an expression
3. Notice actions are bundled in the same rule — this is the fundamental difference from the new system

### Step 4: Check Rule Order
1. Rules are numbered — drag handles on the left allow reordering
2. Rule 1 is checked first, Rule 2 second, etc.
3. First match wins, subsequent rules don't fire

### Step 5: Export Page Rules via API

```bash
# See all existing Page Rules for audit/migration planning
export CF_API_TOKEN="your_token"
export ZONE_ID="your_zone_id"

curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/pagerules?status=active" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result[] | {
    id,
    priority,
    status,
    targets: .targets[].constraint.value,
    actions: [.actions[] | {id, value}]
  }'
```

---

## Hands-On Lab

### Lab 1: Export All Page Rules for Audit

```bash
export CF_API_TOKEN="your_api_token"
export ZONE_ID="your_zone_id"

# Get all page rules (both active and disabled)
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/pagerules?status=active&order=priority&direction=asc" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result[] | {
    priority,
    status,
    url_pattern: .targets[0].constraint.value,
    actions: [.actions[] | "\(.id): \(.value)"]
  }' > /tmp/page-rules-audit.json

echo "Page rules exported:"
cat /tmp/page-rules-audit.json | jq '.'
```

### Lab 2: Create a Page Rule via API

```bash
# Create a Forwarding URL page rule (test only)
PAGE_RULE_ID=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/pagerules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "targets": [
      {
        "target": "url",
        "constraint": {
          "operator": "matches",
          "value": "https://macksportreport.com/lab-old/*"
        }
      }
    ],
    "actions": [
      {
        "id": "forwarding_url",
        "value": {
          "url": "https://macksportreport.com/lab-new/$1",
          "status_code": 301
        }
      }
    ],
    "priority": 100,
    "status": "active"
  }' | jq -r '.result.id')

echo "Created Page Rule: ${PAGE_RULE_ID}"
```

### Lab 3: Test the Page Rule

```bash
# Should redirect /lab-old/anything to /lab-new/anything
curl -s -I "https://macksportreport.com/lab-old/test-path" | grep -E "HTTP|Location"

# Follow redirect
curl -sL -o /dev/null -w "Final URL: %{url_effective}\n" \
  "https://macksportreport.com/lab-old/test-path"
```

### Lab 4: Create the Equivalent New Redirect Rule

```bash
# Get the redirect ruleset ID
REDIRECT_RULESET=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq -r '.result[] | select(.phase == "http_request_dynamic_redirect") | .id')

# Create equivalent new-style redirect rule
NEW_RULE_ID=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${REDIRECT_RULESET}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "redirect",
    "action_parameters": {
      "from_value": {
        "status_code": 301,
        "target_url": {
          "expression": "concat(\"https://macksportreport.com/lab-new/\", substring(http.request.uri.path, 10))"
        },
        "preserve_query_string": true
      }
    },
    "expression": "starts_with(http.request.uri.path, \"/lab-old/\")",
    "description": "Migration: /lab-old/* → /lab-new/* (replacing Page Rule)",
    "enabled": true
  }' | jq -r '.result.id')

echo "Created new redirect rule: ${NEW_RULE_ID}"
```

### Lab 5: Verify Equivalence, Then Disable Page Rule

```bash
# Both should produce the same redirect result
echo "Testing new rule:"
curl -sI "https://macksportreport.com/lab-old/test-path" | grep -E "HTTP|Location"

# Once verified, disable the old page rule
curl -s -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/pagerules/${PAGE_RULE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "disabled"}' | jq '{status: .result.status}'
```

### Lab 6: Cleanup

```bash
# Delete test page rule and new rule
curl -s -X DELETE \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/pagerules/${PAGE_RULE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.success'

curl -s -X DELETE \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${REDIRECT_RULESET}/rules/${NEW_RULE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.success'
```

---

## Demo Script (2 Minutes)

**Audience:** Long-time Cloudflare customer on Business plan with 40+ Page Rules

---

*"You've been on Cloudflare for years, and you've got 40-something Page Rules handling your redirects, cache overrides, security settings. That's great — it works. But I want to show you what you're missing by staying on the legacy system."*

[Show existing Page Rules list]

*"Here's the limitation: every Page Rule is one URL pattern and one set of actions. You can't say 'match /api/* AND the request has an Authorization header AND the country is not CN.' One asterisk, one set of actions. That's the whole Page Rules vocabulary."*

[Open a new tab, Custom Rules / Transform Rules expression editor]

*"In the new system, here's that same rule: starts_with the path, AND the header matches a regex, AND NOT the country. Full boolean logic. The expression language is the same whether you're writing a WAF rule, a redirect, a cache override, or a header modification."*

*"The migration is straightforward. I can walk through your Page Rules one by one and map each to the equivalent new rule type. Your forwarding URLs become Single Redirects. Your cache overrides become Cache Rules. Your security settings become Configuration Rules. We do it in a maintenance window, test equivalence, disable old rules, done."*

---

## Competitive Context

| Feature | Cloudflare Page Rules | Cloudflare New Rules | AWS CloudFront Behaviors | Akamai Property Rules |
|---|---|---|---|---|
| **URL matching** | Glob only | Full expression language | Path patterns | Match criteria (complex) |
| **Multiple conditions** | No — single URL pattern | Yes — AND/OR/NOT | Limited — path + header | Yes — nested rule logic |
| **Actions per rule** | Multiple bundled | One per rule, composable | Multiple per behavior | Multiple per rule |
| **Development status** | Deprecated | Active | Active | Active |
| **Learning curve** | Low | Medium | High | High |
| **Terraform support** | cloudflare_page_rule (deprecated) | cloudflare_ruleset | aws_cloudfront_distribution | Complex JSON |
| **Migration guidance** | Cloudflare provides migration docs | — | N/A | N/A |

---

## Self-Check Questions

**Question 1:** A customer has a Page Rule: `https://macksportreport.com/static/*` with "Cache Level: Cache Everything" and "Edge Cache TTL: 1 month." Write the equivalent Cache Rule expression and settings.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 2:** A customer on the Free plan has all 3 Page Rules used up. They need a 4th rule for a redirect. What are their options? (List at least 3 approaches without upgrading their plan.)

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 3:** Explain why the first-match-wins behavior of Page Rules is fundamentally different from how rules combine in the new system. Use a concrete example to illustrate.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 4:** A customer has 48 active Page Rules on Business plan (limit: 50). They're approaching the limit. What's the upgrade path, and what are 3 ways they could reduce their Page Rules count without losing functionality?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 5:** When should you NOT recommend a Page Rules migration to a customer? (What situations make the risk/benefit unfavorable?)

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

---

## Sources

- [Page Rules Documentation](https://developers.cloudflare.com/rules/page-rules/)
- [Page Rules Migration Guide](https://developers.cloudflare.com/rules/reference/page-rules-migration/)
- [Page Rules API Reference](https://developers.cloudflare.com/api/operations/page-rules-list-page-rules)
- [Cache Rules — Replacement for Page Rules Cache Settings](https://developers.cloudflare.com/cache/how-to/cache-rules/)
- [Configuration Rules — Replacement for Page Rules Feature Toggles](https://developers.cloudflare.com/rules/configuration-rules/)
- [Single Redirects — Replacement for Page Rules Forwarding URL](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/)
