# Module 4.4 — Synthetic Monitoring
> Dashboard Location: macksportreport.com → Speed → Synthetic Monitoring | Estimated Time: 90 minutes | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is Synthetic Monitoring?

Synthetic monitoring runs **scripted, automated checks** on a schedule from Cloudflare's global network — independent of whether any real users are visiting your site. These checks simulate what a user (or a browser) would experience when accessing a specific URL.

The key word is *scripted*: you define what to check, how often, from where, and what counts as a failure. Cloudflare's infrastructure executes these checks 24/7 and alerts you the instant something goes wrong.

**Why it matters:**
- Uptime monitoring catches outages before users do (or before they start tweeting)
- Performance checks catch degradation — not just "is it up" but "is it fast"
- Multi-region checks differentiate "site is down everywhere" from "site is down in Asia"
- It's your early warning system, running continuously even at 3am on a Sunday

### Synthetic vs RUM — The Core Distinction

| | Synthetic | RUM |
|--|-----------|-----|
| **Who executes it** | Cloudflare's scheduled bot | Real user browsers |
| **Timing** | Predetermined schedule | Whenever users visit |
| **Traffic required** | None — works on low-traffic sites | Needs real users |
| **Data consistency** | Highly consistent (same script, same conditions) | Highly variable (real world) |
| **Best for** | Uptime alerts, SLA monitoring, regression detection | Understanding user experience at scale |
| **Can alert on** | Yes — thresholds, status codes, body content | No native alerting |

Synthetic monitoring is your **alarm system**. RUM is your **experience analytics**. You need both.

### Check Types

**HTTP Check (Uptime)**
- Makes an HTTP request to a URL
- Records: status code, response time, response body
- Can check for: specific status code (200), body contains specific text, response headers
- Lightweight — no browser rendering, just raw HTTP
- Best for: API health checks, uptime monitoring, server response checks

**Browser Check (Performance)**
- Spins up a headless Chromium browser (Playwright-powered)
- Loads the full page including all assets, runs JavaScript
- Records: Core Web Vitals (LCP, CLS, FID), full page load time, screenshots on failure
- Heavier — uses more compute
- Best for: End-to-end performance monitoring, catching rendering issues

### Check Frequency Options

| Frequency | Requests/Day | Best For |
|-----------|-------------|----------|
| Every 1 minute | 1,440 | Critical production APIs, payment pages |
| Every 5 minutes | 288 | High-traffic marketing pages |
| Every 10 minutes | 144 | Standard site monitoring |
| Every 15 minutes | 96 | Development/staging environments |
| Every 30 minutes | 48 | Low-traffic sites, batch endpoints |
| Every 60 minutes | 24 | Historical trend tracking |

### Regions Available

Cloudflare runs synthetic checks from globally distributed edge locations. Common regions:
- **North America:** US East (Ashburn), US West (San Jose), US Central
- **Europe:** London, Frankfurt, Amsterdam, Paris
- **Asia-Pacific:** Tokyo, Singapore, Sydney, Mumbai
- **South America:** São Paulo
- **Africa:** Johannesburg

Running from multiple regions simultaneously tells you: is the problem global or regional?

---

## Deep Dive (Architect-Level)

### Alert Architecture

Synthetic monitoring alerts flow through Cloudflare's Notifications system:

```
Check fails threshold
        ↓
Alert Policy evaluates: consecutive failures, % failures in window
        ↓
Notification Group: email, webhook, PagerDuty
        ↓
On-call engineer paged
```

**Alert Policy Logic:**

- **Consecutive failures:** Alert after N consecutive failed checks. Default: 1. Best practice: 2–3 to avoid flapping on transient issues.
- **Failure rate in window:** Alert if > X% of checks in Y minutes fail. Handles multi-region checks where partial failure is expected.
- **Response time threshold:** Alert when response time exceeds threshold even if check "passes" (returns 200).

