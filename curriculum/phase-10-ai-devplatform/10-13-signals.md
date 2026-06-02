# Module 10.13 — Workers Analytics Engine (Signals)
> Dashboard Location: Account Home → Analytics → Analytics Engine | Estimated Time: 60 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Workers Analytics Engine is Cloudflare's time-series database for custom metrics. It lets you write arbitrary data points from any Worker and query them via SQL — building a custom analytics layer without standing up InfluxDB, TimescaleDB, or sending data to Amplitude.

**The problem it solves:** Workers have built-in metrics for requests, CPU time, and errors. But what if you want to track:
- Which sports categories users click most
- Revenue per checkout funnel step
- Error rates broken down by user plan (free vs paid)
- A/B test conversion rates by variant
- API endpoint latency by customer ID

None of these are in the default Cloudflare analytics. You'd normally ship this data to an external system (Datadog, Amplitude, Mixpanel). Analytics Engine lets you write it from your Worker directly, query it with SQL, and pay Cloudflare instead of a $2,000/month SaaS tool.

**Data model — three field types:**

| Field Type | Name | Description | Example |
|---|---|---|---|
| **blobs** | Up to 10 text labels | Categorical dimensions for filtering/grouping | "payment", "stripe", "success" |
| **doubles** | Up to 20 numbers | Numeric measurements for aggregation | response time in ms, amount in cents |
| **indexes** | 1 text field | Primary filter dimension (fast filtering) | customer ID, user ID, zone ID |

**Sampling:** Analytics Engine uses adaptive sampling for high-volume workloads. At low volume, it records 100% of data points. At high volume, it samples and adjusts query results to account for the sampling rate. The `_sample_interval` column in query results tells you the sampling factor.

---

## Deep Dive (Architect-Level)

### Writing Data Points

```typescript
interface Env {
  MY_DATASET: AnalyticsEngineDataset;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const start = Date.now();
    const url = new URL(request.url);

    // ... handle request ...
    const response = await handleRequest(request);

    const latencyMs = Date.now() - start;
    const statusCode = response.status;

    // Write analytics data point
    env.MY_DATASET.writeDataPoint({
      // Up to 10 text dimensions
      blobs: [
        url.pathname,                                    // blob1: route
        request.method,                                  // blob2: HTTP method
        statusCode >= 400 ? 'error' : 'success',        // blob3: outcome
        request.cf?.country as string || 'unknown',     // blob4: country
      ],
      // Up to 20 numeric measurements
      doubles: [
        latencyMs,                                       // double1: response time
        statusCode,                                      // double2: status code
        parseInt(response.headers.get('content-length') || '0'), // double3: response size
      ],
      // 1 primary index for fast filtering
      indexes: [
        request.headers.get('cf-ipcountry') || 'unknown', // or: customer ID
      ],
    });

    return response;
  }
} satisfies ExportedHandler<Env>;
```

### Querying with SQL API

Analytics Engine exposes a REST endpoint that accepts SQL:

```
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql
Authorization: Bearer {token}
Content-Type: text/plain

SELECT
  blob1 as route,
  blob3 as outcome,
  COUNT() as request_count,
  AVG(double1) as avg_latency_ms,
  SUM(double1 * _sample_interval) / SUM(_sample_interval) as weighted_avg_latency
FROM MY_DATASET
WHERE timestamp >= NOW() - INTERVAL '1' HOUR
  AND index1 = 'US'
GROUP BY blob1, blob3
ORDER BY request_count DESC
LIMIT 20
```

**Important SQL quirk:** Because of sampling, use `SUM(metric * _sample_interval) / SUM(_sample_interval)` for weighted averages, not plain `AVG()`. `COUNT()` must also account for sampling: use `SUM(_sample_interval)` for estimated true count.

### Data Retention

- **Raw data:** 31 days
- **Aggregated summaries:** Cloudflare does not yet offer longer-term aggregate retention (unlike InfluxDB downsampling)
- For long-term trends: export via API and store in R2 or D1

### Schema Design Best Practices

Map your data model to blobs/doubles intentionally:

```typescript
// Good schema design for an e-commerce Worker
env.ORDERS.writeDataPoint({
  blobs: [
    order.status,           // blob1: pending/paid/failed/refunded
    order.paymentMethod,    // blob2: card/paypal/crypto
    order.plan,             // blob3: free/pro/enterprise
    order.region,           // blob4: us/eu/apac
  ],
  doubles: [
    order.amountCents,      // double1: order value
    order.itemCount,        // double2: items in cart
    checkoutDurationMs,     // double3: time to complete checkout
    isFirstOrder ? 1 : 0,   // double4: new vs repeat customer flag
  ],
  indexes: [order.customerId], // Fast filter by customer
});
```

---

## Dashboard Walkthrough

**Note:** Analytics Engine queries are primarily via the API. The dashboard provides basic overview but the full power is via SQL queries.

**Step 1: Find Analytics Engine**
1. Account Home → Analytics → Analytics Engine
2. View your datasets (created automatically when Workers write data)
3. See last write timestamp, estimated data points

