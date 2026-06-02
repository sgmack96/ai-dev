# Module 5.2 — Cache Rules
> Dashboard Location: macksportreport.com → Caching → Cache Rules
> Estimated Time: 90 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Are Cache Rules?

Cache Rules are Cloudflare's declarative, zone-level mechanism for controlling caching behavior per URL pattern, hostname, path, query string, HTTP method, or any other request attribute.

Before Cache Rules (the modern system), Cloudflare had Page Rules — a legacy system with a 3-rule limit on free plans. Cache Rules replaced Page Rules for caching use cases and are significantly more powerful.

**Why Cache Rules matter for macksportreport.com:**
- The site serves sports news articles — HTML pages that don't change often
- By default, HTML is NOT cached (cf-cache-status: DYNAMIC)
- With Cache Rules, we can cache article pages for 1 hour → massive origin offload
- We need to bypass cache for admin dashboards, login pages, cart pages

### The Architecture of a Cache Rule

Every Cache Rule has two parts:

```
IF [match condition] THEN [actions]
```

Example:
```
IF: URI Path starts with /articles/
THEN: Edge TTL = 3600 seconds, Cache Everything = ON
```

Rules are evaluated **top to bottom**. The first matching rule wins. Order matters.

---

## Deep Dive (Architect-Level)

### Match Conditions

Cache Rules can match on any combination of:

| Field | Example Values | Notes |
|-------|---------------|-------|
| URI Full | `https://macksportreport.com/articles/nfl-playoffs` | Exact match |
| URI Path | `/articles/*`, `/admin/*` | Wildcard supported |
| URI Path extension | `.js`, `.css`, `.html` | File extension match |
| Hostname | `macksportreport.com`, `api.macksportreport.com` | Multi-hostname zones |
| Query String | `?preview=true`, `?nocache=*` | Specific param values |
| HTTP Method | `GET`, `POST`, `PUT` | Method-specific rules |
| Cookie | `session_id`, `cart_items` | Cookie name presence |
| Request Header | `X-Preview: true` | Any request header |
| IP Source | `1.2.3.4/24` | CIDR range matching |
| Country | `US`, `GB`, `CN` | Geo-based rules |

**Logical operators:** AND, OR, NOT — you can combine conditions.

**Example composite rule:**
```
URI Path starts with /articles/
AND HTTP Method = GET
AND NOT Cookie contains "admin_session"
```

### Rule Actions

#### 1. Cache Eligibility

| Option | Effect |
|--------|--------|
| **Bypass cache** | Skip the cache entirely; go to origin every time |
| **Eligible for cache** | Allow caching (required to cache HTML) |

This is the most critical action. Without setting eligibility to "Eligible for cache," HTML will always be DYNAMIC.

#### 2. Edge TTL

Controls how long Cloudflare's edge caches the response.

| Option | Effect |
|--------|--------|
| **Use cache-control header if present, bypass cache if not** | Default behavior |
| **Ignore cache-control header and use this TTL** | Overrides origin headers completely |
| **Override cache-control header, only if missing** | Fill in TTL when origin doesn't send one |

**TTL presets available in Dashboard:**
- 30 seconds, 1 minute, 2 minutes, 5 minutes
- 10 minutes, 30 minutes, 1 hour, 2 hours
- 4 hours, 8 hours, 16 hours, 1 day
- 2 days, 3 days, 4 days, 5 days, 6 days
- 7 days, 30 days, 60 days, 90 days, 6 months, 1 year

#### 3. Browser TTL

Controls how long the user's browser caches the response.

| Option | Effect |
|--------|--------|
| **Respect cache-control header** | Pass through origin's directive |
| **Override cache-control header** | Set specific TTL for browsers |

**Note:** Browser TTL cannot exceed Edge TTL via Cloudflare configuration. If edge TTL = 1 hour, browser TTL should be ≤ 1 hour for logical consistency.

#### 4. Cache Key

This is the most powerful and misunderstood action. Cache key customization lets you control what makes two requests "the same" for caching purposes.

**Query String Handling:**

| Option | Effect |
|--------|--------|
| **Include all query parameters** | Default. utm_source=a and utm_source=b = different cache entries |
| **Ignore all query parameters** | All query strings treated as same URL |
| **Ignore specific parameters** | Ignore `utm_*`, `fbclid` but keep `page`, `sort` |
| **Include only specific parameters** | Only `page` and `sort` matter; everything else ignored |

**Practical example for macksportreport.com:**

Articles get linked with tracking params:
```
/articles/nfl-playoffs?utm_source=twitter&utm_medium=social
/articles/nfl-playoffs?utm_source=email&utm_campaign=weekly
/articles/nfl-playoffs
```

