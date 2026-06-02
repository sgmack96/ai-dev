# Module 9.1 — HTTP Traffic Analytics
> Dashboard Location: macksportreport.com → Analytics → HTTP Traffic
> Estimated Time: 45 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

HTTP Traffic Analytics is the primary traffic dashboard for any Cloudflare-proxied zone. Every request that passes through Cloudflare's edge is counted, categorized, and surfaced here. This is not sampled data on paid plans — it is derived from logs generated at the edge in real time.

### What Gets Counted

Cloudflare counts **every proxied request** — not just those that reach your origin. This means:

- Requests served from cache are counted
- Requests blocked by WAF are counted
- Requests challenged by bot management are counted
- Requests that never reach your origin (cache hits, rules blocks) still appear

This is meaningfully different from server-side analytics, which can only count requests that hit your origin. If your cache hit ratio is 85%, then server logs only show 15% of your actual traffic.

### Core Metrics

| Metric | Definition |
|--------|-----------|
| **Requests** | Total HTTP/S requests proxied through Cloudflare |
| **Cached Requests** | Requests served directly from Cloudflare edge cache |
| **Uncached Requests** | Requests that required a trip to your origin |
| **Bandwidth** | Total bytes served to end users |
| **Cached Bandwidth** | Bytes served from cache (bandwidth saved) |
| **Threats** | Requests blocked or challenged by Cloudflare security rules |
| **Pageviews** | Requests where the content-type is `text/html` |
| **Unique Visitors** | Unique IP+user-agent combinations in the selected time window |

### How Cloudflare Defines Pageviews

Cloudflare's definition of a **pageview** is operationally simple: any request returning a `Content-Type: text/html` response. This differs from Google Analytics, which requires JavaScript execution on the client. Cloudflare pageviews count all HTML requests including:

- Server-side rendered pages
- Crawlers requesting HTML
- Cached HTML responses

This means pageview counts will be higher than GA pageviews if you have significant bot traffic, and lower if users block JavaScript in GA.

### Unique Visitors

Cloudflare does not use cookies to track visitors. Unique visitors are counted based on unique IP address + user-agent string combinations within a time window. This is privacy-preserving by design, but has implications:

- Multiple users behind a NAT gateway count as one visitor
- The same user on mobile vs desktop counts as two visitors
- VPN users may appear as different visitors across sessions

---

## Deep Dive (Architect-Level)

### Adaptive Bit Rate (ABR) Sampling

On **Free plans**, HTTP traffic analytics uses **Adaptive Bit Rate (ABR) sampling**. High-traffic zones automatically sample requests rather than counting every one, to control storage and processing costs. Sampling rates are not fixed — they adapt to the volume of traffic:

- Low-traffic zones: near 100% sampling
- High-traffic zones: sampling rate may be 1% or lower

**Implication:** On free plans, the numbers you see are statistical estimates. For high-precision metrics, you need a paid plan with full-fidelity analytics or Logpush to stream raw logs.

On **Pro, Business, and Enterprise** plans, analytics are unsampled for most datasets. Enterprise plans also get extended data retention.

### GraphQL Analytics API

Every metric you see in the dashboard is queryable via the **Cloudflare Analytics GraphQL API**. This is a powerful capability for building custom reports, feeding internal dashboards, or automating capacity planning.

**Endpoint:**
```
https://api.cloudflare.com/client/v4/graphql
```

**Authentication:**
```
X-Auth-Email: your@email.com
X-Auth-Key: your-global-api-key
```
or
```
Authorization: Bearer your-api-token
```

**Real Query Example — HTTP Traffic by Hour for the Last 24 Hours:**

```graphql
{
  viewer {
    zones(filter: { zoneTag: "YOUR_ZONE_ID" }) {
      httpRequests1hGroups(
        limit: 25
        filter: {
          datetime_geq: "2026-06-01T00:00:00Z"
          datetime_leq: "2026-06-02T00:00:00Z"
        }
        orderBy: [datetime_ASC]
      ) {
        dimensions {
          datetime
        }
        sum {
          requests
          cachedRequests
          bytes
          cachedBytes
          threats
          pageViews
        }
        uniq {
          uniques
        }
      }
    }
  }
}
```

**Curl command:**
```bash
curl -s -X POST \
  -H "X-Auth-Email: your@email.com" \
  -H "X-Auth-Key: YOUR_GLOBAL_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "query": "{ viewer { zones(filter: { zoneTag: \"YOUR_ZONE_ID\" }) { httpRequests1hGroups(limit: 24, filter: { datetime_geq: \"2026-06-01T00:00:00Z\", datetime_leq: \"2026-06-02T00:00:00Z\" }, orderBy: [datetime_ASC]) { dimensions { datetime } sum { requests cachedRequests bytes cachedBytes threats pageViews } uniq { uniques } } } } }"
  }' \
  https://api.cloudflare.com/client/v4/graphql
```

### Breakdown Dimensions

The dashboard supports breaking down all metrics by multiple dimensions. Understanding what each dimension reveals:

