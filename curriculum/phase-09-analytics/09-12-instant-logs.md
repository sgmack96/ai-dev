# Module 9.12 — Instant Logs
> Dashboard Location: macksportreport.com → Investigate → Instant Logs
> Estimated Time: 30 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Instant Logs streams live log data from Cloudflare's edge to your browser via a WebSocket connection. Unlike Logpush (bulk batch export) or Log Explorer (stored query interface), Instant Logs shows requests happening right now — as they occur at the edge. It's the closest thing Cloudflare offers to a live tail of your edge traffic.

### When Instant Logs Is the Right Tool

| Situation | Best Tool |
|-----------|----------|
| Debugging a specific issue in real time | Instant Logs |
| Watching traffic during a deployment | Instant Logs |
| Monitoring an incident as it happens | Instant Logs |
| Verifying a WAF rule works on live traffic | Instant Logs |
| Historical investigation (past events) | Log Explorer |
| Long-term retention and SIEM export | Logpush |
| Building persistent dashboard charts | Log Explorer + Custom Dashboards |

### How Instant Logs Works

The browser opens a WebSocket connection to Cloudflare's streaming endpoint. As requests arrive at the Cloudflare edge for your zone, log entries are forwarded over the WebSocket to your browser in near real-time.

The connection is:
- **Stateful** — live for the duration of your session
- **Sampled** — not every single request at high traffic volumes (sampling explained below)
- **Filtered** — you can apply filters before the stream opens
- **Ephemeral** — logs shown in the stream are not stored; once the session ends, the data is gone

### Fields Available in Instant Logs

| Field | Example Value |
|-------|--------------|
| Timestamp | `2026-06-02T10:15:23Z` |
| Client IP | `203.0.113.10` |
| HTTP Method | `GET` |
| URL | `https://macksportreport.com/api/scores` |
| HTTP Status | `200` |
| Cache Status | `HIT` |
| Edge Colo | `IAD` |
| Ray ID | `89abc123def45678` |
| Country | `US` |
| User Agent | `Mozilla/5.0 (Chrome/125.0...)` |
| WAF Action | `block` |
| Bot Score | `87` |
| Origin Response Time | `145ms` |
| Request Size | `1.2 KB` |
| Response Size | `48.3 KB` |

### Sampling on Lower Plans

Instant Logs applies **sampling** on Free and lower-traffic plans. When your zone receives more requests than the WebSocket can deliver, Cloudflare samples:

- **Free:** ~1% sampling rate at high traffic
- **Pro/Business:** higher sampling, up to near-100% at moderate traffic
- **Enterprise:** near-real-time, minimal sampling

**Practical impact:** If your zone gets 10,000 requests per minute, Instant Logs might show you 100-1,000 of them. The stream gives you a representative sample, not a complete view. For complete log capture, you need Logpush.

---

## Deep Dive (Architect-Level)

### WebSocket Architecture

When you click "Start" in Instant Logs, the dashboard:

1. Makes an API call to create a log stream session
2. Receives a WebSocket URL and session ID
3. Opens a WebSocket connection to that URL
4. The edge begins forwarding sampled log events to the WebSocket
5. The dashboard renders each event as it arrives

The WebSocket URL looks like:
```
wss://logs.cloudflare.com/instant-logs/ws/sessions/SESSION_ID
```

Sessions auto-expire after a period of inactivity (typically 10-15 minutes with no traffic matching your filters).

### CLI Access with Wrangler

For Workers-specific streaming, `wrangler tail` provides the same real-time log streaming experience from the command line:

```bash
# Stream logs from a specific Worker
wrangler tail my-worker-name --format=pretty

# Filter to specific HTTP status codes
wrangler tail my-worker-name --status=500 --format=pretty

# Filter to specific URL path
wrangler tail my-worker-name --search="api/scores" --format=pretty

# JSON format for programmatic processing
wrangler tail my-worker-name --format=json | jq 'select(.outcome == "exception")'
```

`wrangler tail` format shows:
```
GET https://macksportreport.com/api/scores - Ok @ 2026-06-02 10:15:23
  (log) Processing request for user ID: 12345
  (log) Cache hit: true
  Response time: 12ms, CPU time: 3ms
```

