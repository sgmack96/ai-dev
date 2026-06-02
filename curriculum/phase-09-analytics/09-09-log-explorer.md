# Module 9.9 — Log Explorer
> Dashboard Location: macksportreport.com → Investigate → Log Explorer
> Estimated Time: 50 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Log Explorer is an interactive log querying tool built directly into the Cloudflare dashboard. It allows you to write SQL-like queries against your Cloudflare logs — HTTP requests, firewall events, Workers invocations — without needing to export logs to an external SIEM or data warehouse.

### The Problem Log Explorer Solves

Before Log Explorer, the investigation workflow was:
1. Configure Logpush to send logs to S3/R2/Splunk
2. Wait for logs to arrive
3. Query logs in the external tool
4. Cross-reference with Cloudflare dashboard data

This created a significant lag in incident investigation — setting up Logpush and waiting for external tool setup could take hours. Log Explorer collapses this to minutes, enabling ad-hoc investigation directly in the dashboard.

### What "SQL-Like" Means

Log Explorer uses a SQL syntax that is a subset of standard SQL, processed against log data stored in R2 (Cloudflare's object storage). You write familiar `SELECT`, `WHERE`, `GROUP BY`, `ORDER BY` queries. The underlying engine is ClickHouse-compatible.

**Simple query:**
```sql
SELECT datetime, clientIp, edgeResponseStatus, clientRequestPath
FROM http_requests
WHERE edgeResponseStatus >= 500
ORDER BY datetime DESC
LIMIT 100
```

**Aggregation query:**
```sql
SELECT 
  clientCountryName,
  count() AS request_count,
  countIf(edgeResponseStatus >= 400) AS error_count,
  round(countIf(edgeResponseStatus >= 400) * 100.0 / count(), 2) AS error_rate_pct
FROM http_requests
WHERE datetime >= now() - INTERVAL '1' HOUR
GROUP BY clientCountryName
ORDER BY request_count DESC
LIMIT 20
```

### Available Datasets

| Dataset | Contents | Use Cases |
|---------|---------|----------|
| **http_requests** | Every HTTP request through Cloudflare edge | Traffic analysis, error investigation, client behavior |
| **firewall_events** | WAF matches, rate limits, bot challenges | Security incident investigation, rule tuning |
| **workers_invocations** | Worker execution events | Worker debugging, error analysis |
| **zero_trust_access** | Cloudflare Access auth events | Auth investigation, access policy audit |
| **gateway_dns** | DNS Gateway queries | DNS filtering analysis |
| **email_events** | Email Security events | Spam/phishing investigation |

---

## Deep Dive (Architect-Level)

### HTTP Requests Dataset Schema

Key fields available in the `http_requests` dataset:

```sql
-- Core request/response fields
datetime                    -- TIMESTAMP: when the request was received
clientIp                    -- IP address of the client
clientCountryName           -- Country name (e.g., "United States")
clientRequestMethod         -- HTTP method (GET, POST, etc.)
clientRequestPath           -- URL path (no query string)
clientRequestQuery          -- Query string
clientRequestReferer        -- Referer header value
clientRequestUserAgent      -- User-agent string
clientRequestBytes          -- Request body size in bytes

-- Edge processing
edgeColoName                -- Cloudflare data center that handled request (e.g., "IAD")
edgeStartTimestamp          -- When CF edge received the request
edgeEndTimestamp            -- When CF edge sent the final response
edgeResponseStatus          -- HTTP status code returned to client
edgeResponseBytes           -- Response body size in bytes

-- Cache behavior
cacheCacheStatus            -- Cache status: HIT, MISS, BYPASS, EXPIRED, etc.
cacheResponseStatus         -- HTTP status from cache layer

-- Security
firewallMatchesActions      -- Array of security actions (block, challenge, etc.)
firewallMatchesRuleIDs      -- Array of matching rule IDs
firewallMatchesSources      -- Which security products matched (waf, bot, rateLimit)
wafMatchedVar               -- The specific variable that triggered WAF rule
botScoreSrcName             -- Source of bot score (Cloudflare, heuristics, etc.)
botScore                    -- Bot management score (1-99)

-- Performance
originResponseDurationMs    -- Time for origin to respond (ms)
originResponseStatus        -- HTTP status from origin
originIp                    -- Origin server IP address
```

### Common Investigation Queries

#### Find Top Blocked IPs in Last Hour

```sql
SELECT
  clientIp,
  count() AS block_count,
  any(clientCountryName) AS country,
  any(clientRequestPath) AS sample_path
FROM firewall_events
WHERE 
  datetime >= now() - INTERVAL '1' HOUR
  AND action = 'block'
GROUP BY clientIp
ORDER BY block_count DESC
LIMIT 20
```

#### Find 5xx Errors from a Specific Country

```sql
SELECT
  datetime,
  clientRequestPath,
  edgeResponseStatus,
  originResponseStatus,
  originResponseDurationMs,
  clientIp
FROM http_requests
WHERE
  datetime >= now() - INTERVAL '6' HOUR
  AND edgeResponseStatus >= 500
  AND clientCountryName = 'United States'
ORDER BY datetime DESC
LIMIT 100
```

#### Identify Bot Traffic Patterns

```sql
SELECT
  clientRequestUserAgent,
  count() AS requests,
  countIf(cacheCacheStatus = 'HIT') AS cache_hits,
  countIf(cacheCacheStatus = 'MISS') AS cache_misses,
  avg(botScore) AS avg_bot_score,
  any(clientIp) AS sample_ip
FROM http_requests
WHERE
  datetime >= now() - INTERVAL '24' HOUR
  AND botScore <= 30  -- Low bot score = likely bot
GROUP BY clientRequestUserAgent
ORDER BY requests DESC
LIMIT 20
```

#### Track Cache Hit Rate Over Time (for Custom Dashboard Widget)

```sql
SELECT
  toStartOfInterval(datetime, INTERVAL '1' HOUR) AS hour,
  count() AS total_requests,
  countIf(cacheCacheStatus = 'HIT') AS cache_hits,
  round(countIf(cacheCacheStatus = 'HIT') * 100.0 / count(), 1) AS hit_rate_pct,
  sum(edgeResponseBytes) AS bytes_served,
  sumIf(edgeResponseBytes, cacheCacheStatus = 'HIT') AS bytes_from_cache
FROM http_requests
WHERE datetime >= now() - INTERVAL '24' HOUR
GROUP BY hour
ORDER BY hour ASC
```

#### Find Paths with Highest Error Rates

```sql
SELECT
  clientRequestPath,
  count() AS total,
  countIf(edgeResponseStatus >= 400) AS errors,
  round(countIf(edgeResponseStatus >= 400) * 100.0 / count(), 2) AS error_rate_pct,
  max(edgeResponseStatus) AS max_status
FROM http_requests
WHERE
  datetime >= now() - INTERVAL '6' HOUR
  AND clientRequestMethod = 'GET'
GROUP BY clientRequestPath
HAVING count() > 100  -- only paths with meaningful volume
ORDER BY error_rate_pct DESC
LIMIT 20
```

### Log Storage Architecture

Log Explorer stores data in Cloudflare R2 (object storage). When you enable a dataset:

1. Cloudflare begins writing logs to an internal R2 bucket in your account
2. Logs are partitioned by time (hourly or daily buckets)
3. Log Explorer queries run against these R2 objects using a ClickHouse-compatible engine
4. You pay for storage based on how much data is retained

**Retention and Cost:**

| Plan | Default Retention | Max Retention |
|------|------------------|---------------|
| Free | 24-48 hours | 24-48 hours |
| Pro | 7 days | 7 days |
| Business | 30 days | 30 days |
| Enterprise | 30 days (default) | Configurable |
| Enterprise + Log Explorer | 90+ days | Configurable |

Storage cost: approximately **$0.10 per GB** stored per month (R2 pricing). For a medium-traffic site logging all HTTP requests, expect 5-50 GB/month depending on traffic volume and log format.

### Log Explorer vs Logpush

These are complementary tools, not alternatives:

| Feature | Log Explorer | Logpush |
|---------|-------------|--------|
| **Primary use** | Interactive investigation | Bulk export pipeline |
| **Interface** | Dashboard SQL editor | API/Dashboard config |
| **Query flexibility** | Ad-hoc SQL | Fixed fields export |
| **Retention** | Platform-managed | Your storage |
| **Latency** | ~1-2 minute delay | ~2-5 minute delay |
| **Volume handling** | Interactive (smaller windows) | Designed for TB-scale |
| **Destination** | Dashboard/Custom Dashboard | R2, S3, GCS, Splunk, Datadog, etc. |
| **Cost** | $0.10/GB stored | $0.50/M records + destination storage |

**When to use Log Explorer:** Incident investigation, ad-hoc queries, building dashboard widgets.
**When to use Logpush:** Long-term retention in your SIEM, feeding Datadog/Splunk, compliance archiving.

---

## Dashboard Walkthrough

### Step 1: Enable Log Storage

Before querying, you must enable log storage for a dataset:

1. macksportreport.com → Investigate → Log Explorer
2. Click **Configure datasets**
3. Enable **HTTP Requests** dataset
4. Set retention period (7 days on Pro, 30 days on Business)
5. Wait 15-30 minutes for initial log population

### Step 2: Run Your First Query

The Log Explorer shows a SQL editor with the active dataset selected.

Default query (auto-populated):
```sql
SELECT * FROM http_requests
WHERE datetime >= now() - INTERVAL '15' MINUTE
LIMIT 100
```

Click **Run** to execute. Results appear in a table below.

### Step 3: Filter by Status Code

Modify the query:
```sql
SELECT datetime, clientIp, clientRequestPath, edgeResponseStatus
FROM http_requests
WHERE 
  datetime >= now() - INTERVAL '1' HOUR
  AND edgeResponseStatus >= 400
ORDER BY datetime DESC
LIMIT 50
```

Run again. Now you see only error responses.

### Step 4: Add Aggregation

Switch to an aggregation view:
```sql
SELECT
  edgeResponseStatus,
  count() AS count
FROM http_requests
WHERE datetime >= now() - INTERVAL '1' HOUR
GROUP BY edgeResponseStatus
ORDER BY count DESC
```

This gives you a status code distribution — useful for seeing if 404s or 500s are elevated.

### Step 5: Save Query as Dashboard Widget

1. After running a query you want to persist:
2. Click **Add to Dashboard**
3. Select an existing Custom Dashboard or create a new one
4. Choose chart type (time series, bar, table)
5. The query will run on a refresh interval and persist as a widget

---

## Hands-On Lab

### Prerequisites

- Log storage enabled for `http_requests` dataset
- 1+ hours of log data accumulated
- macksportreport.com on Pro or higher plan

### Lab 1: Basic Investigation Queries

```sql
-- Query 1: What is the traffic volume in the last hour?
SELECT count() AS total_requests
FROM http_requests
WHERE datetime >= now() - INTERVAL '1' HOUR;

-- Query 2: What are the top 10 most requested paths?
SELECT
  clientRequestPath,
  count() AS requests
FROM http_requests
WHERE datetime >= now() - INTERVAL '1' HOUR
GROUP BY clientRequestPath
ORDER BY requests DESC
LIMIT 10;

-- Query 3: What countries sent the most traffic?
SELECT
  clientCountryName,
  count() AS requests,
  round(count() * 100.0 / (SELECT count() FROM http_requests WHERE datetime >= now() - INTERVAL '1' HOUR), 1) AS pct
FROM http_requests
WHERE datetime >= now() - INTERVAL '1' HOUR
GROUP BY clientCountryName
ORDER BY requests DESC
LIMIT 10;
```

### Lab 2: Error Investigation Queries

```sql
-- Find all 5xx errors in the last 6 hours
SELECT
  datetime,
  clientRequestPath,
  edgeResponseStatus,
  originResponseStatus,
  originIp,
  originResponseDurationMs
FROM http_requests
WHERE
  datetime >= now() - INTERVAL '6' HOUR
  AND edgeResponseStatus >= 500
ORDER BY datetime DESC
LIMIT 50;

-- Identify which origin paths are consistently slow
SELECT
  clientRequestPath,
  count() AS requests,
  avg(originResponseDurationMs) AS avg_origin_ms,
  max(originResponseDurationMs) AS max_origin_ms,
  quantile(0.95)(originResponseDurationMs) AS p95_origin_ms
FROM http_requests
WHERE
  datetime >= now() - INTERVAL '6' HOUR
  AND cacheCacheStatus != 'HIT'  -- Only uncached requests reach origin
GROUP BY clientRequestPath
HAVING count() > 10
ORDER BY p95_origin_ms DESC
LIMIT 20;
```

### Lab 3: Security Investigation Queries

```sql
-- Find IPs making suspicious numbers of requests (potential scanners/scrapers)
SELECT
  clientIp,
  clientCountryName,
  count() AS requests,
  count(DISTINCT clientRequestPath) AS unique_paths,
  countIf(edgeResponseStatus = 404) AS not_found_count
FROM http_requests
WHERE datetime >= now() - INTERVAL '1' HOUR
GROUP BY clientIp, clientCountryName
HAVING requests > 100
ORDER BY requests DESC
LIMIT 20;

-- Check for unusual user agents
SELECT
  clientRequestUserAgent,
  count() AS requests,
  count(DISTINCT clientIp) AS unique_ips
FROM http_requests
WHERE
  datetime >= now() - INTERVAL '24' HOUR
  AND (
    clientRequestUserAgent LIKE '%python%'
    OR clientRequestUserAgent LIKE '%curl%'
    OR clientRequestUserAgent LIKE '%scrapy%'
    OR clientRequestUserAgent LIKE '%bot%'
    OR clientRequestUserAgent = ''  -- empty user agent
  )
GROUP BY clientRequestUserAgent
ORDER BY requests DESC
LIMIT 20;
```

### Lab 4: Cache Analysis Query

```sql
-- Cache status distribution with bandwidth breakdown
SELECT
  cacheCacheStatus,
  count() AS requests,
  sum(edgeResponseBytes) AS bytes_served,
  round(count() * 100.0 / (SELECT count() FROM http_requests WHERE datetime >= now() - INTERVAL '24' HOUR), 1) AS pct_of_requests,
  round(sum(edgeResponseBytes) * 100.0 / (SELECT sum(edgeResponseBytes) FROM http_requests WHERE datetime >= now() - INTERVAL '24' HOUR), 1) AS pct_of_bandwidth
FROM http_requests
WHERE datetime >= now() - INTERVAL '24' HOUR
GROUP BY cacheCacheStatus
ORDER BY requests DESC;
```

### Lab 5: Build an Incident Investigation Workflow

```bash
# Scenario: Users are reporting slow page loads starting about 2 hours ago
# Step 1: Confirm the time window of the issue

# Run this in Log Explorer:
cat << 'EOF'
SELECT
  toStartOfInterval(datetime, INTERVAL '15' MINUTE) AS interval,
  avg(originResponseDurationMs) AS avg_origin_ms,
  quantile(0.95)(originResponseDurationMs) AS p95_origin_ms,
  count() AS requests,
  countIf(edgeResponseStatus >= 500) AS errors_5xx
FROM http_requests
WHERE datetime >= now() - INTERVAL '3' HOUR
GROUP BY interval
ORDER BY interval ASC
EOF
```

```bash
# Step 2: Identify the affected paths
cat << 'EOF'
SELECT
  clientRequestPath,
  avg(originResponseDurationMs) AS avg_ms,
  count() AS requests
FROM http_requests
WHERE
  datetime >= now() - INTERVAL '2' HOUR
  AND originResponseDurationMs > 1000  -- more than 1 second
  AND cacheCacheStatus != 'HIT'
GROUP BY clientRequestPath
ORDER BY count() DESC
LIMIT 20
EOF
```

---

## Demo Script (2 Minutes)

**Setup:** Log Explorer open in the dashboard with a query result showing HTTP requests.

---

"This is one of my favorite things to show customers who are used to dealing with Splunk or Datadog for log investigation — because it completely changes the reaction time during an incident.

[Type a query in the editor]

Let me write a quick query. I want to see every 5xx error in the last hour with the specific path and response time. Standard SQL — WHERE status >= 500, ORDER BY time descending.

[Click Run]

Results in about 2 seconds. I can immediately see that /api/checkout is generating 500 errors with 3+ second origin response times, but /api/products is fine. The problem is isolated to the checkout endpoint.

[Add a GROUP BY]

Now let me aggregate by path to see error rates. Which endpoints have the highest error rate? I add GROUP BY path, countIf for 500s divided by total count.

That's my error rate table. Checkout is at 23% error rate. Everything else is under 1%.

[Click 'Add to Dashboard']

Here's the key: I hit 'Add to Dashboard', and this exact query becomes a persistent widget in my engineering dashboard. Next time checkout has a problem, I see it immediately without having to remember how to write this query again.

No Splunk license. No CloudWatch configuration. No log agent deployment. SQL queries on your Cloudflare logs, right here, right now."

---

## Competitive Context

| Feature | Cloudflare Log Explorer | Splunk | Datadog Log Management | AWS CloudWatch Logs Insights |
|---------|------------------------|--------|----------------------|------------------------------|
| **Query language** | SQL (ClickHouse subset) | SPL | CATS/SQL | CloudWatch Insights QL |
| **Setup required** | Enable dataset (minutes) | Agent deployment + index | Agent + pipeline | CloudWatch agent |
| **Data freshness** | ~1-2 min | ~5-15 min | ~1-5 min | ~1-5 min |
| **Cloudflare data native** | Yes | Via Logpush | Via Logpush | Via Logpush |
| **Dashboard integration** | Yes (Custom Dashboards) | Yes (Splunk dashboards) | Yes (DD dashboards) | Limited |
| **Cost** | $0.10/GB storage | $$$$ | $$$ | $$ |
| **External data sources** | No (CF only) | Yes | Yes | AWS only |
| **Full text search** | Limited | Yes | Yes | Yes |
| **Alerting from queries** | Via Notifications | Yes | Yes | Yes |

**Cloudflare differentiator:** Log Explorer requires zero additional infrastructure. No agents, no pipelines, no separate SaaS billing. For teams that only need to investigate Cloudflare-level events (traffic, WAF, Workers), it eliminates the Logpush → external tool pipeline entirely. The trade-off: it only covers Cloudflare logs, not application logs from your origin servers.

---

## Self-Check Questions

**Question 1:** A customer's on-call engineer gets an alert at 3am that 5xx errors are elevated. Walk through the specific Log Explorer query they should write first to identify the affected endpoints and approximate start time.

```
Your answer:




```

---

**Question 2:** A customer currently uses Logpush to send HTTP request logs to S3, then queries them with Athena. Log Explorer now exists. Should they switch, and what are the tradeoffs?

```
Your answer:




```

---

**Question 3:** Write a Log Explorer SQL query to identify the top 10 IPs making the most requests to `/api/*` paths that are returning 429 (Too Many Requests) status codes, in the last 2 hours.

```sql
-- Your query here:




```

---

**Question 4:** A customer wants to keep 90 days of HTTP request logs for compliance purposes. They're on Business plan. What do they need to enable or upgrade, and what is the approximate monthly storage cost for a zone processing 500GB of traffic per month?

```
Your answer:




```

---

**Question 5:** Explain the difference between `firewall_events` and the `firewallMatchesActions` field within the `http_requests` dataset. When would you query each?

```
Your answer:




```

---

## Sources

- [Cloudflare Log Explorer Documentation](https://developers.cloudflare.com/logs/log-explorer/)
- [HTTP Requests Log Fields Reference](https://developers.cloudflare.com/logs/reference/log-fields/zone/http_requests/)
- [Firewall Events Log Fields](https://developers.cloudflare.com/logs/reference/log-fields/zone/firewall_events/)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [ClickHouse SQL Reference](https://clickhouse.com/docs/en/sql-reference)
- [Cloudflare Logs Overview](https://developers.cloudflare.com/logs/)