Without cache key tuning: 3 separate cache entries, each requiring origin fetch.
With "Ignore utm_*": All three resolve to the same cache entry.

**Header-based cache keys:**

Include `Accept-Language` to serve different cached versions per language:
```
Accept-Language: en-US  → cached response A
Accept-Language: es-ES  → cached response B
```

**Cookie-based cache keys:**

Include a `subscription_tier` cookie to serve different cached content to free vs premium users.

#### 5. Serve Stale

If the origin becomes unavailable (error 502, 503, 504, timeout), how long should Cloudflare serve the stale cached content?

| Setting | Effect |
|---------|--------|
| **0 seconds (disabled)** | Return origin error to user |
| **30 seconds to 1 year** | Serve stale content for defined period |

**Recommendation:** Set to at least 1 day for public content. This means your site stays up even if your origin goes down, serving cached content.

This is distinct from `stale-if-error` in Cache-Control — Cloudflare's Serve Stale setting takes precedence.

#### 6. Origin Error Page Pass-Through

When enabled: if origin returns a 4xx or 5xx with its own HTML error page, pass that page through to the user instead of Cloudflare's generic error page.

When disabled (default): Cloudflare shows a branded error page.

---

### The "Cache Everything" Pattern

By default, Cloudflare doesn't cache HTML. The "Cache Everything" pattern means using a Cache Rule to force HTML pages into the cache.

**When to use Cache Everything:**
- Static sites (no personalization)
- Blog/news articles (same content for all users)
- Documentation sites
- Marketing landing pages
- Infrequently changing HTML

**When NOT to use Cache Everything:**
- E-commerce cart/checkout pages (user-specific)
- Account dashboards
- Any page that includes a user's name, email, or personal data
- Authenticated content
- Pages with session-dependent state

**Safe pattern for macksportreport.com:**

```
Rule 1 (PRIORITY 1): 
  Match: URI Path starts with /admin/
  Action: Bypass Cache

Rule 2 (PRIORITY 2):
  Match: Cookie contains "auth_token"
  Action: Bypass Cache

Rule 3 (PRIORITY 3):
  Match: URI Path starts with /articles/ AND Method = GET
  Action: Eligible for Cache, Edge TTL = 1 hour
          Ignore query params: utm_source, utm_medium, utm_campaign, fbclid, gclid

Rule 4 (PRIORITY 4):
  Match: URI Path = / (homepage)
  Action: Eligible for Cache, Edge TTL = 5 minutes
```

### Cache by Device Type

Cloudflare can detect if a request comes from a mobile, desktop, or tablet device (using User-Agent header parsing). You can serve different cached versions per device type.

**Enable in**: Dashboard → Caching → Cache Rules → Cache Key → Device Type

**Use case:** Your site serves a different HTML layout for mobile vs desktop and you want both cached.

**Important:** You must also add `Vary: User-Agent` to your origin's response, or Cloudflare will serve the desktop version to mobile users.

Better practice: Use responsive design and serve the same HTML. Device-type caching adds cache complexity.

---

### Rule Priority

When multiple rules match a request, Cloudflare evaluates them by **priority order** (top-to-bottom in the UI).

```
Request: GET /admin/settings
Rule 1: URI starts with /admin/ → Bypass Cache        ← WINS (matched first)
Rule 2: Method = GET → Cache for 1 hour
```

**Best practice for priority ordering:**
1. Most specific exclusions at the top (admin pages, auth pages)
2. Broad cache rules at the bottom

---

## Dashboard Walkthrough

### Step 1: Navigate to Cache Rules
1. Cloudflare Dashboard → **macksportreport.com**
2. Left sidebar → **Caching** → **Cache Rules**
3. Click **Create Rule**

### Step 2: Build a Cache Everything Rule for Articles

**Rule name:** Cache Article Pages

**When incoming requests match:**
- Field: `URI Path`
- Operator: `starts with`
- Value: `/articles/`

**Then the settings are:**
- Cache eligibility: `Eligible for cache`
- Edge TTL: `Override` → 3600 (1 hour)
- Browser TTL: `Override` → 300 (5 minutes)
- Cache key → Query String → `Ignore specific parameters` → Add: `utm_source`, `utm_medium`, `utm_campaign`, `fbclid`, `gclid`

Click **Deploy**

### Step 3: Build a Bypass Rule for Admin

**Rule name:** Bypass Admin Cache

**When incoming requests match:**
- Field: `URI Path`
- Operator: `starts with`
- Value: `/admin/`

**Then the settings are:**
- Cache eligibility: `Bypass cache`

**Priority:** Move this rule ABOVE the Cache Articles rule.

