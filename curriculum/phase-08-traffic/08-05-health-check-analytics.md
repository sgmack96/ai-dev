# Module 8.5 — Health Check Analytics
> Dashboard Location: macksportreport.com → Traffic → Health Check Analytics
> Estimated Time: 40 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is Health Check Analytics?

Health Check Analytics is the historical data layer for both standalone Health Checks and Load Balancing monitors. While the Health Checks page shows you current status (is it healthy right now?), Health Check Analytics shows you the complete history: when was it healthy, when did it fail, how fast was it responding, and what caused each failure.

**Three key use cases:**

1. **Incident post-mortem:** "Our site had issues last Tuesday at 6 PM. When did our origin start failing health checks? Was that before or after users noticed?"

2. **Performance trend analysis:** "Our origin is technically passing health checks, but response times have been creeping up over the last two weeks. When does 'slow' become 'about to fail'?"

3. **Failure mode classification:** "The health check is failing. Is it a timeout (overloaded origin), a bad status code (application error), or a body mismatch (application returned wrong response)?"

### Why This Is More Than Just Uptime Numbers

Most uptime monitors give you a binary: up or down, and a percentage. Health Check Analytics gives you richer data:

**Response time over time** — A health check with 99.9% uptime but 4.8-second response times (close to your 5-second timeout) is quietly telling you the origin is struggling. The binary uptime number hides this.

**Failure reason classification** — Knowing *why* it failed is as important as knowing *that* it failed. Each failure mode suggests a different root cause:

| Failure Type | Likely Cause |
|-------------|--------------|
| Connection timeout | Origin unreachable (network, firewall, down) |
| Connection refused | Origin port closed (process crashed, wrong port) |
| HTTP 500 | Application-level error |
| HTTP 502 | Upstream proxy/LB failure |
| HTTP 503 | Service unavailable (origin load shedding) |
| Body mismatch | Application logic changed, returning different content |
| SSL/TLS error | Certificate expired or misconfigured |

**Geographic health** — If the check fails from NEAS (Northeast Asia) but passes from WNAM and WEU, that's a regional network issue, not an origin failure. Without per-region analytics, you'd see "1 out of 3 regions failing" and not know if it's your origin or a Cloudflare path issue.

---

## Deep Dive (Architect-Level)

### Analytics Data Model

Health Check Analytics exposes:

**Per-check time series:**
- `success`: boolean (check passed/failed)
- `timestamp`: when the probe ran
- `origin_response_time_ms`: time from connection to last byte
- `tcp_connection_time_ms`: time to establish TCP connection
- `dns_resolution_time_ms`: time to resolve hostname (if using domain, not IP)
- `tls_handshake_time_ms`: time for TLS negotiation
- `failure_reason`: enumerated failure type (timeout, bad_status, body_mismatch, etc.)
- `response_code`: HTTP status code received (if connection succeeded)
- `check_region`: which CF region ran this check

**Aggregated metrics:**
- Uptime percentage over configurable windows (1h, 24h, 7d, 30d)
- Average/P50/P95/P99 response time
- Failure count by reason
- Mean Time To Recovery (MTTR) per incident

### Response Time Decomposition

Understanding what each time component tells you:

```
Total TTFB = DNS resolution + TCP connect + TLS handshake + Time to first byte

dns_resolution_time_ms:  High → DNS TTL too long, DNS server slow, DNSSEC issues
tcp_connection_time_ms:  High → Network path congestion, high RTT, firewall throttling
tls_handshake_time_ms:   High → Large cert chain, OCSP stapling issues, slow crypto
origin_response_time_ms: High → Application is slow (DB query, computation, I/O)
```

**Using this for capacity planning:**

If `tcp_connection_time_ms` is consistently 50ms+ from WNAM probes to a US-East origin, the TCP handshake alone is taking too long. This suggests the origin is not in an optimal location relative to Cloudflare's probe PoPs, or there's routing congestion. This is exactly the scenario where Argo Smart Routing would help — the health check's timing data becomes a justification for enabling Argo.

If `origin_response_time_ms` has been trending up from 200ms to 800ms over two weeks, the application is slowing down. This happens before the actual outage — database query time increasing, connection pool exhaustion approaching, slow memory leak. The trend is the signal.

