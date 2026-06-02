# Module 9.5 — Workers Analytics
> Dashboard Location: macksportreport.com → Analytics → Workers
> Estimated Time: 50 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Workers Analytics provides observability into your Cloudflare Workers — the serverless compute functions that run at Cloudflare's edge. Unlike traditional serverless platforms where you need to configure external monitoring (CloudWatch, Datadog), Workers metrics are built into the platform and available immediately.

### Why Workers Observability Is Different

Workers execute in V8 isolates, not containers. This changes the monitoring model:

- **No cold starts to monitor** — isolates warm in <1ms, so startup time isn't a meaningful metric
- **CPU time ≠ wall clock time** — Workers are billed and limited on CPU time, not total execution time
- **Subrequests are first-class** — Workers often orchestrate multiple fetch() calls; each is tracked
- **Global execution** — the same Worker runs in 330+ data centers; you need per-PoP visibility

### Core Metrics

| Metric | Definition | Why It Matters |
|--------|-----------|----------------|
| **Requests** | Total invocations of the Worker | Volume baseline |
| **Errors** | Uncaught exceptions or explicit errors | Error rate monitoring |
| **CPU Time (P50/P95/P99)** | CPU milliseconds consumed at each percentile | Cost and limit tracking |
| **Duration** | Total wall-clock time per invocation | User-perceived latency |
| **Subrequests** | Total fetch() calls made from within the Worker | Upstream dependency volume |
| **Memory Usage** | Heap memory consumed | Out-of-memory error prevention |

### CPU Time vs Duration

This distinction is critical for Workers:

**CPU Time:** The amount of time the Worker is actively executing JavaScript — doing computation, parsing, string operations. JavaScript blocking the V8 thread.

**Duration (Wall Clock):** Total time from Worker invocation start to response sent, including:
- CPU time
- Time waiting for fetch() subrequests
- Time waiting for KV reads/writes
- Time waiting for D1 queries

Workers have a **CPU time limit** (not a duration limit):
- Free: 10ms CPU time per request
- Paid (Bundled): 50ms CPU time per request  
- Paid (Unbound): up to 30s CPU time per request

A Worker can have a wall-clock duration of 30 seconds (waiting for an API) while consuming only 5ms of CPU time. Both are important, but in different ways.

### Error Types in Workers

Workers errors fall into two categories:

1. **Uncaught exceptions** — JavaScript errors that throw and are not caught by try/catch. These generate a `500 Internal Server Error` to the user.

2. **Explicit errors** — Your Worker intentionally returns a 4xx/5xx status code. These are counted in the errors metric.

Workers Analytics tracks both. The error rate (errors / total requests) is the primary health signal for a Worker in production.

---

## Deep Dive (Architect-Level)

### Reading CPU Time Distribution Charts

The CPU time charts show percentiles: P50, P75, P95, P99. Understanding the shape:

**Narrow distribution (P50 ≈ P99):** All requests use similar CPU time. Worker logic is predictable. Example: a simple request transformer with no conditional complexity.

**Wide distribution (P99 >> P50):** Some requests use significantly more CPU than typical. Common causes:
- Conditional logic that only triggers for certain request types (e.g., JSON parsing only for POST requests)
- Regex matching with complex patterns
- Cryptographic operations on variable-length inputs
- Large payload processing

**Spike pattern:** Sudden increase across all percentiles. Common causes:
- Code deployment with inefficient algorithm
- New traffic pattern hitting an expensive code path
- External input (larger request bodies than expected)

**Ideal targets for well-optimized Workers:**
- P50 CPU time: 1-5ms
- P95 CPU time: < 20ms (well under the 50ms bundled limit)
- P99 CPU time: < 45ms (headroom before hitting limits)

### Workers KV Analytics

Workers KV has its own analytics subsection:

| KV Metric | Definition |
|-----------|-----------|
| **KV Reads** | `kv.get()` calls |
| **KV Writes** | `kv.put()` calls |
| **KV Deletes** | `kv.delete()` calls |
| **KV List** | `kv.list()` calls |

KV pricing: $0.50/million reads, $5/million writes. Monitoring read/write ratios is important for cost management. If writes are unexpectedly high, investigate whether your Worker is re-writing data that hasn't changed.