For exceptions:
```
GET https://macksportreport.com/api/auth - Exception @ 2026-06-02 10:15:40
  (exception) TypeError: Cannot read properties of undefined (reading 'userId')
    at handleRequest (worker.js:42:18)
    at Object.fetch (worker.js:8:20)
```

### Instant Logs Filters

When opening an Instant Logs session, you can pre-filter the stream:

| Filter Type | Example | Effect |
|-------------|---------|--------|
| **Path contains** | `/api` | Only show requests to paths containing "/api" |
| **Status code** | `>= 400` | Only show error responses |
| **HTTP method** | `POST` | Only show POST requests |
| **Ray ID** | `89abc...` | Show a specific request (follow a single request) |
| **Country** | `US` | Only requests from a specific country |
| **Cache status** | `MISS` | Only uncached requests |
| **WAF action** | `block` | Only WAF-blocked requests |

**Pro tip:** When debugging a specific user's issue, ask them for their Ray ID (visible in `cf-ray` response header, or in the error page if they receive a Cloudflare error page). Filter Instant Logs to that Ray ID to see exactly what happened to their request.

### The Ray ID: Tracing a Single Request

Every request through Cloudflare gets a unique **Ray ID** — a 16-character hexadecimal identifier. The Ray ID appears in:

- The `cf-ray` response header (visible to the user and in their browser DevTools)
- Cloudflare error pages (if the user receives a 1XXX, 5XX from Cloudflare)
- Instant Logs stream
- Log Explorer queries
- Logpush log files

When a user reports an issue, getting their Ray ID collapses the investigation from "find the request in millions of logs" to "filter by exact Ray ID."

```bash
# Get the Ray ID for a specific request
curl -s -I https://macksportreport.com/ | grep -i "cf-ray"
# Output: cf-ray: 89abc123def45678-IAD

# The last 3 characters (IAD) are the Cloudflare data center code
# The hexadecimal prefix is the unique request identifier
```

### Session Duration and Inactivity Timeout

Instant Logs sessions time out based on:
- **Inactivity:** If no events match your filter for several minutes, the session expires
- **Maximum duration:** Sessions have a maximum lifetime (varies by plan, typically 30-60 minutes)
- **Browser tab closure:** The WebSocket disconnects if the browser tab is closed

For long-running monitoring (e.g., watching traffic for an entire deployment window), use Logpush + Datadog/Splunk dashboards instead of relying on Instant Logs.

### Instant Logs vs Logpush: The Right Mental Model

```
Instant Logs = tcpdump for HTTP traffic
  → Short bursts of real-time visibility
  → Sampled, ephemeral
  → Perfect for debugging, verification, monitoring an event

Logpush = network packet capture written to disk
  → Complete, persistent log archive
  → Queryable and SIEM-integrable
  → Perfect for compliance, historical analysis, SIEM
```

Just as a systems engineer uses both tcpdump (quick, live, ephemeral) and persistent packet captures (long-term, auditable), you use both Instant Logs and Logpush.

---

## Dashboard Walkthrough

### Step 1: Navigate to Instant Logs

macksportreport.com → Investigate → Instant Logs

### Step 2: Configure Filters (Optional)

Before starting the stream, optionally add filters:

**Scenario: Watch only API errors**
- Field: HTTP Status Code
- Operator: >=
- Value: 400
- Add second filter: Path contains `/api`

**Scenario: Debug a specific user**
- Field: Ray ID
- Operator: equals
- Value: [paste the Ray ID they gave you]

**Scenario: Watch WAF in action**
- Field: WAF Action
- Operator: equals
- Value: block

### Step 3: Start the Stream

Click **Start streaming**. A blinking indicator shows the WebSocket is active.

### Step 4: Interpret the Live Feed

Each row in the feed shows:
- Timestamp (to the second)
- Client IP
- Method + URL
- Status code (color-coded: green = 2xx, yellow = 3xx/4xx, red = 5xx)
- Cache status
- Country + Data Center
- Ray ID (click to expand full details)

### Step 5: Click a Row for Detail

Clicking any row expands the full log entry, showing all available fields for that specific request.

### Step 6: Stop and Filter

Click **Stop** to pause. Adjust filters. Click **Start** again for a new filtered session.

---

## Hands-On Lab

### Prerequisites

- macksportreport.com on any plan
- `wrangler` CLI installed for Lab 3
- Active traffic (or ability to generate it with curl)

