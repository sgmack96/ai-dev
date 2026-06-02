# Module 3.2 — Security Analytics
> Dashboard Location: macksportreport.com → Security → Analytics | Estimated Time: 90 minutes | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is Security Analytics?

Security Analytics is Cloudflare's security-specific traffic analysis tool. It gives you two related but distinct views into your traffic:

1. **Security Events** — a log of every request that matched a security rule (WAF rule, rate limit, custom firewall rule) and received a non-default action (block, challenge, log, JS challenge)
2. **Security Analytics** — a broader view of ALL HTTP traffic through a security lens, showing what percentage of traffic is bot traffic, what countries it comes from, what actions were taken, and what the traffic composition looks like

**The critical distinction** (frequently asked in customer conversations):

| | Security Events | Security Analytics |
|-|----------------|-------------------|
| **Scope** | Only requests that matched a rule | All HTTP requests |
| **Depth** | Full rule match detail (which rule, which field matched) | Aggregated traffic analysis |
| **Use Case** | "What rule fired?" / Forensics | "What does my traffic look like?" / Trend analysis |
| **Latency** | Near real-time | Near real-time (some aggregation delay) |
| **Retention** | 30 days (Pro/Business), up to 90 days (Enterprise) | Same retention periods |
| **Log Volume** | Sampled on high-volume zones (Free/Pro) | Aggregated (not sampled) |

### Sampled vs. Full Logs

This is a common point of confusion and customer frustration. Cloudflare log delivery varies by plan:

**Free Plan:**
- Security Events: 1% sample rate on very high traffic zones
- No log export (no Logpush, no Workers for Logs)
- Dashboard shows sampled events — may miss individual attacks

**Pro Plan:**
- Security Events: Higher sample rate, dashboard-only
- No Logpush access
- Adequate for most small sites

**Business Plan:**
- Security Events: Full logs available in dashboard
- Logpush available (push to S3, Splunk, Datadog, etc.)
- 30-day retention

**Enterprise Plan:**
- Full logs, all events, no sampling
- Logpush with extended fields
- 90-day retention in some configurations
- HTTP Request logs (every single request, not just security events)

**Important SE talking point:** When a customer says "I don't see the attack in my logs," the answer may be that they're on Free/Pro and the event was in the sampled-out portion. Upgrading to Business unlocks full log fidelity.

### Security Events — What Gets Logged

Every request that matches a security rule and receives an action gets logged as a Security Event. The event record includes:

- **Timestamp** — when the request was received
- **Action** — Block, Challenge, JS Challenge, Managed Challenge, Log, Allow (skip)
- **Rule ID** — which rule matched (e.g., `100014` = SQLi rule in Cloudflare Managed Ruleset)
- **Rule Message** — human-readable description (e.g., "SQL Injection - UNION based")
- **Source** — which product fired (WAF Managed Rules, Custom Rules, Rate Limiting, Bot Management)
- **IP Address** — visitor's IP
- **Country** — GeoIP-resolved country
- **User Agent** — browser/bot identifier
- **Method** — GET, POST, PUT, DELETE, etc.
- **URI** — full path and query string
- **Host** — hostname of the request
- **ASN** — Autonomous System Number (useful for identifying hosting providers, VPNs, botnets)
- **Ray ID** — Cloudflare's unique request identifier (critical for cross-system debugging)

### Filter Dimensions

Security Events and Analytics support filtering on multiple dimensions simultaneously:

| Dimension | Example Values | Use Case |
|-----------|---------------|----------|
| **Action** | block, challenge, managed_challenge, js_challenge, log | Find only blocked requests |
| **Rule ID** | 100014, cf.100014 | Find all events from a specific WAF rule |
| **Rule Message** | "SQL Injection", "XSS" | Find attack type |
| **IP** | 1.2.3.4 | Investigate a specific attacker |
| **Country** | US, CN, RU | Geographic analysis |
| **ASN** | AS4837, AS15169 | Identify hosting providers or ISPs |
| **User Agent** | Contains "python", "sqlmap" | Find automated tools |
| **URI** | /wp-admin, /login | Find targeted paths |
| **Method** | POST, OPTIONS | Unusual method analysis |
| **Source** | managed rules, custom rule, rate limit | Which security product fired |
| **Host** | macksportreport.com | Multi-zone accounts |
| **Ref Header** | Contains "evil-site.com" | Referrer-based filtering |

### Timeline Chart Reading

The Security Events timeline is a bar chart where:
- **X-axis** = time (bucket size adjusts based on selected window)
- **Y-axis** = count of security events
- **Color coding** = different actions (blue=block, orange=challenge, green=log)