**Step 2: Test a Query in Dashboard**
1. Click your dataset
2. "Run a query" → opens SQL editor
3. Enter: `SELECT COUNT() as total FROM MY_DATASET`
4. Run — verify data is flowing

**Step 3: Set Up the Binding**
1. Workers → Your Worker → Settings → Bindings
2. Add: Analytics Engine → binding name=`MY_DATASET`, dataset name=`MY_DATASET`
3. Or via wrangler.toml

---

## Hands-On Lab

### Prerequisites
```bash
npm install -g wrangler
wrangler login
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token-with-account-analytics-read"
```

### Lab 1: Worker that Writes Analytics
```typescript
// src/index.ts
interface Env {
  SPORTS_ANALYTICS: AnalyticsEngineDataset;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const start = Date.now();

    // Simulate a response
    const sports = {
      '/basketball': { sport: 'basketball', league: 'NBA' },
      '/baseball': { sport: 'baseball', league: 'MLB' },
      '/football': { sport: 'football', league: 'NFL' },
    };

    const data = sports[url.pathname as keyof typeof sports];
    const latencyMs = Date.now() - start;
    const statusCode = data ? 200 : 404;

    // Write data point for every request
    env.SPORTS_ANALYTICS.writeDataPoint({
      blobs: [
        url.pathname,                                             // blob1: requested route
        data?.sport || 'unknown',                                 // blob2: sport category
        request.cf?.country as string || 'XX',                   // blob3: visitor country
        statusCode < 400 ? 'hit' : 'miss',                       // blob4: cache outcome
      ],
      doubles: [
        latencyMs,                                                // double1: response latency
        statusCode,                                               // double2: HTTP status
        1,                                                        // double3: request count (for SUM)
      ],
      indexes: [request.cf?.asn?.toString() || 'unknown'],       // index1: visitor ASN
    });

    if (!data) {
      return new Response('Not Found', { status: 404 });
    }

    return Response.json(data);
  }
} satisfies ExportedHandler<Env>;
```

```toml
# wrangler.toml
name = "sports-analytics-demo"
main = "src/index.ts"
compatibility_date = "2024-11-01"

[[analytics_engine_datasets]]
binding = "SPORTS_ANALYTICS"
dataset = "SPORTS_ANALYTICS"
```

```bash
# Deploy
wrangler deploy

# Generate some traffic
for i in {1..20}; do
  curl -s -o /dev/null https://sports-analytics-demo.your-subdomain.workers.dev/basketball
  curl -s -o /dev/null https://sports-analytics-demo.your-subdomain.workers.dev/baseball
  curl -s -o /dev/null https://sports-analytics-demo.your-subdomain.workers.dev/football
  curl -s -o /dev/null https://sports-analytics-demo.your-subdomain.workers.dev/hockey
done

echo "Traffic generated. Wait 1-2 minutes for data to appear."
```

### Lab 2: Query via SQL API
```bash
# Total requests by route
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/analytics_engine/sql" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  --data "SELECT blob1 as route, SUM(_sample_interval) as requests FROM SPORTS_ANALYTICS GROUP BY blob1 ORDER BY requests DESC"

# Average latency by sport category
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/analytics_engine/sql" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  --data "SELECT blob2 as sport, AVG(double1) as avg_latency_ms, SUM(_sample_interval) as requests FROM SPORTS_ANALYTICS WHERE blob2 != 'unknown' GROUP BY blob2 ORDER BY avg_latency_ms DESC"

# Requests by country (top 10)
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/analytics_engine/sql" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  --data "SELECT blob3 as country, SUM(_sample_interval) as requests FROM SPORTS_ANALYTICS GROUP BY country ORDER BY requests DESC LIMIT 10"

# Error rate by route
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/analytics_engine/sql" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  --data "SELECT blob1 as route, SUM(CASE WHEN double2 >= 400 THEN _sample_interval ELSE 0 END) / SUM(_sample_interval) * 100 as error_rate_pct FROM SPORTS_ANALYTICS GROUP BY route"
```

### Lab 3: Time-Series Query (Trending Over Time)
```bash
# Request volume per hour for the last 24 hours
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/analytics_engine/sql" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  --data "
  SELECT
    toStartOfHour(timestamp) as hour,
    SUM(_sample_interval) as requests,
    AVG(double1) as avg_latency_ms
  FROM SPORTS_ANALYTICS
  WHERE timestamp >= NOW() - INTERVAL '24' HOUR
  GROUP BY hour
  ORDER BY hour ASC
  "
```

### Lab 4: A/B Test Tracking
```typescript
// Track A/B test variant performance
async function trackABTest(env: Env, variant: 'A' | 'B', converted: boolean, latencyMs: number): Promise<void> {
  env.AB_TEST_ANALYTICS.writeDataPoint({
    blobs: [
      variant,                         // blob1: test variant
      converted ? 'converted' : 'not_converted',  // blob2: conversion outcome
      'checkout_button_test',          // blob3: test name
    ],
    doubles: [
      converted ? 1 : 0,              // double1: conversion flag
      latencyMs,                       // double2: page load time
    ],
    indexes: ['checkout_page'],        // index1: page/experiment identifier
  });
}
```

