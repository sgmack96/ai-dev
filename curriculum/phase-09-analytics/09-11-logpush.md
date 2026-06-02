# Module 9.11 — Logpush
> Dashboard Location: macksportreport.com → Investigate → Logpush
> Estimated Time: 55 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Logpush is Cloudflare's log export pipeline. It continuously streams log data from Cloudflare's edge to a destination of your choice — a storage bucket, a SIEM, or a log management platform — in near real-time. While Log Explorer handles interactive ad-hoc queries, Logpush is designed for bulk export, long-term retention, and integration with external analytics systems.

### The Logpush Mental Model

Think of Logpush as a continuously running SQL query with an export destination:

```
Every 30-60 seconds:
  SELECT [your chosen fields] 
  FROM [your chosen dataset]
  WHERE [your optional filters]
  → Write as NDJSON to [your destination]
```

Cloudflare batches logs at the edge and delivers them in chunks. Each batch is a file of Newline-Delimited JSON (NDJSON) — one JSON object per line — uploaded to your destination.

### Available Destinations

| Destination | Use Case |
|------------|---------|
| **Cloudflare R2** | Low-cost long-term storage; query with Log Explorer or Workers |
| **AWS S3** | Integrate with AWS ecosystem (Athena, Redshift, OpenSearch) |
| **Google Cloud Storage** | Integrate with GCP ecosystem (BigQuery) |
| **Azure Blob Storage** | Integrate with Azure ecosystem |
| **Splunk** | Enterprise SIEM integration |
| **Datadog** | APM + log correlation |
| **Sumo Logic** | Cloud SIEM |
| **New Relic** | Observability platform integration |
| **Elastic** | Elasticsearch/Kibana integration |
| **HTTP endpoint** | Custom destination (any HTTPS endpoint) |

### Available Log Datasets

| Dataset | Contents | Use Cases |
|---------|---------|----------|
| **HTTP requests** | Every request through CF edge | Traffic analysis, security audit, billing |
| **Firewall events** | WAF, rate limit, bot management events | SIEM security analysis, rule tuning |
| **DNS logs** | DNS queries handled by CF nameservers | DNS analytics, exfiltration detection |
| **Zero Trust Access** | CF Access auth events | Access audit, compliance |
| **Zero Trust Gateway DNS** | DNS-level filtering decisions | Security policy audit |
| **Zero Trust Gateway HTTP** | HTTP-level gateway filtering | Web filtering audit |
| **Workers Trace** | Worker execution events | Worker debugging, performance analysis |
| **Spectrum events** | TCP/UDP proxy events | Network-layer analytics |
| **NEL reports** | Network Error Logging data | Connectivity monitoring |
| **Magic Transit** | Packet-level flow data | Network security analysis |

---

## Deep Dive (Architect-Level)

### Log Format: NDJSON

Each log batch is a file of Newline-Delimited JSON. Each line is a self-contained JSON object representing one log event:

```json
{"ClientIP":"203.0.113.10","ClientRequestMethod":"GET","ClientRequestURI":"/api/scores","EdgeResponseStatus":200,"CacheCacheStatus":"HIT","EdgeStartTimestamp":"2026-06-02T10:15:00Z","BotScore":92,"WAFMatchedVar":"","EdgeColoID":15}
{"ClientIP":"198.51.100.55","ClientRequestMethod":"POST","ClientRequestURI":"/api/auth","EdgeResponseStatus":403,"CacheCacheStatus":"BYPASS","EdgeStartTimestamp":"2026-06-02T10:15:01Z","BotScore":8,"WAFMatchedVar":"http.request.body","EdgeColoID":15}
```

NDJSON is efficient for:
- Streaming processing (process line by line without loading the full file)
- Querying with jq, grep, awk at the command line
- Loading into databases (INSERT one row per JSON line)

### HTTP Requests Dataset: Key Fields

The HTTP requests dataset has 80+ fields. Critical ones to know:

