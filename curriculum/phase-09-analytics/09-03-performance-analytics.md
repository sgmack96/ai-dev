# Module 9.3 — Performance Analytics
> Dashboard Location: macksportreport.com → Analytics → Performance
> Estimated Time: 35 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Performance Analytics focuses on **how fast** your site is being served, not just how much traffic you're receiving. While HTTP Traffic Analytics answers "how many requests?", Performance Analytics answers "how quickly were those requests served, and how much of your origin's work did Cloudflare absorb?"

### The Two Performance Levers Cloudflare Controls

Cloudflare affects performance in two ways:

1. **Edge caching** — serving content from Cloudflare's 330+ data centers without reaching your origin
2. **Network optimization** — routing requests over Cloudflare's private backbone (Argo Smart Routing), protocol optimizations (HTTP/2, HTTP/3, 0-RTT TLS)

Performance Analytics surfaces metrics for both.

### Core Performance Metrics

| Metric | What It Measures | Why It Matters |
|--------|-----------------|----------------|
| **Origin Response Time** | Time for Cloudflare edge to receive a response from your origin (TTFB at origin) | Measures your server performance independent of user location |
| **Cache Hit Rate** | % of requests served from Cloudflare edge without hitting origin | Direct measure of CDN effectiveness |
| **Bandwidth Saved** | GB/TB not transferred from origin to CF edge due to caching | Reduces origin egress costs |
| **Content Type Breakdown** | Cache hit rate and response times per MIME type | Identifies specific content types that aren't caching |

### Origin Response Time vs User-Perceived Latency

A critical distinction for SEs:

- **Origin response time** = time from when Cloudflare forwards the request to origin → to when origin returns the first byte. This measures your server/app performance.
- **User-perceived latency** = time from user's browser → Cloudflare edge + Cloudflare edge → origin (for cache misses). This includes network distance from user to the nearest Cloudflare PoP.

Cloudflare controls the second half (edge to user) primarily through cache hit rate. Higher cache hit rate means more users get served from the geographically closest PoP with zero origin latency.

### TTFB: Edge vs Origin

**Edge TTFB** (what users experience for cache hits):
- Time from user's TCP connection to CF edge → CF sends first byte back
- For cache hits: single-digit milliseconds
- This is what matters for user experience

**Origin TTFB** (what Performance Analytics measures):
- Time from CF edge forwarding the request → origin sends first byte
- For dynamic content: 10ms to several seconds depending on your app
- This is what you optimize at the application layer

Performance Analytics shows origin TTFB, not edge TTFB. To optimize edge TTFB, you increase cache hit rate.

---

## Deep Dive (Architect-Level)

### Cache Hit Rate by Content Type

The most actionable view in Performance Analytics is **cache hit rate broken down by content type**. This reveals optimization opportunities:

**Typical content type cache behavior:**

| Content Type | Expected Cache Rate | Common Issue If Low |
|-------------|--------------------|--------------------|
| `image/jpeg`, `image/png`, `image/webp` | 85-98% | Cache-Control headers missing or short TTL |
| `text/css` | 85-95% | Cache-Control headers with short TTL |
| `application/javascript` | 85-95% | Cache-Control headers with short TTL |
| `text/html` | 20-40% (dynamic pages) | Expected — HTML is usually dynamic |
| `application/json` (APIs) | 5-30% | APIs often set no-cache |
| `application/pdf`, downloads | 90-99% | Should be high; investigate if low |

If your `image/jpeg` cache hit rate is below 70%, something is wrong:
- Missing `Cache-Control: public, max-age=XXXX` headers from origin
- Origin setting `Cache-Control: no-cache, no-store`
- Cloudflare Page Rule or Cache Rule forcing bypass for these paths

### How Cloudflare Caches Content

Cloudflare's caching decision hierarchy (simplified):

1. Is there a **Cache Rule** or **Page Rule** overriding cache behavior? → Follow that
2. Does the request include **Authorization** or **Cookie** headers? → Bypass cache by default (configurable)
3. Does the response have `Cache-Control: no-store`? → Don't cache
4. Does the response have `Cache-Control: private`? → Don't cache
5. Does the response have a positive `max-age` or `s-maxage`? → Cache for that duration
6. Is the content type in Cloudflare's default cacheable list? → Cache with default TTL (static assets)
7. Otherwise → bypass cache

Static file extensions that Cloudflare caches by default: `.jpg`, `.jpeg`, `.gif`, `.png`, `.bmp`, `.svg`, `.webp`, `.css`, `.js`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`, `.pdf`, `.zip`, etc.

### Interpreting Origin Response Time Charts

The origin response time time series shows percentiles (P50, P75, P95, P99). Reading these:

- **P50 = 120ms** → Half of all uncached requests are processed by origin in under 120ms
- **P95 = 850ms** → 5% of requests take longer than 850ms (these are your slow outliers)
- **P99 = 2,400ms** → 1% of requests take over 2.4 seconds (potential timeouts)

Spikes in P95/P99 while P50 stays flat indicate **intermittent slow requests** — a classic symptom of:
- Database query variability (slow queries under load)
- GC pauses in JVM/Node.js
- External API dependency timeouts
- Memory pressure causing swap usage

### Bandwidth Savings Calculation

```
Bandwidth Saved = (Total Bandwidth) × (Cache Hit Rate as decimal)