### Failure Pattern Recognition

**Transient failures (false positives):**
```
OK → FAIL → OK → OK → OK → OK
```
Single failure followed by immediate recovery. Usually a momentary network blip, not an origin issue. Configure `consecutive_down = 2` to ignore these.

**True outage:**
```
OK → FAIL → FAIL → FAIL → FAIL → FAIL → OK
```
Multiple consecutive failures followed by sustained recovery. Actual origin issue. This is when you want alerts.

**Recurring failures at specific times:**
```
Time:   00:00 06:00 12:00 18:00 00:00
Status: OK    OK    FAIL  OK    OK
```
Daily pattern suggests a scheduled job, cron task, or backup process that overloads the origin at noon UTC. Investigate what runs at that time.

**Degraded performance without outage:**
```
Response time: 200ms → 300ms → 400ms → 800ms → [timeout]
```
Gradual degradation leading to timeout. Classic memory leak, database query regression, or gradual resource exhaustion. The trend in response time is the early warning you need to investigate before the outage.

### Using Analytics for SLA Reporting

Many customers need to report uptime SLAs to their own clients. Health Check Analytics provides:

```python
# Calculate SLA from health check data
checks = [
  # list of {timestamp, success, response_time_ms}
]

total_checks = len(checks)
successful_checks = sum(1 for c in checks if c['success'])
uptime_pct = (successful_checks / total_checks) * 100

# SLA thresholds
sla_99_9 = 99.9  # 8.7 hours/year downtime allowed
sla_99_5 = 99.5  # 43.8 hours/year downtime allowed
sla_99_0 = 99.0  # 87.6 hours/year downtime allowed

print(f"Measured uptime: {uptime_pct:.3f}%")
print(f"SLA 99.9%: {'MET' if uptime_pct >= sla_99_9 else 'MISSED'}")
```

**Caution:** Health check analytics should supplement, not replace, proper SLA monitoring tools. Health checks run from Cloudflare's infrastructure — they might show "healthy" even when real users can't access the site (e.g., if the issue is between the user and Cloudflare, not between Cloudflare and the origin).

---

## Dashboard Walkthrough

**Navigation:** macksportreport.com → Traffic → Health Checks → click on a specific check → Analytics tab

### Analytics View Sections

**Uptime Summary:**
- Percentage uptime for selected time window
- Total checks run vs total failures
- Last failure timestamp

**Response Time Chart:**
- Line chart of `origin_response_time_ms` over time
- Threshold line at your configured timeout
- Color coding: green (fast), yellow (moderate), red (near timeout)

**Failure Timeline:**
- Red markers on the timeline for each failure event
- Click on a failure: see the exact `failure_reason` and `response_code`
- Grouped by "incident" (consecutive failures) for readability

**Per-Region Breakdown:**
- For multi-region checks: status by region
- Helps distinguish origin failures from regional network issues

---

## Hands-On Lab

### Lab 1: Query Health Check Results via GraphQL

```bash
# Cloudflare's analytics API is GraphQL-based
# Query health check metrics for the last 24 hours

curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"
      {
        viewer {
          zones(filter: {zoneTag: \\\"${ZONE_ID}\\\"}) {
            healthCheckEvents(
              limit: 100,
              filter: {
                datetime_geq: \\\"$(date -v-24H -u +%Y-%m-%dT%H:%M:%SZ)\\\",
                datetime_leq: \\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\\"
              },
              orderBy: [datetime_DESC]
            ) {
              datetime
              healthCheckId
              healthCheckName
              originIp
              originPort
              region
              failureReason
              rttMs {
                value
              }
            }
          }
        }
      }
    \"
  }" | jq '.data.viewer.zones[0].healthCheckEvents[:20]'
```

### Lab 2: Calculate Uptime from Analytics Data