```bash
# Query A/B test results
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/analytics_engine/sql" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  --data "
  SELECT
    blob1 as variant,
    SUM(_sample_interval) as visitors,
    SUM(double1 * _sample_interval) as conversions,
    SUM(double1 * _sample_interval) / SUM(_sample_interval) * 100 as conversion_rate_pct
  FROM AB_TEST_ANALYTICS
  WHERE blob3 = 'checkout_button_test'
    AND timestamp >= NOW() - INTERVAL '7' DAY
  GROUP BY variant
  "
```

---

## Demo Script (2 Minutes)

**Audience:** Developer paying for Amplitude, Mixpanel, or Datadog

**Opening (15 seconds):**
"What are you paying Amplitude per month? $500? $2,000? For data your own application generates, on your own users. Let me show you something."

**Act 1 — Show the write (30 seconds):**
"This is a Worker. [Show writeDataPoint code.] Three lines of code. Every request writes a data point — route, country, latency, status code. This goes into Cloudflare's time-series database automatically. No SDK, no HTTP call to a third-party, no data leaving your Cloudflare account."

**Act 2 — Show the query (40 seconds):**
"[Run the SQL query live.] This is SQL. Standard SQL. I'm querying my own data directly. Route breakdown, error rates, latency by country, A/B test conversions. Same queries you'd write in Amplitude, but it's on your infrastructure, returning in milliseconds."

**Act 3 — Show the cost (20 seconds):**
"100,000 data points per day free. After that, $0.25 per million. If you're writing one data point per request and doing 10 million requests a month, that's $2.50. Not $2,500."

**Close (15 seconds):**
"Is this going to replace every analytics tool? No. But for developer metrics, error rates, and business KPIs that live inside your Worker — this is the most economical and fastest option available."

---

## Competitive Context

| Feature | Workers Analytics Engine | Datadog Custom Metrics | Amplitude Events | InfluxDB Cloud | Mixpanel |
|---|---|---|---|---|---|
| **Integration** | Native Workers binding (0 latency) | HTTP API (adds latency) | HTTP API | HTTP API | HTTP API |
| **Query language** | SQL | Metrics UI + PromQL | Funnel builder | InfluxQL/Flux | Custom UI |
| **Data model** | Blobs + Doubles (10+20 fields) | Tags + Values | Properties | Tags + Fields | Properties |
| **Retention** | 31 days | 15 months | 12 months | 30 days (free) | 12 months |
| **Free tier** | 100K/day | 10 metrics | 10M events/month | Limited | 100K events/mo |
| **Cost at 10M events/mo** | ~$2.50 | ~$300+ | ~$1,000+ | ~$50+ | ~$800+ |
| **Real-time** | ~1 min lag | Near real-time | Near real-time | Real-time | Near real-time |
| **Sampling** | Adaptive (automatic) | None | None | None | None |
| **Edge writing** | Yes (same process) | No (HTTP egress) | No (HTTP egress) | No | No |

**Key positioning:** For metrics that originate inside Workers, Analytics Engine wins on cost by 100-1000x vs SaaS analytics tools. The data never leaves Cloudflare's network to be logged, which also helps with data residency requirements.

---

## Self-Check Questions

**Question 1:** Explain the three data field types in Analytics Engine (blobs, doubles, indexes). For a checkout funnel, provide a concrete example of what you'd put in each field type.

```
Your answer:




```

**Question 2:** Why should you use `SUM(metric * _sample_interval) / SUM(_sample_interval)` for averages instead of `AVG(metric)` when querying Analytics Engine?

```
Your answer:




```

**Question 3:** A customer wants to track error rates broken down by API endpoint AND by user subscription tier (free/paid). Sketch the `writeDataPoint` call they would use.

```
Your answer:




```

**Question 4:** Analytics Engine has a 31-day data retention limit. A customer wants to see 12-month trends. What is the architecture to make this work?

```
Your answer:




```

**Question 5:** Compare Analytics Engine to Datadog custom metrics for a Worker that processes 50 million requests per day. What are the cost and latency implications of each?

```
Your answer:




```

---

## Sources

- [Workers Analytics Engine Documentation](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)
- [Analytics Engine Limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/)
- [Analytics Engine Sampling](https://developers.cloudflare.com/analytics/analytics-engine/sampling/)
- [Workers Bindings: Analytics Engine](https://developers.cloudflare.com/workers/runtime-apis/bindings/analytics-engine/)
- [Cloudflare Blog: Analytics Engine GA](https://blog.cloudflare.com/workers-analytics-engine/)
- [InfluxDB Data Model](https://docs.influxdata.com/influxdb/v2/reference/key-concepts/data-elements/)
- [Time-Series Database Design Patterns](https://www.influxdata.com/blog/time-series-database/)