**Reading spikes:**
- A sudden narrow spike = volumetric attack (many requests in a short period)
- A gradual increase = slow attack or growing botnet
- Recurring spikes at regular intervals = scheduled script or crawler
- Spike correlating with a deployment = likely false positive from new code

**How to investigate a spike:**
1. Click and drag on the timeline to zoom into the spike window
2. Look at the "Top Rules" section — which rule fired most?
3. Look at "Top IPs" — is it one IP (targeted) or many (distributed)?
4. Look at "Top Countries" — geographic concentration suggests botnet or nation-state
5. Check "Top URIs" — what paths were targeted?
6. Cross-reference with the origin's response code — did attacks succeed?

### How to Use Security Analytics for Forensics

**Incident Response Playbook:**

1. **Timeline first:** Navigate to Security → Analytics, set time range to include the incident window
2. **Identify the anomaly:** Look for spikes in the timeline
3. **Zoom in:** Click-drag to focus on the spike period
4. **Filter by action:** First filter for "Block" to see what was stopped
5. **Filter by source:** Which security product caught it (WAF? Rate Limit? Bot?)
6. **Examine top IPs:** Single IP = targeted attack; many IPs = DDoS/botnet
7. **Examine top URIs:** What were they targeting?
8. **Check rule messages:** What type of attack (SQLi, XSS, path traversal)?
9. **Export for SIEM:** If Enterprise, export via Logpush or GraphQL API
10. **Correlate with origin:** Check origin server logs — did any attacks get through before rules were triggered?

### GraphQL API for Bulk Export

For Enterprise customers who need to pull security data into their SIEM, Cloudflare exposes a GraphQL API at `https://api.cloudflare.com/client/v4/graphql`.

**Key dataset names for security analytics:**
- `firewallEventsAdaptive` — security events with adaptive sampling
- `firewallEventsAdaptiveGroups` — aggregated security event data
- `httpRequestsAdaptiveGroups` — all HTTP traffic data
- `httpRequests1mGroups` — 1-minute aggregated HTTP data

---

## Deep Dive (Architect-Level)

### Security Analytics Data Pipeline

Understanding how Cloudflare collects and surfaces security analytics data helps explain latency and sampling behavior.

**Data flow:**
```
Request → Edge PoP → Security Processing → Event Generated
   ↓
Clickhouse (Cloudflare's analytics database)
   ↓
GraphQL API → Dashboard
   ↓
Logpush (if configured) → Customer SIEM
```

Cloudflare uses a distributed ClickHouse cluster for analytics storage. This is why:
- Aggregated analytics are available within 1–2 minutes
- The dashboard shows near-real-time data (not batch)
- Very large datasets use adaptive sampling to keep query performance acceptable

### Adaptive Sampling

At very high traffic volumes, Cloudflare uses **adaptive sampling** to maintain query performance. The sampling rate automatically adjusts:
- Low traffic zones: 100% of events shown
- Medium traffic zones: Higher sample rates (e.g., 10% of events)
- Very high traffic zones: Lower sample rates to keep queries fast

The dashboard displays a notice when sampling is active. Sampled data is still statistically representative — if 0.5% of events are SQLi attacks, the sample will show ~0.5% SQLi too.

**Important:** Logpush (Enterprise) bypasses sampling — you get every event. This is why Enterprise is critical for security teams doing precise forensics.

### GraphQL Security Events Query

```graphql
# Query security events for macksportreport.com in the last 1 hour
query {
  viewer {
    zones(filter: { zoneTag: "YOUR_ZONE_ID" }) {
      firewallEventsAdaptive(
        filter: {
          datetime_geq: "2026-05-28T10:00:00Z"
          datetime_leq: "2026-05-28T11:00:00Z"
        }
        limit: 100
        orderBy: [datetime_DESC]
      ) {
        action
        clientASNDescription
        clientAsn
        clientCountryName
        clientIP
        clientRequestHTTPHost
        clientRequestHTTPMethodName
        clientRequestHTTPProtocol
        clientRequestPath
        clientRequestQuery
        datetime
        rayName
        ruleId
        source
        userAgent
        matchIndex
        metadata {
          key
          value
        }
      }
    }
  }
}
```

**Running the query:**
```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ viewer { zones(filter: { zoneTag: \"'${ZONE_ID}'\" }) { firewallEventsAdaptive(filter: { datetime_geq: \"2026-05-28T10:00:00Z\", datetime_leq: \"2026-05-28T11:00:00Z\" }, limit: 10, orderBy: [datetime_DESC]) { action clientIP clientRequestPath ruleId source datetime } } } }"
  }' | python3 -m json.tool
```

