# Module 5.1 — Cache Architecture & Cache Status Headers
> Dashboard Location: macksportreport.com → Caching → Configuration
> Estimated Time: 90 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is the Cloudflare Cache?

Cloudflare operates a global network of 330+ Points of Presence (PoPs). When a user requests a resource, the request is intercepted at the nearest PoP. If that PoP has a cached copy of the response, it serves it immediately — without touching your origin server.

This is the **fundamental value proposition of caching**: reduce latency, reduce origin load, reduce bandwidth costs.

```
User → Cloudflare PoP (cache HIT) → Returns response in ~1ms
User → Cloudflare PoP (cache MISS) → Origin Server → Cache stored → Returns response
```

### What Cloudflare Caches By Default

Cloudflare's default cache behavior is **extension-based**. If a URL matches a known static file extension, it is eligible for caching. If it doesn't, Cloudflare bypasses the cache by default.

**Default cacheable extensions (partial list):**

| Category | Extensions |
|----------|-----------|
| Images | `.jpg`, `.jpeg`, `.gif`, `.png`, `.webp`, `.svg`, `.ico`, `.bmp` |
| CSS/JS | `.css`, `.js`, `.mjs` |
| Fonts | `.woff`, `.woff2`, `.ttf`, `.eot`, `.otf` |
| Media | `.mp4`, `.webm`, `.mp3`, `.ogg`, `.mpeg` |
| Documents | `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx` |
| Archives | `.zip`, `.gz`, `.tar`, `.bz2` |
| Data | `.json`, `.xml`, `.rss`, `.atom` |
| Text | `.txt`, `.md`, `.csv` |

Full list: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/

### What Is NOT Cached By Default

Understanding what bypasses the cache is just as important:

1. **HTML files** (`.html`, `.htm`) — dynamic by assumption. Must opt in via Cache Rules.
2. **POST, PUT, PATCH, DELETE requests** — only GET and HEAD are cacheable
3. **Requests with `Authorization` header** — authenticated requests bypass cache
4. **Responses with `Set-Cookie` header** — Cloudflare won't cache to avoid serving one user's cookie to another
5. **Responses with `Cache-Control: no-store`** — explicit origin opt-out
6. **Responses with `Cache-Control: private`** — marked for single-user use only
7. **Responses returning 4xx/5xx status** (with some exceptions) — errors are not cached by default
8. **Query strings on dynamic paths** — varies by zone configuration

---

## Deep Dive (Architect-Level)

### The `cf-cache-status` Header

Every response from Cloudflare includes a `cf-cache-status` header. This is your primary debugging tool for cache behavior. Memorize every value.

#### HIT
```
cf-cache-status: HIT
```
The response was served **entirely from Cloudflare's cache**. The origin was not contacted. This is the ideal state for static assets. You'll also see `age: 3421` — the number of seconds the asset has been in cache.

#### MISS
```
cf-cache-status: MISS
```
The resource was **not in the cache**. Cloudflare fetched it from your origin and the response **is now being stored** in cache (if eligible). Next request from the same PoP should be a HIT.

#### EXPIRED
```
cf-cache-status: EXPIRED
```
The resource was in cache but its **TTL has elapsed**. Cloudflare fetched a fresh copy from origin and re-cached it. The old copy is gone.

#### STALE
```
cf-cache-status: STALE
```
The cache entry has expired, but Cloudflare served the **old (stale) copy** while asynchronously fetching a fresh one from origin. This requires `stale-while-revalidate` to be configured. Reduces perceived latency at the cost of brief staleness.

#### BYPASS
```
cf-cache-status: BYPASS
```
The request **bypassed the cache entirely**. Common causes:
- Origin sent `Cache-Control: no-cache` or `Cache-Control: private`
- Request had a `Cookie` header (depending on zone settings)
- A Cache Rule explicitly bypassed caching
- The request method was POST/PUT/DELETE

#### DYNAMIC
```
cf-cache-status: DYNAMIC
```
The resource is **not eligible for caching** based on Cloudflare's default rules (e.g., HTML without an explicit cache rule). No cache lookup was attempted. Different from BYPASS — DYNAMIC means "we decided not to try," whereas BYPASS means "we tried but skipped the cache."

#### REVALIDATED
```
cf-cache-status: REVALIDATED
```
Cloudflare sent a **conditional GET** to the origin (using `If-None-Match` or `If-Modified-Since`). The origin responded with `304 Not Modified`. The cached response is still valid and was served. Cache TTL is refreshed.