```
ClientIP                 -- Client IP address
ClientASN                -- Client Autonomous System Number
ClientCountry            -- ISO 3166-1 alpha-2 country code
ClientRequestMethod      -- HTTP method
ClientRequestURI         -- Request URI including query string
ClientRequestHost        -- Request host header
ClientRequestUserAgent   -- User-Agent header
ClientRequestReferer     -- Referer header
ClientRequestBytes       -- Request body size (bytes)
ClientSrcPort            -- Client source port

EdgeStartTimestamp       -- RFC 3339 timestamp when request started
EdgeEndTimestamp         -- RFC 3339 timestamp when response completed
EdgeResponseStatus       -- HTTP status code returned to client
EdgeResponseBytes        -- Response body size (bytes)
EdgeColoID               -- Cloudflare data center ID
EdgeServerIP             -- Cloudflare edge server IP

CacheCacheStatus         -- HIT, MISS, BYPASS, EXPIRED, STALE, DYNAMIC, REVALIDATED
CacheResponseStatus      -- HTTP status from cache layer
CacheTieredFill          -- Whether Tiered Cache served the response

OriginIP                 -- Origin server IP
OriginResponseStatus     -- HTTP status from origin
OriginResponseDurationMs -- Origin response time (milliseconds)
OriginResponseBytes      -- Origin response body size

BotScore                 -- Bot Management score (1-99)
BotScoreSrc              -- Source of bot score
WAFAction                -- WAF action taken (block, challenge, log, skip)
WAFRuleID                -- ID of matched WAF rule
WAFMatchedVar            -- The WAF expression variable that matched
FirewallMatchesActions   -- Array of security actions
FirewallMatchesRuleIDs   -- Array of matched rule IDs
FirewallMatchesSources   -- Array of security product sources

WorkerCPUTime            -- CPU time used by Worker (microseconds)
WorkerWallTimeUs         -- Wall time used by Worker (microseconds)
WorkerStatus             -- Worker execution status
```

### Setting Up a Logpush Job: Step-by-Step

#### Example: Push HTTP Requests to R2

**Step 1: Create an R2 bucket**

```bash
# Using Wrangler CLI
wrangler r2 bucket create macksportreport-logs
```

Or via dashboard: R2 → Create Bucket → `macksportreport-logs`

**Step 2: Create an API token with R2 write permissions**

Create a token with:
- Zone: macksportreport.com → Logs:Edit permission
- Account: R2:Edit permission for the `macksportreport-logs` bucket

**Step 3: Create the Logpush job via API**

```bash
export CF_API_TOKEN="your-api-token"
export ZONE_ID="your-zone-id"
export ACCOUNT_ID="your-account-id"

curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/logpush/jobs" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "http-requests-to-r2",
    "logpull_options": "fields=ClientIP,ClientRequestMethod,ClientRequestURI,ClientCountry,EdgeResponseStatus,CacheCacheStatus,EdgeResponseBytes,OriginResponseDurationMs,BotScore,WAFAction,FirewallMatchesRuleIDs&timestamps=rfc3339",
    "destination_conf": "r2://macksportreport-logs/{DATE}?account-id='"$ACCOUNT_ID"'&access-key-id=YOUR_R2_KEY&secret-access-key=YOUR_R2_SECRET",
    "dataset": "http_requests",
    "enabled": true,
    "filter": "{\"where\":{\"key\":\"EdgeResponseStatus\",\"operator\":\"geq\",\"value\":400}}",
    "frequency": "high"
  }' | jq '.'
```

**Filter example — Only push error responses (400+):**
```json
{
  "where": {
    "key": "EdgeResponseStatus",
    "operator": "geq",
    "value": 400
  }
}
```

**Filter example — Only push WAF blocks:**
```json
{
  "where": {
    "key": "WAFAction",
    "operator": "eq",
    "value": "block"
  }
}
```

**Filter example — Exclude static assets:**
```json
{
  "where": {
    "and": [
      {
        "key": "ClientRequestURI",
        "operator": "!contains",
        "value": ".css"
      },
      {
        "key": "ClientRequestURI",
        "operator": "!contains",
        "value": ".js"
      },
      {
        "key": "ClientRequestURI",
        "operator": "!contains",
        "value": ".png"
      }
    ]
  }
}
```

### Ownership Challenge

When configuring Logpush to push to a destination you control (S3, GCS, R2, etc.), Cloudflare verifies you own the destination through an **ownership challenge**:

1. Cloudflare writes a challenge file to the destination path (e.g., `s3://your-bucket/ownership-challenge.txt`)
2. You retrieve the challenge token from the file
3. You provide the token to Cloudflare
4. Cloudflare confirms ownership and enables the job

This prevents misconfiguration from pushing logs to someone else's bucket.

### Cost Model

**Logpush charges:**
- $0.50 per million log records pushed
- Plus destination storage/ingestion costs

**Example calculation for macksportreport.com:**
- 10 million HTTP requests/month
- All fields (80+ fields) at ~500 bytes/record
- Total: 10M × $0.50/M = $5.00/month for Logpush
- Storage in R2: 10M × 500 bytes = 5 GB → 5 × $0.015/GB = $0.075/month
- Total cost: ~$5.08/month