### Workers Observability (Enhanced)

Workers Observability (available on paid plans) extends beyond the basic metrics dashboard with:

1. **Request logs** — Full request/response details for each invocation
2. **Console logs** — `console.log()` output from your Worker captured in the dashboard
3. **Structured logging** — Query your Worker logs with filters
4. **Tail Workers** — A special Worker that receives real-time streaming logs from another Worker

### Workers Tail Workers

A Tail Worker is a Worker that receives invocation data from another Worker in real time. Use it to:

- Stream logs to external services (Datadog, Splunk, etc.)
- Calculate custom metrics
- Alert on error patterns

**Tail Worker implementation:**

```javascript
// This is a Tail Worker — it receives trace data from another Worker
export default {
  async tail(events, env, ctx) {
    for (const event of events) {
      // event.scriptName: the Worker that generated this event
      // event.outcome: "ok", "exception", "exceededCpu", "unknown"
      // event.logs: console.log() calls from the traced Worker
      // event.exceptions: uncaught exceptions
      
      if (event.outcome === 'exception') {
        // Send to your error tracking system
        await fetch('https://your-error-tracking.com/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            worker: event.scriptName,
            error: event.exceptions[0]?.message,
            timestamp: new Date(event.eventTimestamp).toISOString()
          })
        });
      }
    }
  }
};
```

**wrangler.toml for Tail Worker:**

```toml
name = "my-tail-worker"
main = "src/index.js"

[[tail_consumers]]
service = "my-main-worker"
```

### Workers Analytics Engine

Analytics Engine allows your Workers to emit **custom time series data** that you can then query via the Analytics GraphQL API or visualize in Custom Dashboards.

Use cases:
- Track business events (sign-ups, purchases) from a Worker
- Monitor custom application metrics (queue depth, processing time)
- Build per-customer usage tracking for billing/limits

**Worker code to emit custom data points:**

```javascript
export default {
  async fetch(request, env) {
    const start = Date.now();
    
    // Your Worker logic here
    const result = await processRequest(request, env);
    
    const duration = Date.now() - start;
    
    // Emit a custom analytics data point
    env.ANALYTICS.writeDataPoint({
      blobs: [
        request.url,                    // blob1: URL
        request.headers.get('cf-ipcountry') || 'unknown',  // blob2: country
        result.status.toString()        // blob3: status
      ],
      doubles: [
        duration,                       // double1: processing time ms
        result.itemsProcessed || 0      // double2: items processed
      ],
      indexes: [request.url]            // used for efficient querying
    });
    
    return result.response;
  }
};
```

**wrangler.toml binding for Analytics Engine:**

```toml
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "my_worker_metrics"
```

**Query Analytics Engine data:**

```graphql
{
  viewer {
    accounts(filter: { accountTag: "YOUR_ACCOUNT_ID" }) {
      workersAnalyticsEngineAdaptiveGroups(
        limit: 24
        dataset: "my_worker_metrics"
        filter: {
          datetime_geq: "2026-06-01T00:00:00Z"
          datetime_leq: "2026-06-02T00:00:00Z"
        }
        orderBy: [datetime_ASC]
      ) {
        dimensions {
          datetime
          blob2   # country
          blob3   # status
        }
        avg {
          double1  # avg duration
        }
        sum {
          double2  # total items processed
        }
        count
      }
    }
  }
}
```

---

## Dashboard Walkthrough

### Step 1: Navigate to Workers Analytics

1. macksportreport.com → Workers & Pages (or account level)
2. Select the Worker you want to inspect
3. Click **Metrics** tab
   
Or from Analytics:
1. macksportreport.com → Analytics → Workers

### Step 2: Read the Overview Cards

- **Requests**: Total invocations in the time window
- **Errors**: Count and rate (%)
- **CPU Time (P50)**: Typical CPU usage
- **CPU Time (P99)**: Worst-case CPU usage

A healthy Worker should show error rate < 1% and P99 CPU time well within your plan's limit.

### Step 3: Examine the CPU Time Distribution