Example:
Total Bandwidth:  500 GB
Cache Hit Rate:   72%
Bandwidth Saved:  500 × 0.72 = 360 GB (from Cloudflare PoPs)
Origin Egress:    500 × 0.28 = 140 GB (from origin to CF)

Monthly Origin Egress Cost (AWS us-east-1):
  140 GB × $0.09/GB = $12.60/month saved from Cloudflare caching alone
```

At scale, this becomes significant:
- 1 TB/month total bandwidth at 72% hit rate = 720 GB saved = $64.80/month in AWS egress alone
- Enterprise zones with 10TB/month = $648/month in egress savings

### Performance Analytics and Argo Smart Routing

Argo Smart Routing ($0.10/GB) improves **origin response time** by routing traffic over Cloudflare's private backbone rather than the public internet. Performance Analytics lets you measure the before/after effect:

1. Enable Argo on macksportreport.com
2. Watch the origin response time P50/P95 metrics in Performance Analytics
3. Argo typically reduces origin TTFB by 30-50% for geographically distributed origins

---

## Dashboard Walkthrough

### Step 1: Navigate to Performance Analytics

1. macksportreport.com → Analytics → Performance
2. Set time range to **Last 7 days**

### Step 2: Read the Bandwidth Saved Card

The top card shows total bandwidth served and the % saved by caching. This is the headline ROI number for CDN value.

**How to interpret:**
- < 50% saved: significant caching opportunity; review Cache-Control headers
- 50-70% saved: average; likely HTML pages not caching, static assets mostly cached
- 70-90% saved: good caching configuration
- > 90% saved: excellent; mostly static content or aggressive edge caching

### Step 3: Origin Response Time Chart

The time series shows origin response times at multiple percentiles. Look for:
- Consistent baseline (P50 around 50-200ms for most web apps)
- Spikes in P95/P99 — are these correlated with traffic spikes?
- Night/weekend dip in response times — indicates load-related slowness during peak hours

### Step 4: Cache Hit Rate by Content Type

This table is the most actionable view. For each content type:
1. Note the request volume (weight the importance of optimization)
2. Note the cache hit rate
3. Flag any content type with unexpectedly low hit rate

### Step 5: Optimization Opportunity Identification

Create a priority list:
1. Highest volume content type with lowest cache hit rate = highest ROI fix
2. Document the current `Cache-Control` header being set by origin for that content type
3. Propose a Cache Rule to override if origin can't be changed

---

## Hands-On Lab

### Prerequisites

- macksportreport.com proxied through Cloudflare
- `curl` and `jq` installed

### Lab 1: Check Cache Status for a Request

```bash
# The cf-cache-status header tells you what happened with the cache
curl -s -I https://macksportreport.com/ | grep -i "cf-cache-status"

# Possible values:
# HIT        - served from cache
# MISS       - not in cache, fetched from origin
# EXPIRED    - was cached but expired, fetched from origin
# STALE      - stale content served (while revalidating)
# BYPASS     - cache bypassed (Cookie/Auth header, or cache rule)
# DYNAMIC    - content marked as dynamic (not eligible for caching)
# REVALIDATED - revalidated with origin (304 Not Modified)
# UPDATING   - served stale while background update happens
```

### Lab 2: Check Cache-Control Headers on Key Resources

```bash
# Check HTML page
echo "=== HTML Page ===" 
curl -s -I https://macksportreport.com/ | grep -i "cache-control"

# Check a CSS file (adjust path as needed)
echo "=== CSS ==="
curl -s -I https://macksportreport.com/styles.css 2>/dev/null | grep -i "cache-control" || echo "No CSS found at /styles.css"

# Check an image (adjust path as needed)
echo "=== Image ==="
curl -s -I https://macksportreport.com/favicon.ico | grep -i "cache-control"

# Check CF cache status for each
echo ""
echo "=== Cache Status Check ==="
for path in "/" "/favicon.ico" "/robots.txt"; do
  STATUS=$(curl -s -I "https://macksportreport.com${path}" | grep -i "cf-cache-status" | awk '{print $2}')
  echo "Path: $path → cf-cache-status: $STATUS"
done
```

### Lab 3: Warm the Cache and Measure Hit Rate

```bash
# First request (should be MISS)
echo "First request:"
curl -s -I https://macksportreport.com/favicon.ico | grep -i "cf-cache-status"

# Wait a second, then request again (should be HIT)
sleep 2
echo "Second request (should be HIT):"
curl -s -I https://macksportreport.com/favicon.ico | grep -i "cf-cache-status"
```

### Lab 4: Query Origin Response Time via GraphQL

```bash
export CF_EMAIL="your@email.com"
export CF_API_KEY="your-api-key"
export ZONE_ID="your-zone-id"