### GraphQL Aggregated Security Analytics Query

```graphql
# Get top blocked IPs with counts
query {
  viewer {
    zones(filter: { zoneTag: "YOUR_ZONE_ID" }) {
      firewallEventsAdaptiveGroups(
        filter: {
          datetime_geq: "2026-05-28T00:00:00Z"
          datetime_leq: "2026-05-28T23:59:59Z"
          action_in: ["block", "challenge", "managed_challenge"]
        }
        limit: 20
        orderBy: [count_DESC]
      ) {
        count
        dimensions {
          clientIP
          clientCountryName
          action
        }
      }
    }
  }
}
```

### Logpush Configuration for Security Events

Logpush is the mechanism that streams logs from Cloudflare to an external destination in real-time.

**Supported destinations:**
- Amazon S3 / S3-compatible (R2, Backblaze)
- Google Cloud Storage
- Azure Blob Storage
- Datadog
- Splunk HEC
- New Relic
- Sumo Logic
- HTTP endpoint (webhook-style)

**Create a Logpush job via API:**
```bash
# Create Logpush job for Firewall Events to S3
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/logpush/jobs" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "security-events-to-s3",
    "destination_conf": "s3://my-bucket/cloudflare-logs?region=us-east-1&sse=AES256",
    "dataset": "firewall_events",
    "logpull_options": "fields=Action,ClientASN,ClientAsn,ClientCountry,ClientIP,ClientIPClass,ClientRefererHost,ClientRefererPath,ClientRefererQuery,ClientRefererScheme,ClientRequestBytes,ClientRequestHost,ClientRequestMethod,ClientRequestPath,ClientRequestProtocol,ClientRequestQuery,ClientRequestScheme,ClientRequestUserAgent,Datetime,EdgeColoCode,EdgeResponseStatus,Kind,MatchIndex,Metadata,OriginResponseStatus,OriginatorRayID,RayID,RuleID,RuleMessage,Source,ZoneName",
    "enabled": true
  }'
```

**Security Events fields available in Logpush:**
```
Action, ClientASN, ClientAsn, ClientCountry, ClientIP, ClientIPClass,
ClientRefererHost, ClientRefererPath, ClientRefererQuery, ClientRefererScheme,
ClientRequestBytes, ClientRequestHost, ClientRequestMethod, ClientRequestPath,
ClientRequestProtocol, ClientRequestQuery, ClientRequestScheme,
ClientRequestUserAgent, Datetime, EdgeColoCode, EdgeResponseStatus,
Kind, MatchIndex, Metadata, OriginResponseStatus, OriginatorRayID,
RayID, RuleID, RuleMessage, Source, ZoneName
```

### Security Event Ray ID — Cross-System Correlation

Every Cloudflare request gets a **Ray ID** — a globally unique identifier formatted as a 16-character hex string (e.g., `8a4c3d2e1f5b6789`).

The Ray ID is:
- Returned in the `CF-Ray` HTTP response header
- Logged in Security Events
- Logged in HTTP Request logs (Logpush)
- Logged in origin server access logs (if the request reached origin)
- Visible in the customer-facing error page when a request is blocked

**Forensic workflow using Ray ID:**
1. Customer reports: "I was blocked at 2:34 PM, Ray ID shows 8a4c3d2e1f5b6789"
2. In Security Analytics → search by Ray ID
3. Find the exact event: which rule fired, what the request looked like
4. Determine if it was a false positive or legitimate block
5. If false positive: identify which field matched and adjust the rule

```bash
# Look up a specific Ray ID via GraphQL
curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ viewer { zones(filter: { zoneTag: \"'${ZONE_ID}'\" }) { firewallEventsAdaptive(filter: { rayName: \"8a4c3d2e1f5b6789\" }, limit: 1) { action ruleId source clientIP clientRequestPath datetime } } } }"
  }'
```

---

## Dashboard Walkthrough

### Navigating to Security Analytics

1. dash.cloudflare.com → macksportreport.com → **Security** → **Analytics**

### Security Analytics Page Layout

**Tab 1: Security Analytics (Traffic View)**
Shows all HTTP traffic, not just security events. Key sections:
- **Traffic summary cards:** Total requests, bot traffic %, human traffic %
- **Traffic over time:** Stacked area chart (green=human, orange=bot, red=blocked)
- **Bot vs Human breakdown:** Pie chart
- **Top countries by traffic:** Table
- **Top ASNs:** Table

This view answers: "What percentage of my traffic is automated? Which bots are visiting?"