```bash
# Fetch all check results and calculate uptime percentage
curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "query": "{ viewer { zones(filter: {zoneTag: \"'${ZONE_ID}'\"}) { healthCheckEvents(limit: 10000, filter: { datetime_geq: \"'$(date -v-7d -u +%Y-%m-%dT%H:%M:%SZ)'\" }) { healthCheckName failureReason } } } }"
  }' > /tmp/hc_events.json

# Calculate statistics
python3 << 'EOF'
import json

with open('/tmp/hc_events.json', 'r') as f:
    data = json.load(f)

events = data['data']['viewer']['zones'][0].get('healthCheckEvents', [])
total = len(events)
failures = sum(1 for e in events if e.get('failureReason'))
successes = total - failures

if total > 0:
    uptime = (successes / total) * 100
    print(f"Total checks: {total}")
    print(f"Successful: {successes}")
    print(f"Failed: {failures}")
    print(f"Uptime: {uptime:.3f}%")

    # Failure breakdown
    reasons = {}
    for e in events:
        if e.get('failureReason'):
            reason = e['failureReason']
            reasons[reason] = reasons.get(reason, 0) + 1

    print("\nFailure breakdown:")
    for reason, count in sorted(reasons.items(), key=lambda x: x[1], reverse=True):
        print(f"  {reason}: {count}")
else:
    print("No events found in the specified time range")
EOF
```

### Lab 3: Response Time Trend Analysis

```bash
# Extract response time trend to detect degradation
curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "query": "{ viewer { zones(filter: {zoneTag: \"'${ZONE_ID}'\"}) { healthCheckEvents(limit: 500, filter: { datetime_geq: \"'$(date -v-7d -u +%Y-%m-%dT%H:%M:%SZ)'\" }, orderBy: [datetime_ASC]) { datetime rttMs { value } } } } }"
  }' | python3 -c "
import json, sys
data = json.load(sys.stdin)
events = data['data']['viewer']['zones'][0].get('healthCheckEvents', [])
for e in events:
    if e.get('rttMs') and e['rttMs'].get('value'):
        print(f\"{e['datetime']}: {e['rttMs']['value']}ms\")
" | tail -20
```

### Lab 4: Incident Post-Mortem Script

```bash
# Given an incident timestamp, find the surrounding health check data
INCIDENT_TIME="2025-01-15T14:00:00Z"
WINDOW_BEFORE="2025-01-15T13:30:00Z"
WINDOW_AFTER="2025-01-15T15:00:00Z"

curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"
      {
        viewer {
          zones(filter: {zoneTag: \\\"${ZONE_ID}\\\"}) {
            healthCheckEvents(
              limit: 200,
              filter: {
                datetime_geq: \\\"${WINDOW_BEFORE}\\\",
                datetime_leq: \\\"${WINDOW_AFTER}\\\"
              },
              orderBy: [datetime_ASC]
            ) {
              datetime
              healthCheckName
              region
              failureReason
              rttMs { value }
            }
          }
        }
      }
    \"
  }" | jq '.data.viewer.zones[0].healthCheckEvents[] | 
    "\(.datetime) [\(.region)] \(if .failureReason then "FAIL: " + .failureReason else "OK: " + (.rttMs.value | tostring) + "ms" end)"'
```

### Lab 5: Build an Uptime Dashboard

```bash
# Create a simple uptime summary for multiple checks
python3 << 'EOF'
import subprocess
import json
import os

CF_API_TOKEN = os.environ.get('CF_API_TOKEN')
ZONE_ID = os.environ.get('ZONE_ID')

# This would query the API; for this lab, we simulate the output
print("=" * 60)
print("HEALTH CHECK UPTIME REPORT — Last 7 Days")
print("=" * 60)
print(f"{'Check Name':<30} {'Uptime':>8} {'Avg RTT':>10} {'Failures':>10}")
print("-" * 60)

# Simulated data (replace with actual API query)
checks = [
    {"name": "production-api-check", "uptime": 99.87, "avg_rtt": 145, "failures": 3},
    {"name": "homepage-check", "uptime": 100.0, "avg_rtt": 89, "failures": 0},
    {"name": "checkout-api-check", "uptime": 98.92, "avg_rtt": 312, "failures": 25},
]

for c in checks:
    uptime_status = "✓" if c['uptime'] >= 99.9 else "⚠" if c['uptime'] >= 99.0 else "✗"
    print(f"{c['name']:<30} {uptime_status} {c['uptime']:>6.2f}% {c['avg_rtt']:>9}ms {c['failures']:>10}")

print("-" * 60)
print("\nSLA Status:")
print("  99.9% target: CHECKOUT-API-CHECK MISSING (98.92% < 99.9%)")
print("\nAction Items:")
print("  - Investigate checkout-api-check failures (25 in 7 days)")
print("  - Average RTT 312ms approaching threshold — scale origin")
EOF
```