| Dimension | What It Reveals |
|-----------|----------------|
| **Data Center** | Which Cloudflare PoPs are serving your traffic — useful for latency analysis |
| **Countries** | Geographic distribution of requests — useful for CDN placement and regulations |
| **IPv6 vs IPv4** | Protocol adoption rate among your users |
| **HTTP Protocol Version** | HTTP/1.1 vs HTTP/2 vs HTTP/3 (QUIC) adoption |
| **Content Type** | What resources are being requested (HTML, JS, CSS, images, etc.) |
| **SSL/TLS Version** | TLS 1.2 vs 1.3 adoption — security compliance signal |
| **Browser** | User-agent browser distribution |
| **OS** | Operating system distribution |
| **Device Type** | Desktop vs Mobile vs Tablet |

### Time Series Spike Analysis

HTTP traffic spikes appear as vertical jumps in the time series chart. Diagnostic approach:

1. **Normal traffic spike** — correlates with marketing campaign, time-of-day, or known event
2. **Bot/scraper attack** — spike in requests but flat in pageviews; threats counter may increase
3. **DDoS attempt** — spike with high threat count; often blocked before reaching origin
4. **Cache invalidation event** — spike in uncached requests following a cache purge
5. **Crawler indexing** — elevated requests from a small number of IPs, mostly HTML

### Comparing Time Periods

Use the **Compare** toggle in the dashboard to overlay two time periods. This is useful for:

- Week-over-week traffic growth analysis
- Comparing traffic before/after a configuration change
- Identifying seasonal traffic patterns

---

## Dashboard Walkthrough

### Step 1: Navigate to HTTP Traffic Analytics

1. Log in to dash.cloudflare.com
2. Select your account → select zone `macksportreport.com`
3. Click **Analytics** in the left nav
4. Select **Traffic** (may show as HTTP Traffic)

### Step 2: Set the Time Range

The default is **Last 24 hours**. Options available:

- Last 30 minutes
- Last 6 hours
- Last 24 hours
- Last 7 days
- Last 30 days
- Custom range (Enterprise)

Select **Last 7 days** for this walkthrough.

### Step 3: Read the Summary Cards

At the top of the page, you'll see six summary cards:
- **Requests** — total number with a delta vs previous period
- **Cached** — % of requests served from cache
- **Bandwidth** — total GB/TB served
- **Bandwidth Saved** — GB/TB not sent from origin
- **Threats** — unique threat events blocked or challenged
- **Pageviews** — HTML-typed requests

### Step 4: Examine the Time Series Chart

The main chart shows requests over time. Look for:

- Consistent daily traffic patterns (weekday vs weekend)
- Any anomalous spikes
- The split between cached (green) and uncached (blue) bands

### Step 5: Explore Breakdown Dimensions

Scroll down to see tables breaking down traffic by:
- Top countries
- Top data centers
- Device type distribution
- Content type distribution

Click any row to filter the entire dashboard to that dimension value.

---

## Hands-On Lab

### Prerequisites

- Cloudflare account with `macksportreport.com` on any plan
- API token with `Zone:Analytics:Read` permission
- `curl` and `jq` installed

### Lab 1: Pull 24-Hour Summary via API

```bash
# Set your credentials
export CF_EMAIL="your@email.com"
export CF_API_KEY="your-global-api-key"
export ZONE_ID="your-zone-id"

# Get zone ID if you don't have it
curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=macksportreport.com" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" | jq '.result[0].id'
```

```bash
# Pull last 24 hours of hourly traffic data
curl -s -X POST \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"{ viewer { zones(filter: { zoneTag: \\\"$ZONE_ID\\\" }) { httpRequests1hGroups(limit: 24, filter: { datetime_geq: \\\"$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)\\\", datetime_leq: \\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\\" }, orderBy: [datetime_ASC]) { dimensions { datetime } sum { requests cachedRequests bytes cachedBytes threats pageViews } uniq { uniques } } } } }\"
  }" \
  https://api.cloudflare.com/client/v4/graphql | jq '.data.viewer.zones[0].httpRequests1hGroups'
```

### Lab 2: Calculate Cache Hit Ratio

```bash
# Store the response and calculate cache hit ratio
RESPONSE=$(curl -s -X POST \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"{ viewer { zones(filter: { zoneTag: \\\"$ZONE_ID\\\" }) { httpRequests1dGroups(limit: 7, filter: { date_geq: \\\"$(date -u -v-7d +%Y-%m-%d)\\\", date_leq: \\\"$(date -u +%Y-%m-%d)\\\" }, orderBy: [date_ASC]) { dimensions { date } sum { requests cachedRequests bytes cachedBytes } } } } }\"
  }" \
  https://api.cloudflare.com/client/v4/graphql)

echo $RESPONSE | jq '.data.viewer.zones[0].httpRequests1dGroups[] | {
  date: .dimensions.date,
  total_requests: .sum.requests,
  cached_requests: .sum.cachedRequests,
  cache_hit_ratio: ((.sum.cachedRequests / .sum.requests) * 100 | round | tostring + "%"),
  bandwidth_gb: (.sum.bytes / 1073741824 | round),
  cached_bandwidth_gb: (.sum.cachedBytes / 1073741824 | round)
}'
```