# Get origin response time percentiles for the last 24 hours
curl -s -X POST \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"{ viewer { zones(filter: { zoneTag: \\\"$ZONE_ID\\\" }) { httpRequestsAdaptiveGroups( limit: 24, filter: { datetime_geq: \\\"$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)\\\", cacheStatus_neq: \\\"hit\\\" }, orderBy: [datetime_ASC] ) { dimensions { datetime } avg { originResponseDurationMs } quantiles { originResponseDurationMsP50 originResponseDurationMsP75 originResponseDurationMsP95 originResponseDurationMsP99 } } } } }\"
  }" \
  https://api.cloudflare.com/client/v4/graphql | jq '.data.viewer.zones[0].httpRequestsAdaptiveGroups[]' 2>/dev/null || echo "Check your credentials and zone ID"
```

### Lab 5: Identify Low Cache Hit Rate Content Types

```bash
# Query cache hit rate broken down by content type
curl -s -X POST \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"{ viewer { zones(filter: { zoneTag: \\\"$ZONE_ID\\\" }) { httpRequestsAdaptiveGroups( limit: 20, filter: { datetime_geq: \\\"$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)\\\" }, orderBy: [count_DESC] ) { dimensions { clientRequestHTTPMethodName cacheStatus } count } } } }\"
  }" \
  https://api.cloudflare.com/client/v4/graphql | jq '.'
```

---

## Demo Script (2 Minutes)

**Setup:** Have Performance Analytics open on macksportreport.com, bandwidth saved card visible.

---

"Performance analytics is where I like to start with new customers because it tells an immediate ROI story.

[Point to bandwidth saved number]

See this number — 68% of bandwidth served from Cloudflare's cache. That means only 32% of requests actually reached the customer's origin servers. For a site serving 500GB a month, that's 340GB of AWS egress that doesn't happen. At AWS's $0.09/GB outbound pricing, that's about $30 a month just in egress savings — before you even count the compute savings on the origin servers.

[Click on content type breakdown]

Here's where the interesting part is. Images: 91% cache hit rate — excellent. CSS and JS: 88% — good. But look at this row: PDF downloads at only 23% cache hit rate. PDFs are completely static, they should be near 100%. That tells me the origin is either setting no-cache headers on those PDFs, or there are query string variations preventing cache consolidation.

[Click through to show origin response time]

And this is origin response time. P50 is 85ms — that's reasonable. But P95 jumps to 890ms, and P99 is 2.1 seconds. There's something happening on 5% of requests that's significantly slower than average. That's usually a database query or external API call. The cache is masking this for 68% of users — but for the 32% hitting origin, 1 in 20 is getting a slow experience.

That's your next engineering sprint, right there in the data."

---

## Competitive Context

| Feature | Cloudflare Performance Analytics | Fastly Real-Time Analytics | AWS CloudFront Metrics |
|---------|----------------------------------|---------------------------|------------------------|
| **Origin response time** | Yes, with percentiles | Yes | Yes (latency metric) |
| **Cache hit rate by content type** | Yes | Yes | Yes |
| **Bandwidth saved tracking** | Yes | Yes | Yes |
| **P95/P99 percentiles** | Yes | Yes | Limited (avg, p50 only) |
| **TTFB edge vs origin split** | Yes | Yes | No |
| **Real-time (< 1 min delay)** | Yes | Yes | 5-10 min delay |
| **Native integration with security** | Yes (same dashboard) | No (separate) | No (separate WAF console) |
| **Argo optimization measurement** | Yes | No equivalent | No |
| **Free tier access** | Yes | Enterprise only | Limited |

---

## Self-Check Questions

**Question 1:** A customer's Performance Analytics shows a cache hit rate of 45%. After investigation, you find images have a 90% hit rate but HTML pages have a 10% hit rate. Is this a problem that needs fixing? What would cause HTML to have such a low hit rate?

```
Your answer:




```

---

**Question 2:** A customer's origin response time chart shows P50 = 95ms and P99 = 3,200ms. What does this pattern indicate about their application, and what are two likely causes?

```
Your answer:




```

---

**Question 3:** Walk through the calculation: if macksportreport.com serves 1TB of traffic per month and has a 65% cache hit rate, how much is it saving in AWS us-east-1 egress costs? (Use $0.09/GB)

```
Your answer:




```

---

**Question 4:** A new customer has never used a CDN before. Their origin response time is consistently 800ms P50. After deploying Cloudflare with good caching, what would you expect to happen to their end-user-perceived TTFB, and why?

```
Your answer:




```

---

**Question 5:** Explain the difference between "bandwidth saved" in Performance Analytics and "cached bandwidth" in HTTP Traffic Analytics. Are they the same metric?

```
Your answer:




```

---

## Sources

- [Cloudflare Cache Documentation](https://developers.cloudflare.com/cache/)
- [Cache Hit Ratio — Understanding and Improving](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- [Default Cache Behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/#default-cached-file-extensions)
- [Argo Smart Routing](https://developers.cloudflare.com/argo-smart-routing/)
- [Understanding Cache-Control Headers](https://developers.cloudflare.com/cache/concepts/cache-control/)
- [Analytics GraphQL API — Performance Datasets](https://developers.cloudflare.com/analytics/graphql-api/features/data-sets/)