The percentile chart over time shows if CPU time is stable or trending upward. An upward trend suggests:
- A code deployment that increased complexity
- Input data growing in size over time
- Memory pressure causing slower GC

### Step 4: Check Subrequests

High subrequest counts (multiple fetch() calls per Worker invocation) increase duration (wall clock) even with low CPU time. Monitor for subrequest spikes that correlate with slow responses.

### Step 5: Real-Time Logs (if Observability enabled)

Click **Logs** tab to see recent invocation logs including:
- Console output from your Worker
- Error stack traces
- Request/response details

---

## Hands-On Lab

### Prerequisites

- A Worker deployed to macksportreport.com (or create one)
- `wrangler` CLI installed (`npm install -g wrangler`)
- Cloudflare API token with Workers permissions

### Lab 1: Deploy a Test Worker

```bash
# Create a simple test Worker
mkdir -p /tmp/test-worker && cd /tmp/test-worker

cat > wrangler.toml << 'EOF'
name = "analytics-test-worker"
main = "src/index.js"
compatibility_date = "2024-01-01"

[observability]
enabled = true

[[routes]]
pattern = "macksportreport.com/api/worker-test"
zone_name = "macksportreport.com"
EOF

mkdir -p src
cat > src/index.js << 'EOF'
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Simulate variable CPU work
    const complexity = parseInt(url.searchParams.get('n') || '1000');
    let result = 0;
    for (let i = 0; i < complexity; i++) {
      result += Math.sqrt(i);
    }
    
    // Log for observability
    console.log(`Processed request: n=${complexity}, result=${result.toFixed(2)}`);
    
    return new Response(JSON.stringify({
      message: 'Worker executed successfully',
      complexity: complexity,
      result: result.toFixed(2),
      country: request.cf?.country || 'unknown',
      datacenter: request.cf?.colo || 'unknown'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
EOF

echo "Worker files created. Run: wrangler deploy"
```

### Lab 2: Deploy and Generate Traffic

```bash
cd /tmp/test-worker

# Deploy the Worker
wrangler deploy

# Generate test traffic (adjust URL to your actual worker URL)
WORKER_URL="https://analytics-test-worker.YOUR_SUBDOMAIN.workers.dev"

echo "Generating test traffic..."

# Normal requests
for i in $(seq 1 20); do
  curl -s "$WORKER_URL?n=1000" > /dev/null
  echo -n "."
done

# Heavy requests (high CPU time)
for i in $(seq 1 5); do
  curl -s "$WORKER_URL?n=100000" > /dev/null
  echo -n "H"
done

echo ""
echo "Traffic generated. Check the Workers analytics dashboard."
```

### Lab 3: Real-Time Log Streaming with wrangler tail

```bash
# Stream real-time logs from your Worker (runs in foreground)
# Open a new terminal and run this, then hit the Worker URL in another terminal

wrangler tail analytics-test-worker --format=pretty

# In another terminal:
curl "https://analytics-test-worker.YOUR_SUBDOMAIN.workers.dev?n=5000"
```

Expected output in the tail terminal:
```
Connected to analytics-test-worker, waiting for logs...

[2026-06-02 10:15:33] [info] Processed request: n=5000, result=235702.26
GET https://analytics-test-worker.YOUR_SUBDOMAIN.workers.dev?n=5000 - Ok @ 2026-06-02 10:15:33
  (log) Processed request: n=5000, result=235702.26
```

### Lab 4: Tail Worker for Error Monitoring

```bash
mkdir -p /tmp/tail-worker && cd /tmp/tail-worker

cat > wrangler.toml << 'EOF'
name = "error-monitor-tail"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[tail_consumers]]
service = "analytics-test-worker"
EOF

mkdir -p src
cat > src/index.js << 'EOF'
export default {
  async tail(events, env, ctx) {
    for (const event of events) {
      const summary = {
        worker: event.scriptName,
        outcome: event.outcome,
        timestamp: new Date(event.eventTimestamp).toISOString(),
        logs: event.logs?.map(l => l.message).join(', '),
        errors: event.exceptions?.map(e => e.message)
      };
      
      if (event.outcome !== 'ok') {
        console.error('Worker error:', JSON.stringify(summary));
        // In production: send to PagerDuty, Slack, etc.
      } else {
        console.log('Worker ok:', JSON.stringify(summary));
      }
    }
  }
};
EOF

echo "Tail Worker created. Run: wrangler deploy"
```

