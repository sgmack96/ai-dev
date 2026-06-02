# Module 6.2 — Transform Rules
> **Dashboard Location:** macksportreport.com → Rules → Transform Rules
> **Estimated Time:** 60 minutes
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Are Transform Rules?

Transform Rules allow you to modify HTTP requests and responses **at the Cloudflare edge, before the request reaches your origin server** (for request transforms) or **before the response reaches the user** (for response transforms). They run in the `http_request_transform` phase, which means they execute after custom WAF rules but before the managed WAF.

Transform Rules are one of the highest-leverage tools in Cloudflare's arsenal for solving real customer problems without touching origin code:

- Your legacy app can't be changed, but you need path normalization? Transform Rule.
- You need to add security headers without deploying code? Response Header Modification.
- You want to add location/bot-score headers for your app to consume? Managed Transform.
- You need to canonicalize URLs from an old URL structure? URL Rewrite.

### The Four Types of Transform Rules

#### Type 1: URL Rewrites

URL Rewrites change the URI path or query string that Cloudflare sends to your origin. The user's browser URL bar **does not change** — this is a server-side operation, invisible to the user.

**Two modes:**
- **Static rewrite:** hard-coded replacement value
- **Dynamic rewrite:** expression-based replacement using the rules language + string functions

**Common use cases:**
- Normalize trailing slashes: `/page/` → `/page`
- Add file extension: `/about` → `/about.html`
- Remove path prefix: `/v1/api/users` → `/api/users`
- Migrate URL structure: `/blog/2023/01/title` → `/posts/title`
- A/B test path routing

#### Type 2: HTTP Request Header Modification

Modify headers on the request that Cloudflare forwards to your origin. You can:
- **Add** a new header with a static or dynamic value
- **Remove** an existing header
- **Set** (overwrite) an existing header

**Common use cases:**
- Add `X-Real-IP` header with client IP so your origin knows the real user IP
- Add `X-Forwarded-For` header
- Add `X-CF-Connecting-IP` (though Cloudflare adds this automatically)
- Add custom authentication tokens or routing hints for your origin
- Remove headers that reveal internal infrastructure details
- Add `CF-Bot-Score` header so your app can use bot intelligence

#### Type 3: HTTP Response Header Modification

Modify headers on the response that Cloudflare sends back to the user. You can add, remove, or set headers on the response:

**Common use cases:**
- Add security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`
- Add CORS headers: `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`
- Remove headers that reveal server details: `Server`, `X-Powered-By`, `X-AspNet-Version`
- Override or supplement `Cache-Control` headers without changing origin code

#### Type 4: Managed Transforms

Managed Transforms are pre-built, one-click transforms that Cloudflare maintains. Currently includes:

- **Add Visitor Location Headers:** Adds `CF-IPCountry`, `CF-IPCity`, `CF-IPRegion`, `CF-IPLongitude`, `CF-IPLatitude` to requests going to your origin
- **Add Bot Score Header:** Adds `CF-Score` header with the bot score (0-99) for origin consumption
- **Add "True-Client-IP" Header:** Alternative to CF-Connecting-IP for legacy apps

---

## Deep Dive (Architect-Level)

### The Expression Language for Transform Rules

Transform Rules use the same Ruleset Engine expression language as WAF rules for the **match condition**. The key fields available in the `http_request_transform` phase:

```
# Request fields
http.request.uri              # Full URI (path + query string)
http.request.uri.path         # Path only: /products/shoes
http.request.uri.query        # Query string: ?color=red&size=10
http.request.method           # GET, POST, PUT, etc.
http.host                     # Host header
http.request.headers["X-Custom"]  # Specific request header

# IP/Geo fields
ip.src                        # Client IP
ip.src.country                # ISO country code
ip.src.asnum                  # Client ASN number

# CF-specific fields
cf.client.bot_score           # Bot score 0-99
cf.threat_score               # Threat score 0-100
```

### Dynamic URL Rewrites: String Functions

For dynamic URL rewrites, Cloudflare provides a set of string manipulation functions:

| Function | Example | Result |
|---|---|---|
| `concat(a, b, ...)` | `concat("/new", http.request.uri.path)` | `/new/old-path` |
| `substring(str, start, end)` | `substring(http.request.uri.path, 1, 5)` | First 4 chars of path |
| `lower(str)` | `lower(http.host)` | Lowercase hostname |
| `upper(str)` | `upper(http.request.uri.path)` | Uppercase path |
| `url_decode(str)` | `url_decode(http.request.uri.path)` | Decode percent-encoding |
| `regex_replace(str, pattern, replacement)` | See below | Regex-based substitution |

**Regex Replace Example:**

```
# Rewrite /products/12345/shoes → /items/shoes
regex_replace(http.request.uri.path, "^/products/[0-9]+/(.*)$", "/items/${1}")
```

The `${1}` refers to the first capture group. Cloudflare supports up to 8 capture groups (`${1}` through `${8}`).

### Regex Capture Groups: Advanced Rewriting

This is where URL rewrites become genuinely powerful for migrations:

```
# Old URL structure: /blog/2023/06/article-slug
# New URL structure: /posts/article-slug