**Tab 2: Security Events**
Shows only requests that matched security rules:
- **Events timeline:** Bar chart colored by action type
- **Filter bar:** Multi-dimensional filtering
- **Events table:** Individual event records
- **Aggregation panel:** Top IPs, countries, URIs, rules, user agents

### Using the Filter Bar

The filter bar is the most powerful part of Security Events. How to use it:

1. Click **+ Add filter**
2. Select a dimension from the dropdown (Action, Rule ID, Country, etc.)
3. Select an operator (equals, contains, does not equal)
4. Enter a value
5. Click **Apply**

**Stacking multiple filters:**
- All filters are ANDed together by default
- Example: Action=block AND Country=CN shows all blocked requests from China
- To simulate OR: remove the filter and use the "Top" view to compare

**Saving filter presets:**
Currently the dashboard does not have persistent saved filters. For automation, use the GraphQL API with parameterized queries stored in your SIEM.

### Investigating a Specific Event

1. In the Events table, click any row to expand it
2. Expanded view shows:
   - Full request details (method, path, host, UA, IP, country, ASN)
   - Matched rule ID and message
   - Rule source (which product)
   - Ray ID (for cross-referencing)
   - Option to "Create a WAF skip rule" (false positive quick fix)
   - Option to "Block this IP" (adds to IP list)

### Exporting Security Events

**Dashboard Export:**
- Security → Security Events → click **Export** button
- Downloads a CSV of the currently filtered view (up to 5,000 events)
- Useful for ad-hoc analysis in Excel/Sheets

**API Export (bulk):**
Use GraphQL for larger datasets. See the Deep Dive section for query examples.

**Logpush (continuous):**
For ongoing SIEM integration, configure Logpush once and all events stream continuously.

---

## Hands-On Lab

### Lab 2.1 — Generate Security Events

