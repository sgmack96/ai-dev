# Module 6.3 — Redirect Rules
> **Dashboard Location:** macksportreport.com → Rules → Redirect Rules
> **Estimated Time:** 60 minutes
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Are Redirect Rules?

Redirect Rules tell Cloudflare to send an HTTP redirect response (3xx) to the client for matching requests. Unlike Transform Rules (which are server-side rewrites invisible to the browser), redirects change the URL in the user's address bar.

There are two types of Redirect Rules in Cloudflare:

**1. Single Redirects** — rule-based, expression-matched redirects for specific patterns
**2. Bulk Redirects** — list-based redirects for thousands of URLs simultaneously

Both execute at the Cloudflare edge — faster than origin-side redirects and without consuming origin server resources.

### HTTP Redirect Status Codes: When to Use Each

This is a question you'll get from customers constantly. Know these cold:

| Code | Name | Meaning | Browser Cache? | Method Preserved? | Use Case |
|---|---|---|---|---|---|
| **301** | Moved Permanently | Resource has permanently moved | Yes — browser caches redirect | No — POST becomes GET | Domain migrations, permanent URL changes |
| **302** | Found (Temporary) | Temporary redirect | No — browser re-checks each time | No — POST becomes GET | Maintenance pages, temporary campaigns |
| **307** | Temporary Redirect | Temporary, method preserved | No | Yes — POST stays POST | API method-safe temporary redirects |
| **308** | Permanent Redirect | Permanent, method preserved | Yes | Yes — POST stays POST | Permanent API endpoint changes |

**The critical nuance:** 301 and 302 change POST to GET. If a form submission or API POST hits a redirect, the browser resends as GET and loses the body. Use 307/308 for API redirects where the method matters.

**SEO note:** 301 passes "link juice" (PageRank). 302 does not. For domain migrations and URL canonicalization, always use 301.

### Single Redirects vs Bulk Redirects: When to Use Each