Match condition:
http.request.uri.path ~ "^/blog/[0-9]{4}/[0-9]{2}/(.+)$"

Rewrite to (dynamic):
regex_replace(http.request.uri.path, "^/blog/[0-9]{4}/[0-9]{2}/(.+)$", "/posts/${1}")
```

```
# Remove version prefix from API calls
# /v1/api/users → /api/users
# /v2/api/users → /api/users

Match condition:
http.request.uri.path ~ "^/v[0-9]+(/api/.*)$"

Rewrite to (dynamic):
regex_replace(http.request.uri.path, "^/v[0-9]+(/api/.*)$", "${1}")
```

### Query String Manipulation

Transform Rules can also modify query strings, not just paths:

```
# Add a query parameter to all requests to /search
# /search?q=shoes → /search?q=shoes&format=json

Match condition:
http.request.uri.path eq "/search"

Rewrite URI query (dynamic):
concat(http.request.uri.query, "&format=json")
```

**Caution:** If the query string is empty, `concat` still appends correctly. But if you need conditional logic (add param only if not already present), this gets complex — consider using a Worker instead.

### Header Modification: Dynamic Values

Request header modifications support dynamic values using the expression language:

```
# Add header with client country
Header name: X-Visitor-Country
Header value (dynamic): ip.src.country

# Add header with request ID for tracing
Header name: X-Request-ID
Header value (dynamic): cf.unique_visitor_id

# Add header with full original URL (before rewrites)
Header name: X-Original-URL
Header value (dynamic): concat(http.host, http.request.uri)
```

### Response Header Modification: Security Headers

Best practice is to add security headers via response header modification rather than at the origin (this ensures they're always present, even for cached responses):

```
# Add all recommended security headers in one ruleset
Rule: Match everything (true)
Actions (multiple header sets in one rule):
  - Set X-Frame-Options: SAMEORIGIN
  - Set X-Content-Type-Options: nosniff
  - Set Referrer-Policy: strict-origin-when-cross-origin
  - Set Permissions-Policy: camera=(), microphone=(), geolocation=()
  - Set X-XSS-Protection: 0   # (disable - CSP is better)
```

**Note:** Content-Security-Policy is more complex because it usually needs different values per environment. Set a base policy via Transform Rule, then refine with Workers for path-specific policies.

### Execution Order Within Transform Phase

If you have multiple Transform Rules in the same phase, they execute in priority order. But there's a nuance: **the actions are cumulative**.

If Rule 1 adds header `X-Foo: bar` and Rule 2 (lower priority) also adds `X-Foo: baz`, what happens? The last rule to execute wins for `set` actions. For `add` actions (which can have multiple values), both values are added.

**Best practice:** Combine all header modifications into a single rule when possible to avoid ambiguity.

### Transform Rules vs Workers for Header Modification

| Scenario | Transform Rules | Workers |
|---|---|---|
| Add static security headers | Transform Rules (simpler, no code) | Overkill |
| Add dynamic headers based on request | Transform Rules (expression functions) | Only needed for complex logic |
| Modify headers based on response body content | Not possible | Workers (can read body) |
| Conditional logic beyond boolean expressions | Not possible | Workers (full JavaScript) |
| External API calls to get header values | Not possible | Workers |

---

## Dashboard Walkthrough

### Step 1: Navigate to Transform Rules
1. dash.cloudflare.com → macksportreport.com → **Rules** → **Transform Rules**
2. Four tabs: **URL Rewrite Rules**, **Request Header Modification**, **Response Header Modification**, **Managed Transforms**

### Step 2: Create a URL Rewrite Rule
1. Click **URL Rewrite Rules** tab → **+ Create rule**
2. Name: "Test — Normalize Trailing Slash"
3. Under "When incoming requests match...": choose **Custom filter expression**
4. Field: **URI Path**, Operator: **ends with**, Value: `/`
5. Under "Then...": Select **Rewrite URL**
   - Path: **Dynamic** → Expression: `substring(http.request.uri.path, 0, length(http.request.uri.path) - 1)`
6. **Save and deploy**

### Step 3: Create a Response Header Modification Rule
1. Click **Response Header Modification** tab → **+ Create rule**
2. Name: "Security Headers — All Responses"
3. Expression: `true` (match all)
4. Add header operations:
   - Operation: **Set** / Name: `X-Frame-Options` / Value: `SAMEORIGIN`
   - Click **+ Add** / Operation: **Set** / Name: `X-Content-Type-Options` / Value: `nosniff`
5. **Save and deploy**

### Step 4: Enable Managed Transforms
1. Click **Managed Transforms** tab
2. Toggle on **Add Visitor Location Headers**
3. Toggle on **Add "True-Client-IP" Header** (if not already enabled)
4. **Save**

### Step 5: Verify in Browser DevTools
1. Open `https://macksportreport.com` in browser
2. DevTools → Network → Select the main document request
3. Response Headers tab: verify `X-Frame-Options: SAMEORIGIN` is present
4. Request Headers: verify `True-Client-IP` is in the request (check your origin logs)