### Step 4: Verify Rule Order

In the Cache Rules list, drag the Admin Bypass rule to position #1 (top). Article Cache rule should be below it.

---

## Hands-On Lab

### Lab Setup

```bash
export CF_ZONE_ID="your_zone_id"
export CF_API_TOKEN="your_api_token"
```

### Lab 1: Verify Default HTML Behavior (Pre-Rule)

```bash
# Before creating any Cache Rules — HTML should be DYNAMIC
curl -sI https://macksportreport.com/ | grep cf-cache-status
# Expected: cf-cache-status: DYNAMIC

# Static asset should be HIT (already cached)
curl -sI https://macksportreport.com/favicon.ico | grep cf-cache-status
# Expected: cf-cache-status: HIT (after first request)
```

### Lab 2: Create Cache Rule via API

```bash
# Create a Cache Rule to cache /articles/* for 1 hour
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/rulesets/phases/http_request_cache_settings/entrypoint/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "set_cache_settings",
    "action_parameters": {
      "cache": true,
      "edge_ttl": {
        "mode": "override_origin",
        "default": 3600
      },
      "browser_ttl": {
        "mode": "override_origin",
        "default": 300
      }
    },
    "expression": "(http.request.uri.path starts_with \"/articles/\")",
    "description": "Cache article pages for 1 hour",
    "enabled": true
  }' | jq .
```

### Lab 3: Create Bypass Rule via API

```bash
# Create a Cache Rule to bypass cache for /admin/*
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/rulesets/phases/http_request_cache_settings/entrypoint/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "set_cache_settings",
    "action_parameters": {
      "cache": false
    },
    "expression": "(http.request.uri.path starts_with \"/admin/\")",
    "description": "Bypass cache for admin pages",
    "enabled": true
  }' | jq .
```

### Lab 4: List Current Cache Rules

```bash
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/rulesets/phases/http_request_cache_settings/entrypoint" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.result.rules[] | {id: .id, description: .description, expression: .expression, enabled: .enabled}'
```

### Lab 5: Verify Article Caching After Rule

```bash
# First request - should be MISS (first time this PoP sees it)
curl -sI https://macksportreport.com/articles/ | grep -i "cf-cache\|age"

# Second request - should be HIT
curl -sI https://macksportreport.com/articles/ | grep -i "cf-cache\|age"
```

### Lab 6: Test Query String Normalization

```bash
# These should all return the same cached response after rule is applied
curl -sI "https://macksportreport.com/articles/?utm_source=twitter" | grep cf-cache-status
curl -sI "https://macksportreport.com/articles/?utm_source=email" | grep cf-cache-status
curl -sI "https://macksportreport.com/articles/" | grep cf-cache-status

# All should show HIT after first request (because utm_ params are ignored)
```

### Lab 7: Verify Admin Bypass

```bash
# Admin pages should always be BYPASS
curl -sI https://macksportreport.com/admin/ | grep cf-cache-status
# Expected: cf-cache-status: BYPASS

# Run 5 times — should stay BYPASS (never HIT)
for i in {1..5}; do
  curl -sI https://macksportreport.com/admin/ | grep cf-cache-status
done
```

### Lab 8: Test Cookie-Based Bypass

```bash
# Request with auth cookie — should bypass cache
curl -sI https://macksportreport.com/articles/ \
  -H "Cookie: auth_token=abc123" \
  | grep cf-cache-status
# Expected: BYPASS (if you built a cookie-based bypass rule)

# Request without auth cookie — should hit cache
curl -sI https://macksportreport.com/articles/ | grep cf-cache-status
# Expected: HIT
```

### Lab 9: Update Rule Edge TTL via API

```bash
# Get rule ID first
RULE_ID=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/rulesets/phases/http_request_cache_settings/entrypoint" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  | jq -r '.result.rules[] | select(.description == "Cache article pages for 1 hour") | .id')

echo "Rule ID: ${RULE_ID}"

# Update the rule to 7200 seconds (2 hours)
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/rulesets/phases/http_request_cache_settings/entrypoint/rules/${RULE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action_parameters": {
      "cache": true,
      "edge_ttl": {
        "mode": "override_origin",
        "default": 7200
      }
    }
  }' | jq .
```

### Lab 10: Disable a Rule Without Deleting

```bash
# Disable a rule temporarily (useful for incident response)
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/rulesets/phases/http_request_cache_settings/entrypoint/rules/${RULE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' | jq .
```

---

## Demo Script (2 Minutes)

**Audience:** Developer or technical lead who manages the site
**Setup:** Dashboard open at Caching → Cache Rules, terminal ready

---