**Cost optimization strategies:**
1. **Filter logs** — only push 400+ status codes = 10-40% of records typically
2. **Reduce fields** — select only needed fields; cuts storage cost by 50-80%
3. **Use R2** — cheapest destination at $0.015/GB vs Datadog at $1.06+/GB

### Common Logpush Patterns

#### Pattern 1: SIEM Integration (Splunk)

```
Cloudflare Edge → Logpush → Splunk HEC endpoint
```

Fields to push: all security-relevant fields (ClientIP, WAFAction, FirewallMatchesRuleIDs, BotScore, etc.)

Splunk HEC configuration in Logpush destination:
```
destination_conf = "splunk://splunk.yourdomain.com:8088?channel=CHANNEL_ID&insecure-skip-verify=false&sourcetype=cloudflare:json&header_Authorization=Splunk HEC_TOKEN"
```

#### Pattern 2: Long-Term Storage + Query (R2 + Log Explorer)

```
Cloudflare Edge → Logpush → R2 → Log Explorer / custom queries
```

This is the most cost-effective pattern for long-term retention and ad-hoc investigation.

#### Pattern 3: Real-Time APM Correlation (Datadog)

```
Cloudflare Edge → Logpush → Datadog Logs
```

Enables correlation of Cloudflare edge events with your application's Datadog APM traces. Filter to only error responses to reduce Datadog ingestion costs.

---

## Dashboard Walkthrough

### Step 1: Navigate to Logpush

macksportreport.com → Investigate → Logpush

### Step 2: Create a New Job

Click **Create a Logpush job**

### Step 3: Select Dataset

Choose **HTTP requests** for this walkthrough.

### Step 4: Configure Field Selection

The field selector shows all available fields. Best practice:
- Start with the 15-20 most important fields
- Avoid pushing all 80+ fields to control storage costs
- Essential fields for most use cases:
  - `EdgeStartTimestamp`
  - `ClientIP`
  - `ClientCountry`
  - `ClientRequestMethod`
  - `ClientRequestURI`
  - `EdgeResponseStatus`
  - `CacheCacheStatus`
  - `OriginResponseDurationMs`
  - `BotScore`
  - `WAFAction`
  - `FirewallMatchesRuleIDs`

### Step 5: Configure Filters (Optional)

Add a filter to reduce volume:
- Field: `EdgeResponseStatus`
- Operator: `≥`
- Value: `400`

This pushes only error responses — typically 5-15% of total log volume.

### Step 6: Set Destination

Choose **Cloudflare R2**:
- Bucket: `macksportreport-logs`
- Path: `http-requests/{DATE}/{JOBID}_{DATE}_{JOBID}_{FILENAME}.log.gz`

### Step 7: Complete Ownership Challenge

Cloudflare will upload a challenge file. Navigate to your R2 bucket, find the challenge file, copy the token, and paste it into the challenge form.

### Step 8: Enable the Job

Click **Enable** to start the job. Logs will begin flowing within a few minutes.

---

## Hands-On Lab

### Prerequisites

- macksportreport.com on any paid plan
- Cloudflare API token with Logs:Edit permissions
- R2 bucket or AWS S3 bucket created
- `curl` and `jq` installed

### Lab 1: List Existing Logpush Jobs

```bash
export CF_API_TOKEN="your-api-token"
export ZONE_ID="your-zone-id"

curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/logpush/jobs" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[] | {
    id: .id,
    name: .name,
    dataset: .dataset,
    enabled: .enabled,
    destination: .destination_conf,
    last_complete: .last_complete
  }'
```

### Lab 2: Check Available Fields for HTTP Requests Dataset

```bash
# List all available fields for the HTTP requests dataset
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/logpush/datasets/http_requests/fields" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result | to_entries | .[] | {field: .key, description: .value.description, type: .value.type}' | head -50
```

### Lab 3: Create a Test Logpush Job to HTTP Endpoint

```bash
# For testing, we can use a public webhook receiver like webhook.site
# Go to https://webhook.site and copy your unique URL

WEBHOOK_URL="https://webhook.site/YOUR-UNIQUE-ID"

curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/logpush/jobs" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{
    \"name\": \"test-webhook-logpush\",
    \"logpull_options\": \"fields=ClientIP,ClientCountry,ClientRequestMethod,ClientRequestURI,EdgeResponseStatus,CacheCacheStatus,BotScore&timestamps=rfc3339\",
    \"destination_conf\": \"$WEBHOOK_URL\",
    \"dataset\": \"http_requests\",
    \"enabled\": true,
    \"frequency\": \"low\"
  }" | jq '.'

# Note: HTTP endpoint destinations require ownership challenge
# Retrieve the challenge from your webhook.site console
```