#### UPDATING
```
cf-cache-status: UPDATING
```
The cache entry is expired but Cloudflare is **currently fetching a fresh copy**. The current request is served the stale copy while the background fetch completes. Similar to STALE but indicates an in-flight update.

#### NONE / UNKNOWN
```
cf-cache-status: NONE/UNKNOWN
```
Cloudflare could not determine cache status. Rare — typically indicates an edge case or Cloudflare internal routing issue.

---

### Edge TTL vs Browser TTL

These are two distinct concepts that control **where** and **for how long** content is cached.

```
Browser → [Browser Cache (Browser TTL)] → Cloudflare Edge → [Edge Cache (Edge TTL)] → Origin
```

#### Browser TTL
- Controls how long the **user's browser** keeps the cached copy
- Set via `Cache-Control: max-age=` or `Expires` header
- After expiry, browser asks Cloudflare for a fresh copy
- Cloudflare Dashboard override: Caching → Configuration → Browser Cache TTL

#### Edge TTL (Cloudflare Cache)
- Controls how long **Cloudflare's edge nodes** keep the cached copy
- Set via `Cache-Control: s-maxage=` (takes priority over `max-age` for shared caches)
- Fallback to `max-age` if `s-maxage` absent
- Cloudflare minimum Edge TTL (Free plan): 2 hours for visited resources
- Enterprise can set TTL to 0 seconds (cache for one request only)

#### Practical Example

```http
Cache-Control: max-age=300, s-maxage=86400
```

This means:
- **Browsers** cache for 5 minutes (300 seconds)
- **Cloudflare** caches for 24 hours (86400 seconds)

This is a common pattern: short browser TTL for freshness, long edge TTL to protect origin.

---

### Cache-Control Directives Deep Dive

| Directive | Applies To | Meaning |
|-----------|-----------|---------|
| `no-store` | Both | Never cache anywhere, ever |
| `no-cache` | Both | Cache but revalidate before serving |
| `private` | Browsers only | Don't cache in shared caches (CDNs) |
| `public` | Shared caches | Can be cached even if response has Auth header |
| `max-age=N` | Browsers + CDN | Cache for N seconds (CDN uses if no s-maxage) |
| `s-maxage=N` | Shared caches only | CDN cache TTL; overrides max-age for CDNs |
| `stale-while-revalidate=N` | Both | Serve stale for N seconds while fetching fresh |
| `stale-if-error=N` | Both | Serve stale for N seconds if origin returns 5xx |
| `immutable` | Browsers | Don't revalidate even after max-age expires |
| `must-revalidate` | Both | Never serve stale; must revalidate when expired |