**Avoiding Alert Fatigue:**
- Set consecutive failure threshold to 2 for uptime checks (avoids single-packet-loss false alarms)
- Set alert suppression during known maintenance windows
- Group related alerts (don't alert once per region — alert once for "site is down")

### SLA Monitoring Pattern

Many enterprises commit to SLAs like "99.9% uptime" or "p95 response time < 500ms." Synthetic monitoring operationalizes these commitments:

**Uptime SLA:**
- 99.9% uptime = 8.76 hours downtime allowed per year = 43.8 minutes/month
- With 1-minute checks from 3 regions: each minute of downtime detected within 1 minute
- Alert: if any region fails 2 consecutive checks → trigger incident

**Performance SLA:**
- p95 response time < 2 seconds
- Configure: alert if response time > 2000ms on 5 consecutive checks
- Track: weekly report of check pass rate and median response time

**Automated SLA Reporting with API:**
```
- Pull check results via API for past 30 days
- Calculate uptime: (passed checks / total checks) × 100
- Calculate p95 response time from check history
- Generate SLA compliance report
```

### Multi-Region Check Strategy

For macksportreport.com, a production monitoring strategy might be:

```
Homepage (/) — Every 5 min — US East, US West, London, Singapore
/api/health — Every 1 min — US East, Frankfurt (critical API)
/pricing — Every 15 min — US East only (marketing page)
/checkout — Every 2 min — US East, London, Tokyo (revenue critical)
```

**Analysis Pattern:**
- All regions fail → global outage (origin down, DNS issue, CF incident)
- One region fails → regional routing issue (Argo path problem, regional pop congestion)
- All regions slow but not failing → origin performance degradation
- Browser checks pass but HTTP checks fail → header/status code regression

### Health Check Analytics

Beyond individual check results, Cloudflare provides aggregate analytics:

- **Availability percentage:** (passing checks / total checks) × 100 for any time window
- **Response time trend:** Plot response time over days/weeks — catch gradual degradation
- **Downtime history:** List of all incidents with duration and affected regions
- **MTTR (Mean Time to Recovery):** Average duration of detected outages

This data is importable via API into Grafana, Datadog, or custom dashboards for SLA reporting.

### Integration With Incident Response

**Webhook Integration Pattern:**

Cloudflare sends webhook payloads on alert trigger and resolution. You can route these to:

- **PagerDuty** — automatic incident creation, on-call rotation
- **Slack** — #ops-alerts channel notification
- **OpsGenie** — escalation policies
- **Custom webhook** — trigger your own runbooks (e.g., auto-rollback deployment)

**Webhook Payload Structure:**
```json
{
  "text": "Health check failed",
  "data": {
    "health_check_id": "abc123",
    "health_check_name": "macksportreport.com Homepage",
    "health_check_type": "HTTP",
    "failure_reason": "Response time exceeded threshold: 3241ms > 2000ms",
    "url": "https://macksportreport.com/",
    "region": "us-east",
    "timestamp": "2024-01-15T14:32:00Z",
    "consecutive_failures": 3
  }
}
```

---

## Dashboard Walkthrough

### Step 1: Navigate to Synthetic Monitoring
```
macksportreport.com → Speed → Synthetic Monitoring
```
*(Also reachable via: Health Checks)*

### Step 2: Create Your First HTTP Check
1. Click "Create" → "HTTP check"
2. **Name:** "Homepage Uptime"
3. **URL:** `https://macksportreport.com/`
4. **Method:** GET
5. **Frequency:** 5 minutes
6. **Regions:** Select US East, US West, London (minimum 3 for meaningful coverage)
7. **Expected status code:** 200
8. **Timeout:** 10 seconds
9. Click Save

### Step 3: Create a Browser Performance Check
1. Click "Create" → "Browser check"
2. **Name:** "Homepage Performance"
3. **URL:** `https://macksportreport.com/`
4. **Frequency:** 15 minutes
5. **Region:** US East (single region for browser checks is cost-effective)
6. **Performance threshold:** LCP < 3000ms, alert if exceeded
7. Click Save

### Step 4: Configure Alert Notifications
1. In the check settings → Notifications tab
2. Click "Add Notification Policy"
3. **Trigger:** After 2 consecutive failures
4. **Channel:** Email → your email address
5. **For webhook:** paste your Slack incoming webhook URL
6. **Recovery notification:** Enable (get alerted when site recovers)

### Step 5: Read the Health Check Analytics
- Click on any check name to see full history
- **Timeline view:** Green = pass, red = fail bars over time
- **Response time chart:** Average response time over time
- **Region breakdown:** Pass/fail by region (reveals geographic issues)

### Step 6: Interpret Downtime Events
- Click on a red failure bar in the timeline
- See: which regions failed, error message, response time at failure
- Click "View neighboring checks" to see what was happening 5 minutes before and after

---

## Hands-On Lab

### Prerequisites
- macksportreport.com on Cloudflare
- API token with Zone:Edit and Notifications:Edit permissions

### Lab 1: Create HTTP Health Check via API

```bash
export CF_API_TOKEN="your_api_token_here"
export ZONE_ID="your_zone_id_here"

# Create an HTTP health check
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/healthchecks" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "macksportreport-homepage",
    "description": "Homepage uptime monitoring",
    "suspended": false,
    "address": "macksportreport.com",
    "path": "/",
    "port": 443,
    "type": "HTTPS",
    "interval": 60,
    "timeout": 10,
    "retries": 2,
    "method": "GET",
    "expected_codes": "200",
    "expected_body": "",
    "follow_redirects": true,
    "allow_insecure": false,
    "check_regions": ["WNAM", "ENAM", "WEU"]
  }' | jq '{id: .result.id, name: .result.name, status: .result.status}'
```

### Lab 2: List All Health Checks and Their Status

```bash
# List all health checks for the zone
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/healthchecks" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[] | {
    id: .id,
    name: .name,
    status: .status,
    url: (.type + "://" + .address + .path),
    interval_seconds: .interval,
    regions: .check_regions
  }'
```

### Lab 3: Pull Health Check Analytics

```bash
# Get health check summary (uptime %)
HEALTHCHECK_ID="your_healthcheck_id"

curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/healthchecks/$HEALTHCHECK_ID/preview" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.'

# Get detailed check results via GraphQL
curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "
      query {
        viewer {
          zones(filter: { zoneTag: \"'$ZONE_ID'\" }) {
            healthCheckEventsAdaptiveGroups(
              filter: {
                datetime_gt: \"2024-01-01T00:00:00Z\",
                datetime_lt: \"2024-01-08T00:00:00Z\"
              }
              limit: 100
              orderBy: [datetime_DESC]
            ) {
              count
              dimensions {
                healthCheckId
                healthCheckName
                status
                region
                failureReason
              }
              avg {
                responseTime
              }
            }
          }
        }
      }
    "
  }' | jq '.data.viewer.zones[0].healthCheckEventsAdaptiveGroups[] | {
    check: .dimensions.healthCheckName,
    status: .dimensions.status,
    region: .dimensions.region,
    avg_response_ms: .avg.responseTime,
    count: .count,
    failure_reason: .dimensions.failureReason
  }'
```

### Lab 4: Set Up Webhook Notification for Check Failure

```bash
# First, create a notification policy
ACCOUNT_ID="your_account_id"

# Create a webhook notification channel
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/alerting/v3/destinations/webhooks" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Slack Ops Channel",
    "url": "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK",
    "secret": "optional_secret_for_hmac_validation"
  }' | jq '{id: .result.id, name: .result.name}'

# Create notification policy for health check failure
WEBHOOK_ID="your_webhook_id_from_above"

curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/alerting/v3/policies" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Health Check Alert — macksportreport.com",
    "enabled": true,
    "alert_type": "health_check_status_notification",
    "mechanisms": {
      "webhooks": [{"id": "'$WEBHOOK_ID'"}]
    },
    "filters": {
      "zones": ["'$ZONE_ID'"],
      "health_check_ids": ["'$HEALTHCHECK_ID'"]
    }
  }' | jq '{id: .result.id, name: .result.name, enabled: .result.enabled}'
```

### Lab 5: Simulate a Failure and Verify Alert

```bash
# Temporarily update the check to a bad path to trigger failure
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/healthchecks/$HEALTHCHECK_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/this-page-does-not-exist-404",
    "expected_codes": "200"
  }' | jq '.result.path'

echo "Check updated to failing path. Waiting for failure detection..."
sleep 90  # Wait for 2 check intervals

# Check the status
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/healthchecks/$HEALTHCHECK_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '{status: .result.status, failure_reason: .result.failure_reason}'

# Restore the check to the correct path
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/healthchecks/$HEALTHCHECK_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path": "/"}' | jq '.result.path'

echo "Check restored. You should receive a recovery notification."
```

### Lab 6: Calculate SLA Uptime from Check History

```bash
#!/bin/bash
# sla-report.sh — Calculate uptime SLA from health check data

CF_API_TOKEN="${CF_API_TOKEN}"
ZONE_ID="${ZONE_ID}"
HEALTHCHECK_ID="${HEALTHCHECK_ID}"
DAYS="${1:-30}"

START=$(date -u -v-${DAYS}d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u --date="${DAYS} days ago" +"%Y-%m-%dT%H:%M:%SZ")
END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "=== SLA Report: $DAYS-Day Period ==="
echo ""

RESULT=$(curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"query { viewer { zones(filter: { zoneTag: \\\"$ZONE_ID\\\" }) { healthCheckEventsAdaptiveGroups(filter: { datetime_gt: \\\"$START\\\", datetime_lt: \\\"$END\\\" }, limit: 10000, orderBy: [datetime_DESC]) { count dimensions { status } } } } }\"
  }")

TOTAL=$(echo "$RESULT" | jq '[.data.viewer.zones[0].healthCheckEventsAdaptiveGroups[].count] | add // 0')
PASSING=$(echo "$RESULT" | jq '[.data.viewer.zones[0].healthCheckEventsAdaptiveGroups[] | select(.dimensions.status == "Healthy") | .count] | add // 0')

if [ "$TOTAL" -gt 0 ]; then
  UPTIME=$(echo "scale=4; $PASSING * 100 / $TOTAL" | bc)
  echo "Total checks: $TOTAL"
  echo "Passing: $PASSING"
  echo "Uptime: ${UPTIME}%"
  echo ""
  
  if (( $(echo "$UPTIME >= 99.9" | bc -l) )); then
    echo "✅ SLA STATUS: 99.9% Uptime — PASSING"
  elif (( $(echo "$UPTIME >= 99.0" | bc -l) )); then
    echo "⚠️  SLA STATUS: 99.0% Uptime — AT RISK (below 99.9%)"
  else
    echo "❌ SLA STATUS: FAILING — Below 99% uptime"
  fi
else
  echo "No check data found for this period."
fi
```

---

## Demo Script (2 Minutes)

**Audience:** Engineering lead or VP of Engineering

---

**[0:00 – 0:20] The Risk Framing**

"I want to ask you something: how do you find out your site is down right now? Do you find out before your customers do, or after?"

*Pause for answer.*

"Let me show you how Cloudflare's Synthetic Monitoring changes that."

*Navigate to: macksportreport.com → Speed → Synthetic Monitoring*

---

**[0:20 – 0:50] Show Existing Configuration (or Set Up Live)**

"We have checks running from [N] regions, every [X] minutes. This view shows me the last 24 hours of check results. Green = healthy, red = failed."

*Point to timeline.*

"Notice this: we have checks from US East, London, and Singapore. If I see London go red while US and Singapore stay green, that tells me instantly it's not a site-wide outage — it's a regional routing issue. I can triage in seconds instead of minutes."

---

**[0:50 – 1:30] Show an Alert (Real or Simulated)**

"Let me show you what a customer receives when a check fails."

*Show alert email or webhook payload.*

"The alert fires within [interval × consecutive failures] seconds of detection. It tells your team: which check, which region, what the failure was, what the response time was. No ambiguity. Direct to your PagerDuty rotation."

---

**[1:30 – 2:00] SLA Close**

"The last thing I want to show you is this."

*Point to availability percentage on the analytics panel.*

"This is your 30-day uptime percentage: [X]%. If you have an SLA commitment to your customers of 99.9%, I can set up alerts that tell you when you're at risk of breaching that SLA before the month ends. Want me to configure that threshold alert while we're here?"

---

## Competitive Context

| Dimension | CF Synthetic Monitoring | Pingdom | DataDog Synthetics | StatusCake |
|-----------|------------------------|---------|-------------------|------------|
| **Global locations** | CF edge (300+ cities) | ~100 | ~70 locations | ~40 locations |
| **HTTP check** | Yes | Yes | Yes | Yes |
| **Browser check** | Yes (Playwright-based) | Yes (basic) | Yes (advanced) | Limited |
| **Check frequency** | 1 min minimum | 1 min minimum | 1 min minimum | 1 min minimum |
| **Core Web Vitals** | Yes (browser checks) | Basic metrics only | Yes | No |
| **Alert channels** | Email, webhook, PagerDuty | Email, SMS, webhook, Slack | Email, Slack, PagerDuty | Email, webhook, Slack |
| **Integrated with CDN** | Yes — tests through CF stack | No | No | No |
| **API access** | Full REST API | Yes | Yes | Yes |
| **Cost (basic)** | Included in Pro/Business | $10–$400/month | $15+/month | Free tier available |
| **Multi-step checks** | Limited | No | Yes | No |

**SE Positioning:** CF Synthetic Monitoring's killer advantage is that it tests *through your Cloudflare stack* — meaning the check reflects exactly what a real user experiences including CF caching, routing, and security layers. Pingdom and Datadog bypass your CDN entirely, which can mask CDN-layer problems or show false positives for issues that don't affect cached traffic.

---

## Self-Check Questions

**Instructions:** Answer each question without referring to your notes.

---

**Q1.** A customer has synthetic monitoring checks from 3 regions: US East, London, and Singapore. US East and Singapore are green; London is red. What does this tell you, and what would you investigate first?

```
Your answer:




```

---

**Q2.** What is the difference between an HTTP check and a browser check? When would you use each, and what are the tradeoffs?

```
Your answer:




```

---

**Q3.** A customer wants to monitor their site's compliance with a 99.9% uptime SLA. They have checks running every 5 minutes from 3 regions. Walk through how you would calculate their uptime percentage at month-end.

```
Your answer:




```

---

**Q4.** Explain the concept of "alert fatigue" in the context of synthetic monitoring. What configuration setting helps prevent false-positive alerts from transient failures?

```
Your answer:




```

---

**Q5.** How does synthetic monitoring complement RUM? Give a specific scenario where you would use each tool and explain why the other tool wouldn't be sufficient.

```
Your answer:




```

---

## Sources

- [Cloudflare Health Checks Documentation](https://developers.cloudflare.com/health-checks/)
- [Cloudflare Synthetic Monitoring](https://developers.cloudflare.com/speed/synthetic-monitoring/)
- [Cloudflare Notifications / Alerting](https://developers.cloudflare.com/notifications/)
- [Health Checks API Reference](https://developers.cloudflare.com/api/operations/health-checks-list-health-checks)
- [Cloudflare PagerDuty Integration](https://developers.cloudflare.com/notifications/create-notifications/create-pagerduty/)
- [Cloudflare Webhook Notifications](https://developers.cloudflare.com/notifications/create-notifications/configure-webhooks/)
- [SLA Calculation Methodology](https://developers.cloudflare.com/health-checks/health-checks-analytics/)
- [Playwright for Browser Automation](https://playwright.dev/)