### Lab 1: Start an Instant Logs Session in the Dashboard

1. Open macksportreport.com → Investigate → Instant Logs
2. Add filter: Status Code >= 200 (capture all responses)
3. Click **Start streaming**
4. In a new terminal, generate test traffic:

```bash
# Generate traffic that will appear in the Instant Logs stream
for i in $(seq 1 10); do
  curl -s -o /dev/null "https://macksportreport.com/?test=$i"
  curl -s -o /dev/null "https://macksportreport.com/favicon.ico"
  echo "Request batch $i sent"
  sleep 1
done
```

5. Watch the requests appear in real-time in the dashboard
6. Note the cache status of each request (favicon.ico should show HIT after the first request)

### Lab 2: Debug a Specific Request Using Ray ID

```bash
# Step 1: Get a Ray ID from a request
RAY_ID=$(curl -s -I https://macksportreport.com/ | grep -i "cf-ray" | awk '{print $2}' | tr -d '\r' | cut -d'-' -f1)
echo "Ray ID: $RAY_ID"
echo "Colo: $(curl -s -I https://macksportreport.com/ | grep -i "cf-ray" | awk '{print $2}' | tr -d '\r' | cut -d'-' -f2)"
```

```
# Step 2: In the Instant Logs dashboard:
# - Add filter: Ray ID equals [your Ray ID]
# - Start streaming
# - Send the same request again
# - You'll see exactly that one request with full detail
```

### Lab 3: Real-Time Worker Log Streaming with Wrangler Tail

```bash
# If you have a Worker deployed to macksportreport.com:

# Stream all logs in pretty format
wrangler tail analytics-test-worker --format=pretty

# In a separate terminal, trigger the Worker:
curl "https://analytics-test-worker.YOUR_SUBDOMAIN.workers.dev?n=1000"

# Watch the log appear in wrangler tail output immediately
```

### Lab 4: Filter wrangler tail to Errors Only

```bash
# Start tail filtered to only errors (non-OK outcomes)
wrangler tail analytics-test-worker --format=json | jq 'select(.outcome != "ok") | {
  outcome: .outcome,
  url: .event.request.url,
  timestamp: .eventTimestamp,
  errors: .exceptions
}'
```

### Lab 5: Capture and Analyze Instant Logs Stream via API

```bash
export CF_API_TOKEN="your-api-token"
export ZONE_ID="your-zone-id"

# Step 1: Create an Instant Logs session
SESSION=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/logs/instant-logs/sessions" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "fields": "ClientIP,ClientRequestMethod,ClientRequestURI,ClientCountry,EdgeResponseStatus,CacheCacheStatus,BotScore,RayID",
    "sample": 1,
    "filters": "",
    "kind": "firewall"
  }')

echo "Session created:"
echo $SESSION | jq '.'

# Extract the WebSocket URL
WS_URL=$(echo $SESSION | jq -r '.result.destination_conf')
echo "WebSocket URL: $WS_URL"

# Step 2: Connect to the WebSocket (requires wscat or similar)
# Install: npm install -g wscat
# wscat -c "$WS_URL"

echo "To stream logs, run: wscat -c '$WS_URL'"
```

### Lab 6: Monitor a Deployment in Real Time

**Scenario: You're deploying a new Workers release. Use Instant Logs to watch for errors.**

```bash
# Terminal 1: Start monitoring (in Instant Logs dashboard or wrangler tail)
wrangler tail my-production-worker --format=pretty

# Terminal 2: Deploy the new Worker version
wrangler deploy

# Terminal 3: Send test traffic
for i in $(seq 1 20); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://macksportreport.com/api/scores)
  echo "Request $i: HTTP $STATUS"
  sleep 2
done

# Watch Terminal 1 for any exceptions or unexpected behavior after the deploy
```

---

## Demo Script (2 Minutes)

**Setup:** Instant Logs open in the dashboard. Terminal ready with curl commands.

---

"Deployments make me nervous. Not because our code is bad — because something always behaves differently in production than in staging. Instant Logs is my safety net.

[Start the Instant Logs stream, filter to status >= 400]

I've filtered this stream to only show error responses — 400s and 500s. Right now it's empty, which is exactly what I want to see.

[In terminal: run a curl command to generate traffic]