**[0:00]** "Right now your HTML pages aren't being cached — every article request hits your server. Let me show you what we can do."

```bash
curl -sI https://macksportreport.com/articles/ | grep cf-cache-status
# Shows: DYNAMIC
```

**[0:20]** "DYNAMIC means we're not even attempting to cache it. Your origin handles every single request. Let me create a Cache Rule — takes about 30 seconds."

*[Create rule in dashboard: URI Path starts with /articles/, Eligible for cache, 1 hour TTL]*

**[0:50]** "Rule is live. Let's test it..."

```bash
curl -sI https://macksportreport.com/articles/ | grep -i "cf-cache\|age"
# First: MISS
```

**[1:00]** "First request was a MISS — Cloudflare fetched it from your origin and stored it. Now watch..."

```bash
curl -sI https://macksportreport.com/articles/ | grep -i "cf-cache\|age"
# Second: HIT, age: 2
```

**[1:15]** "HIT. Your origin didn't see that second request at all. For a sports site with a viral article, that's the difference between your server staying up and going down."

**[1:35]** "And we can be surgical about this — blog posts cached for 1 hour, homepage cached for 5 minutes, admin pages always bypassed. All in the same rules interface."

**[1:55]** "The business impact: your origin compute cost goes down in proportion to your cache hit rate. On a content-heavy site, you can realistically hit 80-90% hit rate."

---

## Competitive Context

| Feature | Cloudflare Cache Rules | AWS CloudFront Behaviors | Fastly VCL | Vercel |
|---------|----------------------|--------------------------|------------|--------|
| Rule interface | GUI + API (Ruleset API) | Behavior GUI | Code (VCL) | `vercel.json` headers |
| HTML caching | Yes — Cache Rules | Yes — default | Yes | Limited control |
| Rule count (Free) | 10 rules | No limit (but $) | No limit | Limited |
| Query string control | GUI — ignore specific params | Cache policies | VCL code | None |
| Cookie-based bypass | GUI rule condition | Whitelist/blacklist | VCL | No |
| Device type caching | Yes — built in | Lambda@Edge required | VCL | No |
| Cache key customization | GUI — headers, cookies, query | Cache policies | VCL | No |
| Origin error passthrough | Yes | Error pages config | VCL | No |
| Serve stale | Yes — GUI setting | Origin Shield | VCL | No |
| Rule priorities | Drag to reorder | Behavior path patterns | VCL order | N/A |

**Cloudflare advantage:** GUI-driven Cache Rules with Ruleset API access means even non-VCL engineers can configure sophisticated caching behavior. Fastly requires VCL knowledge (Varnish Configuration Language) for equivalent functionality.

---

## Self-Check Questions

**Q1.** You have two Cache Rules: Rule 1 caches all `/articles/*` paths for 1 hour. Rule 2 bypasses cache if the request contains a `preview=true` query string. A request comes in for `/articles/nfl-playoffs?preview=true`. Which rule should be listed first (highest priority) to get the desired behavior? Explain your reasoning.

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q2.** Your marketing team uses Google Analytics UTM parameters extensively (`utm_source`, `utm_medium`, `utm_campaign`). An article is shared on Twitter and Facebook with different UTM values. Without cache key tuning, how many cache entries will be created for the same article? What cache key setting would you apply to fix this?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q3.** A developer says "we can't cache our articles because logged-in users see a personalized sidebar with their name." How would you design Cache Rules to cache the article content while handling this requirement? What are two different approaches?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q4.** What is the difference between Edge TTL `"Override"` mode and `"Override if missing"` mode? When would you choose one over the other?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q5.** Your origin starts returning `Cache-Control: no-store` on article pages due to a configuration mistake. You have a Cache Rule set to Edge TTL = Override 3600 seconds. Will the Cache Rule override the `no-store` directive? What does this mean for production risk?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

---

## Sources

- [Cache Rules Overview](https://developers.cloudflare.com/cache/how-to/cache-rules/)
- [Cache Rules — Settings Reference](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/)
- [Cache Rules — Match Conditions](https://developers.cloudflare.com/cache/how-to/cache-rules/create-api/)
- [Cache Everything](https://developers.cloudflare.com/cache/how-to/cache-everything/)
- [Custom Cache Keys](https://developers.cloudflare.com/cache/how-to/cache-keys/)
- [Cloudflare Ruleset API](https://developers.cloudflare.com/ruleset-engine/rulesets-api/)
- [Migrating from Page Rules to Cache Rules](https://developers.cloudflare.com/rules/reference/page-rules-migration/)
- [Serve Stale Content](https://developers.cloudflare.com/cache/concepts/cache-revalidation/)