### Lab 4: Parse NDJSON Log Files

```bash
# If you have a log file from Logpush (or create a sample):
cat > /tmp/sample-logpush.ndjson << 'EOF'
{"ClientIP":"203.0.113.10","ClientRequestMethod":"GET","ClientRequestURI":"/api/scores","ClientCountry":"US","EdgeResponseStatus":200,"CacheCacheStatus":"HIT","OriginResponseDurationMs":0,"BotScore":92,"WAFAction":"","EdgeStartTimestamp":"2026-06-02T10:15:00Z"}
{"ClientIP":"198.51.100.55","ClientRequestMethod":"POST","ClientRequestURI":"/api/auth","ClientCountry":"CN","EdgeResponseStatus":403,"CacheCacheStatus":"BYPASS","OriginResponseDurationMs":0,"BotScore":8,"WAFAction":"block","EdgeStartTimestamp":"2026-06-02T10:15:01Z"}
{"ClientIP":"192.0.2.100","ClientRequestMethod":"GET","ClientRequestURI":"/home","ClientCountry":"GB","EdgeResponseStatus":200,"CacheCacheStatus":"MISS","OriginResponseDurationMs":145,"BotScore":86,"WAFAction":"","EdgeStartTimestamp":"2026-06-02T10:15:02Z"}
{"ClientIP":"192.0.2.101","ClientRequestMethod":"GET","ClientRequestURI":"/api/scores","ClientCountry":"US","EdgeResponseStatus":500,"CacheCacheStatus":"BYPASS","OriginResponseDurationMs":3200,"BotScore":94,"WAFAction":"","EdgeStartTimestamp":"2026-06-02T10:15:05Z"}
EOF

echo "=== All requests ==="
cat /tmp/sample-logpush.ndjson | jq -s '.'

echo ""
echo "=== Blocked requests (WAF action = block) ==="
cat /tmp/sample-logpush.ndjson | jq 'select(.WAFAction == "block")'

echo ""
echo "=== Error responses (status >= 400) ==="
cat /tmp/sample-logpush.ndjson | jq 'select(.EdgeResponseStatus >= 400)'

echo ""
echo "=== Cache hit rate ==="
cat /tmp/sample-logpush.ndjson | jq -s '
  {
    total: length,
    hits: [.[] | select(.CacheCacheStatus == "HIT")] | length,
    hit_rate_pct: ([.[] | select(.CacheCacheStatus == "HIT")] | length) * 100.0 / length
  }'
```

### Lab 5: Cost Estimation Calculator

```bash
# Estimate monthly Logpush cost based on your zone's traffic
export DAILY_REQUESTS=100000   # estimated daily request count
export FIELD_COUNT=15          # number of fields you plan to push
export AVG_FIELD_BYTES=15      # average bytes per field value

MONTHLY_REQUESTS=$((DAILY_REQUESTS * 30))
MONTHLY_LOGPUSH_COST=$(echo "scale=2; $MONTHLY_REQUESTS * 0.50 / 1000000" | bc)
MONTHLY_STORAGE_GB=$(echo "scale=4; $MONTHLY_REQUESTS * $FIELD_COUNT * $AVG_FIELD_BYTES / 1073741824" | bc)
MONTHLY_R2_COST=$(echo "scale=4; $MONTHLY_STORAGE_GB * 0.015" | bc)

echo "=== Logpush Cost Estimate ==="
echo "Daily requests: $DAILY_REQUESTS"
echo "Monthly requests: $MONTHLY_REQUESTS"
echo ""
echo "Logpush records cost: \$$MONTHLY_LOGPUSH_COST/month"
echo "R2 storage (${MONTHLY_STORAGE_GB} GB): \$$MONTHLY_R2_COST/month"
echo "Total estimated: \$$(echo "scale=2; $MONTHLY_LOGPUSH_COST + $MONTHLY_R2_COST" | bc)/month"
echo ""
echo "With filter (only errors ~10%): \$$(echo "scale=2; ($MONTHLY_LOGPUSH_COST + $MONTHLY_R2_COST) * 0.10" | bc)/month"
```

---

## Demo Script (2 Minutes)