### Lab 3: Identify Top Threats by Country

```bash
# Pull firewall events by country
curl -s -X POST \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"{ viewer { zones(filter: { zoneTag: \\\"$ZONE_ID\\\" }) { firewallEventsAdaptive(limit: 10, filter: { datetime_geq: \\\"$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)\\\" }, orderBy: [count_DESC]) { dimensions { clientCountryName action } count } } } }\"
  }" \
  https://api.cloudflare.com/client/v4/graphql | jq '.data.viewer.zones[0].firewallEventsAdaptive'
```

### Lab 4: Dashboard Navigation Exercise

1. Open macksportreport.com → Analytics → Traffic in the dashboard
2. Set time range to **Last 7 days**
3. Enable **Compare** to the previous 7-day period
4. Note the delta on requests and bandwidth cards
5. Click on **Countries** tab and identify the top 3 source countries
6. Click on **Data Centers** tab and identify which Cloudflare PoP serves the most traffic
7. Filter by **Mobile** device type and note how traffic distribution changes

---

## Demo Script (2 Minutes)

**Setup:** Have macksportreport.com → Analytics → Traffic open on screen, set to Last 7 days.

---

"Let me show you something most analytics tools can't — traffic data that includes everything, even requests your server never saw.

[Point to summary cards]

See this number here — 847,000 requests this week. But look at this: 72% of those were served from Cloudflare's cache. Your origin only handled 28% of this traffic. That means your servers handled about 237,000 requests instead of 847,000. That's real cost savings.

[Point to threats card]

And this — 3,400 threats blocked this week. These are requests that never touched your servers. SQL injection attempts, credential stuffing attacks, known bad IPs — Cloudflare stopped them at the edge.

[Click on Countries breakdown]

Here's the geographic breakdown. 68% from the US, 12% from UK, the rest distributed. This matters if you're planning capacity or thinking about regulatory requirements.

[Click on Content Type]

Now look at this — images represent 64% of bandwidth but only 12% of requests. That one stat tells your engineering team where to focus performance work.

The key insight: your server metrics only show 28% of the story. This dashboard shows everything."

---

## Competitive Context

| Feature | Cloudflare Analytics | AWS CloudFront Metrics | Fastly Real-time Analytics |
|---------|---------------------|----------------------|---------------------------|
| **Data freshness** | ~1 minute delay | 1-10 minute delay | Near real-time |
| **Edge-layer coverage** | Full (blocked requests included) | Full | Full |
| **Sampling** | None on paid plans | None | None |
| **Breakdown dimensions** | 10+ dimensions | Limited | Limited |
| **GraphQL API** | Yes, full-featured | No (CloudWatch only) | Yes |
| **Cache hit ratio** | Shown natively | Requires separate metric | Shown natively |
| **Threat visibility** | Integrated with security | Separate WAF console | Separate security module |
| **Historical retention** | 30 days (Pro), longer Enterprise | Configurable (cost) | 30 days |
| **Cost** | Included in plan | Per API request to CloudWatch | Included |

**Key differentiator:** Cloudflare is the only major CDN where security analytics (WAF blocks, bot management) and performance analytics (cache hit ratio, bandwidth) are in the same unified view. AWS requires switching between CloudFront, WAF, and CloudWatch.

---

## Self-Check Questions

**Question 1:** A customer sees their Cloudflare dashboard shows 1 million requests last week, but their Nginx access logs only show 200,000 requests. Is this a data discrepancy or expected behavior? Explain why.

```
Your answer:




```

---

**Question 2:** A customer on the Free plan says their traffic numbers seem inconsistent — sometimes they see round numbers that seem too perfect. What is the technical explanation, and what plan upgrade would resolve this?

```
Your answer:




```

---

**Question 3:** You are asked to identify whether a traffic spike at 2pm yesterday was from legitimate users or a bot attack. Walk through the specific steps you would take using the HTTP Traffic Analytics dashboard.

```
Your answer:




```

---

**Question 4:** A customer wants to pull HTTP traffic data into their internal BI tool (Tableau/Looker). What is the technical approach, and what authentication method should they use?

```
Your answer:




```

---

**Question 5:** How does Cloudflare define a "pageview" in HTTP Traffic Analytics, and in what situations would this differ significantly from pageview counts in Google Analytics for the same site?

```
Your answer:




```

---

## Sources

- [Cloudflare Analytics Documentation](https://developers.cloudflare.com/analytics/)
- [Cloudflare Analytics GraphQL API](https://developers.cloudflare.com/analytics/graphql-api/)
- [GraphQL Schema Explorer](https://developers.cloudflare.com/analytics/graphql-api/schema-viewer/)
- [Adaptive Bit Rate Sampling](https://developers.cloudflare.com/analytics/graphql-api/sampling/)
- [HTTP Requests Dataset Fields](https://developers.cloudflare.com/logs/reference/log-fields/zone/http_requests/)
- [Zone Analytics API](https://developers.cloudflare.com/api/operations/zone-analytics-get-analytics-dashboard)