---

## Demo Script (2 Minutes)

**Setup:** Have a Worker deployed and the Workers analytics dashboard open showing some traffic.

---

"The thing I love about Workers analytics is it gives you serverless observability out of the box — no CloudWatch setup, no log agents, nothing to configure.

[Point to requests/errors overview]

Here's a Worker handling 12,000 requests in the last hour with a 0.02% error rate. In a production system you want that error rate under 1%, ideally under 0.1%.

[Click on CPU time chart]

This is the chart that matters for Workers specifically. It's not wall-clock time — it's CPU time. P50 is 3ms, P99 is 47ms. We're comfortable because our plan allows 50ms per request. But look at this — P99 is 47ms. That's cutting it close. If this Worker ever gets more complex logic added to it, we could start hitting CPU limit exceeded errors.

[Scroll to subrequests]

Subrequests are the fetch() calls made from inside the Worker. 2.3 subrequests per invocation on average. That means this Worker is calling out to external services for most requests. That's all happening at Cloudflare's edge, often over Cloudflare's own backbone.

[Open wrangler tail in terminal if set up]

And this — real-time log streaming. No log aggregation service required. Every console.log() from your Worker, streamed to your terminal as requests come in. This is what makes debugging Workers feel very different from traditional serverless."

---

## Competitive Context

| Feature | Cloudflare Workers Analytics | AWS Lambda CloudWatch | Vercel Analytics |
|---------|------------------------------|----------------------|-----------------|
| **Built-in metrics** | Yes | Yes (requires CloudWatch) | Yes |
| **CPU time tracking** | Yes (core metric) | Yes (billed metric) | Limited |
| **Real-time log streaming** | Yes (wrangler tail) | Yes (CloudWatch Live Tail) | Limited |
| **Custom metrics** | Yes (Analytics Engine) | Yes (CloudWatch custom metrics) | No |
| **Tail Workers / streaming hooks** | Yes | No (Lambda destinations async) | No |
| **Per-request console logs** | Yes (Observability) | Yes (structured logs) | Yes |
| **Cold start visibility** | N/A (no cold starts) | Yes (init duration) | N/A |
| **Global execution visibility** | Yes (by PoP) | No (single region) | Yes |
| **Cost for logs** | Included on paid | $0.50/GB ingestion | Included |

**Key differentiator:** Workers has no cold starts to monitor. AWS Lambda users spend significant effort understanding and optimizing cold start latency. Workers analytics can focus entirely on execution metrics rather than initialization overhead.

---

## Self-Check Questions

**Question 1:** A Worker shows P50 CPU time = 8ms and P99 CPU time = 48ms. The plan limit is 50ms. What does this tell you about the Worker's risk profile, and what action would you recommend?

```
Your answer:




```

---

**Question 2:** A Worker handles 10,000 requests per day and each request makes 3 subrequests to a KV namespace. What is the daily KV read count, and at $0.50/million reads, what is the monthly cost?

```
Your answer:




```

---

**Question 3:** Explain the difference between a Worker's CPU time and its wall-clock duration. Give a specific example of a Worker that could have low CPU time but high wall-clock duration.

```
Your answer:




```

---

**Question 4:** What is a Tail Worker and what are three real-world use cases for one in a production environment?

```
Your answer:




```

---

**Question 5:** A customer wants to track how many API calls of each type their Worker processes per hour, so they can build a billing/usage dashboard. What Cloudflare-native feature enables this, and at a high level, how would you implement it?

```
Your answer:




```

---

## Sources

- [Cloudflare Workers Observability](https://developers.cloudflare.com/workers/observability/)
- [Workers Metrics and Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Tail Workers Documentation](https://developers.cloudflare.com/workers/observability/tail-workers/)
- [Analytics Engine Documentation](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Workers KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/)
- [Wrangler Tail Command](https://developers.cloudflare.com/workers/wrangler/commands/#tail)
- [Workers Observability Logging](https://developers.cloudflare.com/workers/observability/logs/)