**Setup:** Logpush job configuration screen open. Also have a log file sample ready (or the NDJSON from Lab 4).

---

"For any enterprise customer with a SIEM or compliance requirement, Logpush is how Cloudflare integrates into your existing observability stack.

[Show the job configuration screen]

Every 30-60 seconds, Cloudflare batches the last minute of log data and pushes it here — to R2, S3, Splunk, Datadog, whatever you use. You see every request: the IP, the country, the URL, the status code, the cache status, whether it hit a WAF rule, the bot score — all of it.

[Show the field selector]

And you only pay for what you need. We have 80+ fields available, but most teams only care about 15-20 fields. By selecting only those fields, you cut your storage cost by 80%. For a site with 10 million requests per month, we're talking $5/month for Logpush delivery, maybe another $0.10 for R2 storage. The full log pipeline for pennies.

[Show filter option]

If you only care about errors and security events, add this filter: EdgeResponseStatus >= 400. Now you're only pushing error logs — maybe 10% of total volume. Same $5/month becomes $0.50/month.

[Show NDJSON sample]

The format is NDJSON — one JSON object per request per line. Your SIEM can ingest this natively. Your data team can query it with SQL. And if you want interactive investigation, Log Explorer reads these same logs directly. 

Splunk costs averaging $100/GB ingested? Logpush lets you filter your logs down to the security-relevant 1% before it ever touches Splunk. That's a real cost conversation with a customer's CFO."

---

## Competitive Context

| Feature | Cloudflare Logpush | AWS CloudFront Real-Time Logs | Fastly Real-Time Log Streaming | Akamai DataStream |
|---------|-------------------|-------------------------------|-------------------------------|------------------|
| **Delivery latency** | 30-60 seconds | <1 second | <1 second | Minutes |
| **Format** | NDJSON, CSV | Apache Combined Log (NCSA) | Syslog, custom | JSON |
| **Destinations** | 10+ (R2, S3, Splunk, DD, etc.) | Kinesis, S3 | S3, GCS, Azure, Splunk, etc. | S3, GCS, Splunk, etc. |
| **Field selection** | Yes (80+ available) | Yes (subset) | Yes | Yes |
| **Filter by field** | Yes | No | Limited | Limited |
| **Security event logs** | Yes (WAF, Bot, Rate Limit) | Separate WAF logs | Separate product | Separate |
| **Workers logs** | Yes | N/A | N/A | N/A |
| **Cost** | $0.50/M records | $0.01/1000 records | Included in plan | Enterprise |
| **Ownership verification** | Yes | Yes (pre-signed URL) | No | Yes |

---

## Self-Check Questions

**Question 1:** A customer wants to push all Cloudflare HTTP request logs to Splunk, but their security team estimates it would cost $50,000/year in Splunk ingestion. Walk through two strategies to reduce the Logpush data volume without losing critical security visibility.

```
Your answer:




```

---

**Question 2:** What is the ownership challenge in Logpush, what problem does it solve, and what would happen if this verification step didn't exist?

```
Your answer:




```

---

**Question 3:** A customer wants to calculate their exact Logpush cost for a zone that receives 50 million requests per month. They want to push all 80 fields to S3, with no filter. What is the monthly cost for Logpush delivery only (not S3 storage)?

```
Your answer:




```

---

**Question 4:** Explain the difference between `http_requests` and `firewall_events` datasets in Logpush. If a WAF rule blocks a request, in which dataset(s) does it appear?

```
Your answer:




```

---

**Question 5:** A customer is using Logpush to send HTTP request logs to S3, and they notice that logs arrive in batches with a 5-minute delay. They expected near real-time streaming. What is the technical explanation, and what Logpush configuration controls the delivery frequency?

```
Your answer:




```

---

## Sources

- [Cloudflare Logpush Documentation](https://developers.cloudflare.com/logs/logpush/)
- [Logpush Destinations Reference](https://developers.cloudflare.com/logs/logpush/logpush-configuration-api/understanding-logpush-api/)
- [HTTP Requests Log Fields](https://developers.cloudflare.com/logs/reference/log-fields/zone/http_requests/)
- [Logpush Filters](https://developers.cloudflare.com/logs/reference/filters/)
- [Logpush to R2](https://developers.cloudflare.com/logs/logpush/r2/)
- [Logpush to Splunk](https://developers.cloudflare.com/logs/logpush/splunk/)
- [Logpush to Datadog](https://developers.cloudflare.com/logs/logpush/datadog/)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