---

## Hands-On Lab

### Prerequisites
```bash
export CF_API_TOKEN="your_api_token"
export ZONE_ID="your_zone_id"
```

### Lab 1: Get the Transform Ruleset ID

```bash
# Find the http_request_transform phase ruleset
TRANSFORM_RULESET_ID=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq -r '.result[] | select(.phase == "http_request_transform") | .id')

echo "Transform Ruleset ID: ${TRANSFORM_RULESET_ID}"
```

If no ruleset exists for this phase yet, create one:

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Transform Rules",
    "description": "URL and header transforms",
    "kind": "zone",
    "phase": "http_request_transform"
  }' | jq '{id: .result.id, phase: .result.phase}'
```

### Lab 2: Create a URL Rewrite (Remove /v1 Prefix)

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${TRANSFORM_RULESET_ID}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "rewrite",
    "action_parameters": {
      "uri": {
        "path": {
          "expression": "regex_replace(http.request.uri.path, \"^/v1(/.*)?$\", \"${1}\")"
        }
      }
    },
    "expression": "starts_with(http.request.uri.path, \"/v1/\")",
    "description": "Lab: Remove /v1 API prefix",
    "enabled": true
  }' | jq '{id: .result.id, action: .result.action, description: .result.description}'
```

Test it:
```bash
# This request should be rewritten to /api/users internally
curl -s -o /dev/null -w "%{http_code} - %{url_effective}" \
  https://macksportreport.com/v1/api/users
```

### Lab 3: Add Request Header Modification

```bash
# Get or create the response header modification ruleset
RESP_HEADER_RULESET_ID=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq -r '.result[] | select(.phase == "http_response_headers_transform") | .id')

# Create a security headers rule
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RESP_HEADER_RULESET_ID}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "rewrite",
    "action_parameters": {
      "headers": {
        "X-Frame-Options": {"operation": "set", "value": "SAMEORIGIN"},
        "X-Content-Type-Options": {"operation": "set", "value": "nosniff"},
        "Referrer-Policy": {"operation": "set", "value": "strict-origin-when-cross-origin"},
        "X-Powered-By": {"operation": "remove"}
      }
    },
    "expression": "true",
    "description": "Lab: Security headers on all responses",
    "enabled": true
  }' | jq '{id: .result.id, action: .result.action}'
```

### Lab 4: Verify Headers Are Applied

```bash
# Check response headers
curl -s -I https://macksportreport.com/ | grep -E "X-Frame|X-Content|Referrer|X-Powered"

# Expected output:
# X-Frame-Options: SAMEORIGIN
# X-Content-Type-Options: nosniff
# Referrer-Policy: strict-origin-when-cross-origin
# (X-Powered-By should NOT appear)
```

### Lab 5: Test Dynamic Rewrite with Capture Group

```bash
# Create a rule that rewrites /sports/{sport}/{article} → /articles/{sport}/{article}
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${TRANSFORM_RULESET_ID}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "rewrite",
    "action_parameters": {
      "uri": {
        "path": {
          "expression": "regex_replace(http.request.uri.path, \"^/sports/([^/]+)/(.+)$\", \"/articles/${1}/${2}\")"
        }
      }
    },
    "expression": "http.request.uri.path ~ \"^/sports/[^/]+/.+$\"",
    "description": "Lab: Rewrite sports URL structure",
    "enabled": true
  }' | jq '{id: .result.id, description: .result.description}'
```

---

## Demo Script (2 Minutes)

**Audience:** Engineering leader at a startup that can't easily modify their Node.js backend