First, create a test WAF rule that logs (doesn't block) to generate events:

```bash
# Create a custom rule that LOGS requests to /test-security-analytics
# This lets us generate security events safely
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint/rules" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "log",
    "expression": "http.request.uri.path eq \"/test-security-analytics\"",
    "description": "Lab 2.1 - Log test path for analytics",
    "enabled": true
  }'
```

Now generate some test events:
```bash
# Generate 10 logged requests to trigger security events
for i in {1..10}; do
  curl -s -o /dev/null -w "Request $i: HTTP %{http_code}\n" \
    "https://macksportreport.com/test-security-analytics"
  sleep 1
done
```

Navigate to Security → Security Events and find the 10 logged events.

### Lab 2.2 — Query Security Events via GraphQL API

```bash
# Get the last 20 security events
QUERY='{"query":"{ viewer { zones(filter: { zoneTag: \"'${ZONE_ID}'\" }) { firewallEventsAdaptive(filter: { datetime_geq: \"2026-05-01T00:00:00Z\" }, limit: 20, orderBy: [datetime_DESC]) { action clientIP clientRequestPath ruleId source datetime rayName } } } }"}'

curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${QUERY}" | python3 -m json.tool
```

### Lab 2.3 — Get Aggregated Event Counts by Country

```bash
# Get blocked event counts grouped by country (last 24h)
START=$(date -u -d "24 hours ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v-24H +"%Y-%m-%dT%H:%M:%SZ")
END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

QUERY='{"query":"{ viewer { zones(filter: { zoneTag: \"'${ZONE_ID}'\" }) { firewallEventsAdaptiveGroups(filter: { datetime_geq: \"'${START}'\", datetime_leq: \"'${END}'\" }, limit: 20, orderBy: [count_DESC]) { count dimensions { clientCountryName action } } } } }"}'

curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${QUERY}" | python3 -m json.tool
```

### Lab 2.4 — Simulate Incident Response

Simulate finding a suspicious IP in analytics:

```bash
# Step 1: Find top IPs in security events
QUERY='{"query":"{ viewer { zones(filter: { zoneTag: \"'${ZONE_ID}'\" }) { firewallEventsAdaptiveGroups(filter: { datetime_geq: \"2026-05-01T00:00:00Z\" }, limit: 10, orderBy: [count_DESC]) { count dimensions { clientIP clientCountryName } } } } }"}'

curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${QUERY}" | python3 -m json.tool

# Step 2: If you find a suspicious IP (e.g., 1.2.3.4), look at all events from it
# Replace 1.2.3.4 with an IP from your results
SUSPECT_IP="1.2.3.4"
QUERY='{"query":"{ viewer { zones(filter: { zoneTag: \"'${ZONE_ID}'\" }) { firewallEventsAdaptive(filter: { clientIP: \"'${SUSPECT_IP}'\", datetime_geq: \"2026-05-01T00:00:00Z\" }, limit: 50, orderBy: [datetime_DESC]) { action clientIP clientRequestPath ruleId source datetime userAgent } } } }"}'

curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${QUERY}" | python3 -m json.tool
```

### Lab 2.5 — Clean Up Test Rule

```bash
# List all custom rules to find the rule ID for the test rule
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" | python3 -m json.tool

# Delete the test rule (replace RULE_ID with actual ID from above)
RULE_ID="your_rule_id_here"
RULESET_ID="your_ruleset_id_here"

curl -X DELETE \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules/${RULE_ID}" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json"
```

---

## Demo Script (2 Minutes)

**Opening (15 seconds):**
"When something goes wrong — a spike in attacks, a false positive complaint, a compliance audit — this is where you start: Security Analytics."

**Security Events Demo (45 seconds):**
"Every request that matched a security rule ends up here. I can filter by any combination of fields — let's say I want to see all blocked requests from Russia in the last 7 days. [Apply filters] There — 847 blocked requests. I can click any of them to see exactly what the request looked like, which WAF rule fired, and the Ray ID that links this to every other log in your system."

**Timeline Walkthrough (30 seconds):**
"See this spike on Tuesday at 2 PM? That was an attack. I can click and drag right here to zoom in. Now I see it was 3,400 requests over 12 minutes. All SQLi attempts. All blocked. All from one ASN in Ukraine. [Show Top IPs filtered to that spike window]"

**API/Export Demo (30 seconds):**
"If you're feeding this into Splunk or Datadog, we have a GraphQL API and continuous log streaming via Logpush. Your SIEM gets every event in real time. Your security team doesn't have to log into the Cloudflare dashboard — the data flows to wherever they already work."

---

## Competitive Context

| Feature | Cloudflare | AWS WAF + CloudWatch | Akamai | Fastly |
|---------|-----------|----------------------|--------|--------|
| **Real-time security events** | Yes, ~1 min delay | CloudWatch Logs, 5–10 min delay | Yes, proprietary | Yes |
| **Ray ID correlation** | Yes, across all CF products | No global request ID | No | Limited |
| **GraphQL API** | Yes, full analytics access | CloudWatch Logs Insights | No | Limited |
| **Logpush destinations** | 10+ (S3, Splunk, DD, NR, etc.) | CloudWatch → custom export | SIEM connectors (expensive) | Limited |
| **Sampling disclosure** | Dashboard shows when sampling | Often hidden | Often hidden | No sampling info |
| **False positive quick fix** | 1-click skip rule from event | Manual WAF rule creation | Manual | Manual |
| **Bot vs human traffic view** | Yes (Security Analytics tab) | Not built-in (needs Shield Advanced) | Yes (Bot Manager) | Basic |
| **Free tier logging** | Yes (sampled) | Pay per query | No free tier | No free tier |
| **Geographic threat map** | Yes, interactive | CloudWatch + QuickSight (setup required) | Yes | No |
| **Incident response playbook** | Built-in drill-down workflow | DIY | Yes (with support) | DIY |

---

## Self-Check Questions

**Question 1:** What is the difference between Security Events and Security Analytics? A customer asks "I want to see ALL my traffic, not just attacks." Which tab do you send them to?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 2:** A customer on the Pro plan says "I'm getting attacked and I can only see 47 events in my Security Events log, but traffic is clearly much higher." What is happening?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 3:** Write a GraphQL query that retrieves the top 10 source countries for blocked traffic in the last 24 hours. What dataset and filter would you use?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 4:** A legitimate user complains they were blocked. They provide you with their Ray ID (`abc123def456789a`). Walk through the exact steps to find the specific event and determine if it was a false positive.

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 5:** What is Logpush, who needs it, and what are three destinations it can ship security events to?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

---

## Sources

- [Security Analytics — Cloudflare Docs](https://developers.cloudflare.com/waf/analytics/)
- [Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)
- [Cloudflare GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/)
- [Logpush Overview](https://developers.cloudflare.com/logs/about/)
- [Logpush Destinations](https://developers.cloudflare.com/logs/get-started/enable-destinations/)
- [Firewall Events Dataset (GraphQL)](https://developers.cloudflare.com/analytics/graphql-api/features/data-sets/)
- [Logpush Job API](https://developers.cloudflare.com/api/operations/logpush-jobs-create-logpush-job)
- [HTTP Request Fields for Logpush](https://developers.cloudflare.com/logs/reference/log-fields/zone/firewall_events/)
- [Adaptive Bit Rate Sampling](https://developers.cloudflare.com/analytics/graphql-api/sampling/)