---

## Demo Script (2 Minutes)

**Audience:** CTO, engineering lead investigating a past incident

**Opening:**
> "You said the site was slow last Thursday around noon. Let me pull up the health check analytics and we can see exactly what happened, down to the minute."

**Show:**
1. Traffic → Health Checks → click on the production check → Analytics tab
2. Set time range to last Thursday
3. "Here — 11:58 AM UTC. Response time jumps from 140ms to 3,800ms. Two consecutive health check failures. Pool marked unhealthy at 12:01."
4. Click on a failure: "Failure reason: `timeout` — the origin wasn't responding within 5 seconds. This isn't a network issue; this is application-level."
5. Show the recovery: "12:34 PM — response time drops back to normal. Whatever was overloading the origin cleared up."

**Closer:**
> "Without this, your post-mortem is: 'the site was slow on Thursday.' With this, it's: 'origin response times degraded from 11:58 AM, peaked at 3.8 seconds at 12:01, automated failover triggered, recovery at 12:34 AM. Total impact: 36 minutes.' That's the level of detail that informs your next architecture decision."

---

## Competitive Context

| Observability Depth | CF Health Check Analytics | Pingdom | Datadog Synthetics | New Relic Synthetics |
|--------------------|--------------------------|---------|-------------------|---------------------|
| Binary uptime % | Yes | Yes | Yes | Yes |
| Response time trend | Yes | Yes | Yes | Yes |
| Failure reason classification | Yes | Limited | Yes | Yes |
| Per-region breakdown | Yes | Yes | Yes | Yes |
| TCP/TLS decomposition | Limited | No | Yes | Yes |
| Waterfall breakdown | No | Yes | Yes | Yes |
| SLA reporting | Basic | Yes | Yes | Yes |
| Anomaly detection | No | No | Yes | Yes |
| API access | GraphQL | REST | REST | REST |
| Already in your dashboard | Yes | No | No | No |

**Context:** Health Check Analytics is solid for availability + response time trending. For deep performance analysis (waterfall, content breakdown, CWV), you need a dedicated synthetic monitoring tool. Position Cloudflare as the operational layer; position Datadog/New Relic as the deep analysis layer.

---

## Self-Check Questions

**Q1: The health check shows 99.1% uptime but response time has been trending from 200ms to 1,800ms over the past 2 weeks without any actual failures. What does this tell you, and what action do you recommend?**

```
Your answer:




```

**Q2: Health check fails from NEAS but passes from all other regions. What are two likely explanations and how would you confirm which one is correct?**

```
Your answer:




```

**Q3: What is the difference between `failure_reason: timeout` and `failure_reason: bad_response_code`? What does each suggest about the origin's state?**

```
Your answer:




```

**Q4: How would you use Health Check Analytics to argue for enabling Argo Smart Routing? What specific metric would you use as evidence?**

```
Your answer:




```

**Q5: A health check has `consecutive_down = 3` and `interval = 60s`. You see in analytics that checks started failing at 14:00:00 UTC. At what timestamp was the pool first marked unhealthy?**

```
Your answer:




```

---

## Sources

- [Cloudflare Health Checks Analytics](https://developers.cloudflare.com/health-checks/analytics/)
- [Cloudflare GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/)
- [Health Check Reference](https://developers.cloudflare.com/health-checks/configuration-reference/)
- [Cloudflare Notifications](https://developers.cloudflare.com/notifications/)
- [Google SRE Book — Monitoring Chapter](https://sre.google/sre-book/monitoring-distributed-systems/)
- [SLA Calculation Methodology](https://cloud.google.com/blog/products/management-tools/practical-guide-to-setting-slos)