Let me send some real traffic.

[Show requests appearing in the stream]

Requests appearing in real time — 200s, cache hits, everything green. Let me simulate what a bad deploy looks like.

[Run curl with a path that returns a 500]

There — a 500 just hit. Click on it.

[Click the row, expand the full details]

Full detail: the exact URL, the origin response time was 3,200ms before it 500'd, the Worker CPU time, the Ray ID. I can take this Ray ID and drop it into Log Explorer to see if there are more like it. I can take this Worker execution trace and drop it into the wrangler tail output to find the exception.

And the key thing: this is live. If I deploy right now and something breaks, I'll see it within 30 seconds. Not when a user calls to complain. Not when an alert fires 5 minutes later. Right now.

[Click stop, update a filter, start again]

This is what monitoring during a deployment looks like. Zero setup. Zero configuration. Just open the tab before you deploy."

---

## Competitive Context

| Feature | Cloudflare Instant Logs | AWS CloudFront Real-Time Logs | Fastly Real-Time Log Streaming | Vercel Runtime Logs |
|---------|------------------------|------------------------------|-------------------------------|---------------------|
| **Delivery mechanism** | WebSocket (browser) | Kinesis stream | Custom endpoint | Dashboard/CLI |
| **Latency** | ~1-2 seconds | <1 second | <1 second | ~2-5 seconds |
| **CLI equivalent** | wrangler tail | aws-cli (complex) | fastly log-tail | vercel logs |
| **Sampling** | Yes (plan-dependent) | Yes (configurable) | Yes | Yes |
| **Dashboard filters** | Yes | No (Kinesis consumer needed) | No | Limited |
| **Worker-specific streaming** | Yes (wrangler tail) | N/A | N/A | Yes |
| **Session persistence** | No (ephemeral) | Yes (Kinesis) | No | No |
| **Free plan access** | Yes (sampled) | No (Kinesis has cost) | Enterprise | Free tier |
| **Setup required** | None | Kinesis + consumer | Log endpoint needed | None |

**Cloudflare differentiator:** Zero setup, in-browser live streaming is unique. AWS requires Kinesis → consumer application to get real-time logs. Cloudflare Instant Logs works with one click from the dashboard. Combined with `wrangler tail` for Worker-specific debugging, the real-time observability story is strong with no additional tooling.

---

## Self-Check Questions

**Question 1:** A customer calls saying a specific user (who gave them a Ray ID: `89abc123def45678`) can't load a specific page. Describe exactly how you would use Instant Logs or other tools to investigate this specific request.

```
Your answer:




```

---

**Question 2:** A customer on the Free plan says they see very little data in Instant Logs even though they're getting thousands of requests per minute. What is the cause, and what are two options to get more complete log visibility?

```
Your answer:




```

---

**Question 3:** What is the fundamental difference between Instant Logs and Logpush in terms of completeness, persistence, and use case? When would you use each?

```
Your answer:




```

---

**Question 4:** A developer is watching `wrangler tail` during a deployment and sees this output:

```
GET https://api.macksportreport.com/scores - Exception @ 2026-06-02 10:15:40
  (exception) TypeError: Cannot read properties of undefined (reading 'toUpperCase')
    at handler (worker.js:84:30)
```

What specific information does this give you, and what is your next debugging step?

```
Your answer:




```

---

**Question 5:** A site reliability engineer wants to set up a 30-minute monitoring session during a major traffic event (big game day). They want to capture all 500 errors in real time and save them for later analysis. What combination of tools would you recommend and why?

```
Your answer:




```

---

## Sources

- [Cloudflare Instant Logs Documentation](https://developers.cloudflare.com/logs/instant-logs/)
- [Instant Logs API Reference](https://developers.cloudflare.com/api/operations/instant-logs-create-live-log-session)
- [Wrangler Tail Documentation](https://developers.cloudflare.com/workers/wrangler/commands/#tail)
- [Cloudflare Ray ID Explanation](https://developers.cloudflare.com/fundamentals/get-started/reference/cloudflare-ray-id/)
- [Cloudflare Logs Overview](https://developers.cloudflare.com/logs/)
- [Log Sampling Documentation](https://developers.cloudflare.com/logs/logpush/logpush-configuration-api/understanding-logpush-api/#sampling)
- [WebSocket API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