**Setup:** Browser on macksportreport.com → Rules → Transform Rules

---

*"Your team just told me you need to add security headers to every response, but your next backend deploy is 3 weeks out and the security audit is next week. Here's what we do right now — no code, no deploy, no waiting."*

[Navigate to Transform Rules → Response Header Modification → Create rule]

*"Match condition: 'true' — apply to everything. Now I add headers: X-Frame-Options: SAMEORIGIN — prevents clickjacking. X-Content-Type-Options: nosniff — prevents MIME sniffing attacks. Referrer-Policy: strict-origin. And I'll remove X-Powered-By — why advertise that you're running Express 4.18.2 to attackers?"*

[Save and switch to Terminal]

```bash
curl -I https://macksportreport.com/
```

*"Live in under 60 seconds. No deploy, no code change, no rollback risk. And when your security audit comes up, you can show these headers are consistently applied to every response across your entire domain — not just the pages where your backend happened to add them."*

[Switch to URL Rewrites tab]

*"Same story for URL rewrites. Say you're migrating from /v1/api to just /api — your old iOS clients are still hitting /v1. We add a rewrite rule with a regex capture group, strip the v1 prefix, and your origin never knows. Legacy clients work, new clients work, and your backend only needs to support one URL pattern."*

---

## Competitive Context

| Feature | Cloudflare Transform Rules | AWS CloudFront Functions | Akamai EdgeWorkers | Nginx (at origin) |
|---|---|---|---|---|
| **URL Rewriting** | Yes — expression + regex | Yes — JavaScript | Yes — JavaScript | Yes — regex directives |
| **Header modification (request)** | Yes — add/set/remove | Yes | Yes | Yes |
| **Header modification (response)** | Yes — add/set/remove | Yes | Yes | Yes |
| **Managed/pre-built transforms** | Yes (Visitor Location, Bot Score) | No | Limited | No |
| **No-code configuration** | Yes — dashboard visual builder | No — requires JS deployment | No — requires code deploy | No — config file |
| **Regex capture groups** | Yes | Yes (JS gives full regex) | Yes (JS) | Yes |
| **Dynamic values (expressions)** | Yes — field references | Yes — JS variables | Yes — JS variables | Limited |
| **Requires deploy/code change** | No | Yes (function code) | Yes (code deploy) | Yes (config change + reload) |
| **Latency impact** | ~0ms (compiled rules) | ~1ms (JS cold start) | ~1-3ms | Origin-side, adds RTT |
| **Pricing** | Included in paid plans | $0.10/million invocations | Included in Enterprise | Infrastructure cost |

**Key differentiator:** Cloudflare Transform Rules run as compiled rules (no cold start, no JavaScript overhead). CloudFront Functions run JavaScript, which means there's always some execution overhead. For high-traffic sites, the difference in latency across millions of requests adds up.

---

## Self-Check Questions

**Question 1:** A customer has a static site on `/docs/*` served by an old CMS with URL pattern `/docs/en-us/category/page-title.html`. They want to rewrite incoming requests from `/docs/category/page-title` (no language, no extension) to the old CMS format. Write the match expression and dynamic rewrite expression.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 2:** What is the difference between removing a header via a Transform Rule vs never sending it from origin? When would you choose one over the other?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 3:** A customer wants to add `Cache-Control: no-store` to responses for `/api/*` paths. They could do this via (a) Response Header Modification Transform Rule, (b) Cache Rules, or (c) at the origin. Compare these three approaches.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 4:** After enabling "Add Visitor Location Headers" Managed Transform, where will the customer see the `CF-IPCountry` header — in the browser's request, or in their origin server's received headers?

```
Your answer:
_______________________________________________
_______________________________________________
```

**Question 5:** A URL Rewrite rule successfully rewrites `/old-path` to `/new-path`. The user navigates to `https://macksportreport.com/old-path`. What URL do they see in their browser's address bar after the page loads? Why?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

---

## Sources

- [Transform Rules Documentation](https://developers.cloudflare.com/rules/transform/)
- [URL Rewrite Rules](https://developers.cloudflare.com/rules/transform/url-rewrite/)
- [Request Header Modification](https://developers.cloudflare.com/rules/transform/request-header-modification/)
- [Response Header Modification](https://developers.cloudflare.com/rules/transform/response-header-modification/)
- [Managed Transforms](https://developers.cloudflare.com/rules/transform/managed-transforms/)
- [Rules Language — String Functions](https://developers.cloudflare.com/ruleset-engine/rules-language/functions/)
- [Transform Rules — Examples](https://developers.cloudflare.com/rules/transform/examples/)