**Cloudflare-specific behavior:**
- Cloudflare **ignores** `no-cache` from browsers (it's for origin-to-cache communication)
- Cloudflare **respects** `no-cache` from origins
- `s-maxage` always takes precedence over `max-age` at the Cloudflare layer

---

### Cache Keys: What Makes a Request Unique

A **cache key** is how Cloudflare identifies whether two requests should share the same cached response. By default, the cache key is:

```
SCHEME + HOST + PATH + QUERY_STRING
```

So `https://macksportreport.com/news/article.html?utm_source=twitter` and `https://macksportreport.com/news/article.html?utm_source=facebook` are **different cache keys** and get **different cache entries**, even though the HTML would be identical.

**Cache key components you can customize:**
- Include/exclude specific query parameters
- Include/exclude specific request headers (e.g., `Accept-Language` for i18n)
- Include/exclude specific cookies
- Include device type (mobile vs desktop)
- Include geographic data (country-specific responses)

This is configured in Cache Rules → Cache Key section.

---

### Tiered Cache Topology

Without Tiered Cache, the architecture looks like this:

```
PoP London (MISS) ──────┐
PoP Tokyo (MISS)  ──────┼──→ Origin Server (gets slammed)
PoP NYC (MISS)    ──────┘
PoP LA (MISS)     ──────┘
```

All 330 PoPs independently make origin requests on a cold cache. For a viral article, this means hundreds of parallel origin fetches within seconds.

With Tiered Cache enabled:

```
PoP London (MISS) ──→ Upper Tier Frankfurt (HIT) ──→ Serves from tier
PoP Tokyo (MISS)  ──→ Upper Tier Tokyo (MISS)    ──→ Origin
PoP NYC (MISS)    ──→ Upper Tier Ashburn (HIT)   ──→ Serves from tier
```

Lower-tier PoPs consult an Upper Tier PoP before going to origin. The upper tier acts as a secondary cache layer. This dramatically reduces origin requests.

Cloudflare offers **Smart Tiered Cache Topology Optimization** (automatic) or manual upper tier selection (Enterprise).

---

## Dashboard Walkthrough

### Step 1: Access Caching Configuration
1. Log into Cloudflare Dashboard → https://dash.cloudflare.com
2. Select zone: **macksportreport.com**
3. Left sidebar → **Caching** → **Configuration**

### Step 2: Review Default Settings
- **Caching Level**: Standard (default) — query string aware caching
- **Browser Cache TTL**: "Respect Existing Headers" (recommended)
- **Always Online**: On/Off toggle for serving stale pages if origin is down
- **Development Mode**: When ON, bypasses cache for 3 hours — useful for testing

### Step 3: Tiered Cache Location
- Left sidebar → **Caching** → **Tiered Cache**
- Shows current topology status
- Toggle Smart Tiered Cache Topology on/off

### Step 4: Verify cf-cache-status via Analytics
- Left sidebar → **Analytics** → **Traffic**
- Look at "Requests by Cache Status" breakdown
- Goal: maximize HIT ratio (ideally 80%+ for static sites)

---

## Hands-On Lab

### Prerequisites
```bash
# Install httpie (optional, nicer output) or use curl
brew install httpie  # macOS

# Verify curl is available
curl --version
```

### Lab 1: Inspect Cache Headers on a Real Request

```bash
# Check cache status on a static asset
curl -sI https://macksportreport.com/favicon.ico | grep -i "cf-cache\|age\|cache-control\|expires"

# Expected output (first request = MISS):
# cf-cache-status: MISS
# cache-control: public, max-age=14400
# age: 0

# Run again immediately (should be HIT):
curl -sI https://macksportreport.com/favicon.ico | grep -i "cf-cache\|age\|cache-control"
# cf-cache-status: HIT
# age: 3
```

### Lab 2: Check All Headers at Once

```bash
# Full verbose header inspection
curl -sI https://macksportreport.com/favicon.ico

# Key headers to look for:
# cf-cache-status: HIT
# cf-ray: 7a1b2c3d4e5f6789-EWR  (identifies the PoP that served the request)
# age: 1234                      (seconds since cached)
# cache-control: ...             (origin's cache directives)
# expires: ...                   (legacy cache header)
# last-modified: ...             (used for conditional requests)
# etag: "abc123"                 (used for conditional requests)
```

### Lab 3: Verify What's Cached vs Dynamic

```bash
# Static asset — should eventually HIT
curl -sI https://macksportreport.com/assets/main.css | grep cf-cache-status

# HTML page — should be DYNAMIC by default (not cached)
curl -sI https://macksportreport.com/ | grep cf-cache-status

# Compare the two — notice DYNAMIC on HTML
```

### Lab 4: Test Cache-Control Behavior

```bash
# Inspect what cache-control headers your origin is sending
curl -sI https://macksportreport.com/assets/app.js \
  | grep -i "cache-control\|s-maxage\|max-age"

# Parse the TTL values
curl -sI https://macksportreport.com/assets/app.js \
  | grep -i "cache-control" \
  | grep -oP 'max-age=\d+'
```

### Lab 5: Simulate Different PoP Responses (via different IPs)

```bash
# Request from different geographic origins using --resolve
# This won't change the PoP but demonstrates the cf-ray header
curl -sI https://macksportreport.com/favicon.ico | grep cf-ray
# cf-ray: 7a1b2c3d-EWR  (EWR = Newark/New York PoP)

# The 3-letter code at the end of cf-ray identifies the PoP
# EWR = Newark, NJ
# LAX = Los Angeles
# LHR = London Heathrow
# NRT = Tokyo Narita
```

### Lab 6: Check Edge TTL vs Browser TTL

```bash
# Check what TTL Cloudflare is setting vs what origin sends
curl -sI https://macksportreport.com/assets/main.css \
  | grep -iE "cache-control|age|cf-cache-status|expires"

# Calculate remaining TTL:
# If cache-control: max-age=86400 and age: 3600, then 82800 seconds remain
```

### Lab 7: Use the Cloudflare API to Check Zone Cache Settings

```bash
export CF_ZONE_ID="your_zone_id_here"
export CF_API_TOKEN="your_api_token_here"

# Get zone settings (includes cache level, browser TTL, etc.)
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/settings/cache_level" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" | jq .

# Get browser TTL setting
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/settings/browser_cache_ttl" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" | jq .

# Expected response:
# {
#   "result": {
#     "id": "cache_level",
#     "value": "aggressive"
#   }
# }
```

### Lab 8: Modify Caching Level via API

```bash
# Set caching level to "aggressive" (ignores query strings for caching decisions)
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/settings/cache_level" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "aggressive"}' | jq .

# Options: "aggressive", "basic", "simplified"
# - aggressive: Query string ignored for caching
# - basic: Delivers different resources when query string present
# - simplified: Ignores query string entirely
```

---

## Demo Script (2 Minutes)

**Audience:** Customer CTO or VP Engineering
**Setup:** Browser DevTools open on macksportreport.com, terminal ready

---

**[0:00]** "Let me show you exactly how Cloudflare's cache is working for your site right now."

```bash
curl -sI https://macksportreport.com/favicon.ico | grep -i "cf-cache\|age"
```

**[0:15]** "See `cf-cache-status: HIT` — this response came from Cloudflare's edge in milliseconds. Your server never got this request."

**[0:30]** "Every response from Cloudflare tells you exactly what happened:"
- HIT = served from cache, origin zero load
- MISS = first request, now cached for next users
- BYPASS = we skipped the cache — usually means a config issue

**[0:50]** "The `age` header tells us this file has been cached for [X] seconds. If it's a big number, that means Cloudflare has been protecting your origin from thousands of requests for that asset."

**[1:10]** "Let's check an HTML page for comparison..."

```bash
curl -sI https://macksportreport.com/ | grep -i "cf-cache"
```

**[1:20]** "DYNAMIC — HTML isn't cached by default because Cloudflare assumes it might be personalized. But if you want to cache your homepage or blog posts, we can turn that on with one Cache Rule. That's Module 5.2."

**[1:45]** "Key takeaway: every static asset is already being served from cache. The big win left on the table is caching your HTML content — which we can do safely for most news/sports content like macksportreport.com."

---

## Competitive Context

| Feature | Cloudflare | AWS CloudFront | Fastly | Akamai |
|---------|-----------|----------------|--------|--------|
| Cache status header | `cf-cache-status` | `x-cache` | `x-cache` | `x-check-cacheable` |
| PoP count | 330+ | 450+ | 75+ | 4,100+ |
| Default cache extensions | 200+ | User-defined | User-defined | User-defined |
| HTML caching | Opt-in via rules | Always supported | Always supported | Always supported |
| Cache key customization | Cache Rules (free) | Lambda@Edge needed | Custom VCL | Complex config |
| stale-while-revalidate support | Yes | No (native) | Yes (VCL) | Yes |
| Minimum Edge TTL | Free: 2hr, Pro: configurable | Configurable | Configurable | Configurable |
| Browser TTL override | Dashboard | CloudFront policies | VCL | Config UI |
| Tiered caching | Yes (Tiered Cache) | Origin Shield ($$$) | Shielding | Tiered distribution |
| Developer experience | Dashboard + API | AWS Console | Fastly Console | Complex |

**Cloudflare differentiator:** The `cf-cache-status` header is more granular than competitors — STALE, REVALIDATED, UPDATING are states that AWS CloudFront doesn't expose natively. This is extremely useful for debugging cache behavior.

---

## Self-Check Questions

**Q1.** A user reports that after deploying a new JavaScript bundle, some users still see the old version. Which `cf-cache-status` value would you expect to see on requests for the old file, and what does it tell you?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q2.** Your origin server responds with `Cache-Control: max-age=300, s-maxage=86400`. How long will Cloudflare's edge cache this response? How long will browsers cache it? What would happen to the edge TTL if you removed `s-maxage`?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q3.** A request comes in for `https://macksportreport.com/news/article.html`. What `cf-cache-status` value do you expect with zero configuration changes, and why?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q4.** Explain the difference between `BYPASS` and `DYNAMIC`. When would you see each? Why does this distinction matter for debugging?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q5.** You're asked to prove that Cloudflare is actually reducing origin load. What metrics and headers would you check, and what does a "good" result look like?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

---

## Sources

- [Cloudflare Cache Concepts — Default Cache Behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- [cf-cache-status Header Values](https://developers.cloudflare.com/cache/concepts/cache-responses/)
- [Cache-Control Directives Reference](https://developers.cloudflare.com/cache/concepts/cache-control/)
- [Edge TTL and Browser TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/)
- [Cache Keys](https://developers.cloudflare.com/cache/concepts/cache-keys/)
- [Tiered Cache Overview](https://developers.cloudflare.com/cache/how-to/tiered-cache/)
- [Cloudflare API — Zone Settings](https://developers.cloudflare.com/api/resources/zones/subresources/settings/)
- [MDN — Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control)