| Scenario | Use Single Redirects | Use Bulk Redirects |
|---|---|---|
| A few dozen URL-specific redirects | Yes | Overkill |
| Pattern-based redirects (all /old/* → /new/*) | Yes — expression matching | No |
| Thousands of specific URL pairs | No — too slow to configure | Yes |
| Domain migration with exact URL mapping | Maybe | Yes (CSV import) |
| Redirects with complex conditions (country, device) | Yes | No — fixed condition |
| Dynamic redirects with capture groups | Yes | No |

---

## Deep Dive (Architect-Level)

### Single Redirects: Expression-Based

Single Redirects use the same Ruleset Engine expression language as everything else. You define:
- **When (match condition):** expression that selects which requests to redirect
- **Then (target URL):** either static string or dynamic expression
- **Status code:** 301, 302, 307, or 308
- **Preserve query string:** bool — whether to append the original query string to the redirect target

**Static redirect example:**
```
Match: http.request.uri.path eq "/old-about"
Target: https://macksportreport.com/about-us
Status: 301
```

**Dynamic redirect with path preservation:**
```
Match: starts_with(http.request.uri.path, "/sport/")
Target: concat("https://macksportreport.com/sports/", substring(http.request.uri.path, 7))
Status: 301
```

This redirects:
- `/sport/nba` → `/sports/nba`
- `/sport/nfl/scores` → `/sports/nfl/scores`

**Cross-domain redirect preserving full path:**
```
Match: http.host eq "old-domain.com"
Target: concat("https://macksportreport.com", http.request.uri.path)
Status: 301
Preserve query string: yes
```

This handles a full domain migration: any request to old-domain.com gets redirected to macksportreport.com with the same path and query string.

### Bulk Redirects: List-Based Architecture

Bulk Redirects are designed for large-scale URL migration scenarios. The architecture is:

```
Account-level Redirect List
  └── Row 1: /old-url-1 → https://macksportreport.com/new-url-1 (301)
  └── Row 2: /old-url-2 → https://macksportreport.com/new-url-2 (302)
  └── Row N: ...

Zone-level Bulk Redirect Rule
  └── "Execute this redirect list"
```

**Key points:**
- Redirect Lists live at the **account level**, not zone level. One list can be shared across multiple zones.
- Each list supports up to **10,000 entries**
- A zone can have **multiple Bulk Redirect rules** referencing different lists
- You can upload via CSV, API, or manual entry

**CSV format for bulk upload:**
```csv
/old-url-1,https://macksportreport.com/new-url-1,301,true
/old-url-2,https://macksportreport.com/new-url-2,301,false
/old-url-3,https://macksportreport.com/new-url-3,302,true
```

Fields: source URL, target URL, status code, preserve query string

**Important:** Bulk Redirect source URLs are **exact path matches** (not expressions). They do not support wildcards or regex. If you need pattern matching, use Single Redirects instead.

### Performance of Bulk Redirects

Cloudflare stores Bulk Redirect lists in a distributed data store and evaluates them at every edge PoP. The lookup is O(1) for exact match — the system uses hash lookups, not linear scans. This means a list with 10,000 entries performs the same as a list with 10 entries.

**Real-world impact:** A customer migrating a 5,000-page website can implement all 5,000 redirects in one Bulk Redirect list with no performance degradation compared to 5 redirects.

### Redirect Rules vs Transform Rules: The Critical Distinction

This is a common source of customer confusion:

| | Redirect Rule | URL Rewrite (Transform Rule) |
|---|---|---|
| **What the user sees** | URL bar changes to new URL | URL bar stays the same |
| **HTTP response** | 301/302/307/308 response | No response — request continues |
| **Browser history** | New URL added to history | No change |
| **SEO** | Passes PageRank (301) | No SEO signal |
| **Origin sees** | New (redirected) URL | Rewritten URL |
| **Round trips** | Requires additional browser request | Zero extra round trips |
| **Use case** | User should bookmark/share new URL | Backend routing, path normalization |

**Example that clarifies the difference:**

A customer migrates from `/news/` to `/articles/`:
- **Redirect:** User visits `/news/` → browser redirects to `/articles/` → user sees `/articles/` in address bar → Google updates index
- **URL Rewrite:** User visits `/news/` → Cloudflare rewrites to `/articles/` → origin receives `/articles/` → user still sees `/news/` in address bar → Google thinks `/news/` still exists

For SEO migrations, always use redirects. For silent backend routing, use rewrites.

### Redirect vs Page Rules "Forwarding URL"

The old Page Rules had a "Forwarding URL" action that implemented redirects. Here's the comparison:

| Feature | New Redirect Rules | Page Rules Forwarding URL |
|---|---|---|
| URL matching | Full expression language | Glob patterns only (`*`) |
| Capture group syntax | `${1}` via regex_replace | `$1` in destination |
| Status codes | 301, 302, 307, 308 | 301, 302 only |
| Bulk redirects | Yes — dedicated system | No |
| Rule limit | Per plan (same as other rules) | 3/20/50 per plan |
| Preserve query string | Explicit toggle | Included with `$1*` pattern |

**Migration example:**

Old Page Rule:
```
URL: https://macksportreport.com/old-blog/*
Action: Forwarding URL (301)
Destination: https://macksportreport.com/blog/$1
```

New Redirect Rule:
```
Match: starts_with(http.request.uri.path, "/old-blog/")
Target: concat("https://macksportreport.com/blog/", substring(http.request.uri.path, 10))
Status: 301
```

### Redirect Priority and Execution Phase

Single Redirects run in the `http_request_dynamic_redirect` phase. Bulk Redirects run in the `http_request_bulk_redirects` phase. Critically:

- Both redirect phases run **after Transform Rules** (URL rewrites). So if you rewrite a URL and it now matches a redirect, the redirect fires.
- Both redirect phases run **before the request reaches your origin**. If a redirect matches, origin is never contacted.
- Single Redirects have priority over Bulk Redirects (different phases, single redirect phase executes first).

---

## Dashboard Walkthrough

### Step 1: Navigate to Redirect Rules
1. macksportreport.com → **Rules** → **Redirect Rules**
2. Two tabs: **Single Redirects** and **Bulk Redirects**

### Step 2: Create a Single Redirect
1. **Single Redirects** tab → **+ Create rule**
2. Name: "Blog Migration Redirect"
3. Match expression: `starts_with(http.request.uri.path, "/blog/")`
4. Then: Redirect to URL
   - URL type: **Dynamic**
   - Expression: `concat("https://macksportreport.com/articles/", substring(http.request.uri.path, 6))`
5. Status code: **301**
6. Preserve query string: **checked**
7. **Save and deploy**

### Step 3: Create a Redirect List (for Bulk)
1. Top-right corner → Account profile → **Account Home**
2. Left sidebar → **Configurations** → **Lists**
3. **+ Create list** → Name: "URL Migrations 2024" → Type: **Redirect**
4. Add entries manually or upload CSV
5. Sample entry: `/old-careers` → `https://macksportreport.com/join-the-team` → 301 → No (preserve QS)

### Step 4: Create a Bulk Redirect Rule
1. Back to macksportreport.com → **Rules** → **Redirect Rules** → **Bulk Redirects**
2. **+ Create rule**
3. Name: "2024 URL Migration List"
4. Select your redirect list: "URL Migrations 2024"
5. **Save and deploy**

### Step 5: Test Redirects
1. Browser: navigate to a URL in the list → confirm you land on the new URL
2. DevTools → Network → first request shows 301/302 → second shows final page

---

## Hands-On Lab

### Prerequisites
```bash
export CF_API_TOKEN="your_api_token"
export ZONE_ID="your_zone_id"
export ACCOUNT_ID="your_account_id"
```

### Lab 1: Create a Single Redirect via API

```bash
# Get or note the dynamic redirect ruleset
REDIRECT_RULESET=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq -r '.result[] | select(.phase == "http_request_dynamic_redirect") | .id')

echo "Redirect Ruleset: ${REDIRECT_RULESET}"

# Create a single redirect rule (301 from /old-about to /about-us)
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${REDIRECT_RULESET}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "redirect",
    "action_parameters": {
      "from_value": {
        "status_code": 301,
        "target_url": {
          "value": "https://macksportreport.com/about-us"
        },
        "preserve_query_string": false
      }
    },
    "expression": "http.request.uri.path eq \"/old-about\"",
    "description": "Lab: Redirect /old-about to /about-us",
    "enabled": true
  }' | jq '{id: .result.id, action: .result.action, description: .result.description}'
```

### Lab 2: Test the Redirect

```bash
# Should return 301 with Location header
curl -s -I https://macksportreport.com/old-about | grep -E "HTTP|Location|location"

# Follow the redirect (capital -L)
curl -sL -o /dev/null -w "Final URL: %{url_effective}\nStatus: %{http_code}\n" \
  https://macksportreport.com/old-about
```

### Lab 3: Create a Redirect List

```bash
# Create a redirect list at account level
LIST_ID=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/rules/lists" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "lab_url_migrations",
    "description": "Lab: URL migration list",
    "kind": "redirect"
  }' | jq -r '.result.id')

echo "List ID: ${LIST_ID}"

# Add redirect entries to the list
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/rules/lists/${LIST_ID}/items" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "redirect": {
        "source_url": "/old-careers",
        "target_url": "https://macksportreport.com/join-the-team",
        "status_code": 301,
        "preserve_query_string": false,
        "include_subdomains": false,
        "subpath_matching": false,
        "preserve_path_suffix": false
      }
    },
    {
      "redirect": {
        "source_url": "/old-contact",
        "target_url": "https://macksportreport.com/contact-us",
        "status_code": 301,
        "preserve_query_string": true,
        "include_subdomains": false,
        "subpath_matching": false,
        "preserve_path_suffix": false
      }
    }
  ]' | jq '.result | length'
```

### Lab 4: Create Bulk Redirect Rule Using the List

```bash
# Get or create the bulk redirect ruleset
BULK_REDIRECT_RULESET=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq -r '.result[] | select(.phase == "http_request_bulk_redirects") | .id')

# Create bulk redirect rule
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${BULK_REDIRECT_RULESET}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"redirect\",
    \"action_parameters\": {
      \"from_list\": {
        \"name\": \"lab_url_migrations\",
        \"key\": \"http.request.full_uri\"
      }
    },
    \"expression\": \"http.request.full_uri in \\\$lab_url_migrations\",
    \"description\": \"Lab: Bulk redirects from migration list\",
    \"enabled\": true
  }" | jq '{id: .result.id, action: .result.action}'
```

### Lab 5: Verify Bulk Redirects

```bash
# Test both bulk redirect entries
for path in "/old-careers" "/old-contact"; do
  echo "Testing ${path}:"
  curl -s -I "https://macksportreport.com${path}" | grep -E "HTTP|Location"
  echo "---"
done
```

### Lab 6: Check Redirect Chain (Avoid Double Redirects)

```bash
# Trace the full redirect chain with timing
curl -s -L -w "\n\nFull timing:\n  DNS: %{time_namelookup}s\n  Connect: %{time_connect}s\n  TLS: %{time_appconnect}s\n  First byte: %{time_starttransfer}s\n  Total: %{time_total}s\n  Redirects: %{num_redirects}\n" \
  -o /dev/null \
  https://macksportreport.com/old-careers
```

If `num_redirects` is more than 1, you have a redirect chain — investigate and consolidate.

---

## Demo Script (2 Minutes)

**Audience:** E-commerce store owner doing a domain migration / URL restructuring

**Setup:** Terminal ready, macksportreport.com dashboard open

---

*"You've got 5,000 product pages on your old URL structure — /products/category/sku — and you're moving to /shop/sku. Your SEO team is freaking out because 5,000 broken links means losing all your search rankings."*

[Show Account → Lists → Redirect Lists]

*"Here's what we do. Your dev team exports your old and new URLs into a CSV — one column for old path, one for new. Two columns, 5,000 rows, done in 5 minutes with a database query."*

[Show CSV format in editor]

*"Upload it here. Cloudflare now has your complete redirect map stored at every edge location globally. Sub-millisecond lookup, even at 5,000 entries."*

[Create Bulk Redirect rule]

*"One rule references the whole list. Done. Every single one of those 5,000 URLs now returns a 301 Moved Permanently. Google's bots crawl them, update their index, transfer the PageRank to your new URLs. You keep your SEO."*

[Test in terminal]

```bash
curl -I https://macksportreport.com/old-careers | grep -E "HTTP|Location"
```

*"301, redirects to the new URL, under 50 milliseconds from the edge. Your origin server never got hit. And next month when you add 500 more products? Add rows to the CSV, re-upload, done."*

---

## Competitive Context

| Feature | Cloudflare Redirect Rules | AWS CloudFront + S3 Redirect | Netlify Redirects | Vercel Redirects |
|---|---|---|---|---|
| **Bulk redirect capacity** | 10,000 per list | Limited by Lambda config | 1,000 per file | 1,024 per file |
| **Redirect list format** | CSV or API | Routing rules JSON | `_redirects` file in git | `vercel.json` |
| **Pattern matching** | Full expression language | Limited patterns | Path patterns, splat | Path patterns |
| **Dynamic expressions** | Yes (concat, regex_replace) | Via Lambda@Edge JS | No | Limited |
| **Status codes supported** | 301, 302, 307, 308 | 301, 302 | 200-301-302 | 301, 302, 307, 308 |
| **Edge performance** | All 300+ PoPs, O(1) lookup | CloudFront edges | Netlify CDN edges | Vercel edge nodes |
| **Not tied to hosting** | Yes — any origin/serverless | CloudFront only | Netlify-hosted only | Vercel-hosted only |
| **Programmatic management** | Yes — full REST API | Yes — CloudFormation/API | Git commit | Git or API |
| **Cost** | Included in plan | Lambda@Edge: $0.60/million | Included | Included |

**Key differentiator:** Cloudflare Redirect Rules are **origin-agnostic** — they work regardless of where your content is hosted (AWS, GCP, on-prem, Workers). Netlify and Vercel redirects only work for sites hosted on their platform. CloudFront redirects require either Lambda@Edge (expensive, latency) or S3 website redirect rules (limited).

---

## Self-Check Questions

**Question 1:** A customer is doing a full domain migration from `old-sportnews.com` to `macksportreport.com`, preserving exact paths and query strings. Write the Single Redirect expression and dynamic target URL for this migration.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 2:** Explain when you would use a 307 instead of a 302. Give a specific technical scenario where getting this wrong causes a bug.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 3:** A customer uploads 10,000 redirects via Bulk Redirect list and reports "some redirects aren't working." You check the list and the entries look correct. What are three possible causes to investigate?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 4:** Customer asks: "Should I keep my 5,000 origin-side .htaccess redirects or migrate them to Cloudflare Bulk Redirects?" Make the case for Cloudflare. What are the performance and operational benefits?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 5:** A Single Redirect rule and a Bulk Redirect list both contain entries for `/old-page`. Which one fires? Why?

```
Your answer:
_______________________________________________
_______________________________________________
```

---

## Sources

- [Redirect Rules Documentation](https://developers.cloudflare.com/rules/url-forwarding/)
- [Single Redirects](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/)
- [Bulk Redirects](https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/)
- [Create Redirect Lists via API](https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/create-api/)
- [Redirect Rules — Examples](https://developers.cloudflare.com/rules/url-forwarding/examples/)
- [Page Rules Migration — Forwarding URL](https://developers.cloudflare.com/rules/reference/page-rules-migration/#forwarding-url)
