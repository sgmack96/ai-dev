# Module 9.7 — Custom Dashboards
> Dashboard Location: macksportreport.com → Analytics → Custom Dashboards
> Estimated Time: 45 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Custom Dashboards allow you to build personalized, multi-source views of Cloudflare data by combining metrics from HTTP Traffic, Security events, Workers, Log Explorer, and more into a single persistent dashboard. Instead of navigating between multiple sections of the Cloudflare dashboard, you create a unified view tailored to a specific team's needs.

### Why Custom Dashboards Exist

The built-in Cloudflare analytics tabs are organized by product area:
- HTTP Traffic → traffic volume and distribution
- Security Events → WAF, bot, and rate limiting events
- Workers → compute metrics

For most teams, the real insights come from **correlating across these data sources**:
- "Are WAF blocks correlated with traffic spikes?" (Security + HTTP Traffic)
- "Does cache hit rate drop when Workers CPU time spikes?" (Performance + Workers)
- "How does threat volume compare to legitimate traffic?" (Security + HTTP Traffic)

Custom Dashboards solve this by letting you create a single view that pulls from multiple sources.

### Data Sources Available

| Source | Metrics Available |
|--------|-----------------|
| **HTTP Requests** | Requests, bandwidth, cache hit rate, threats, pageviews, status codes |
| **Firewall/Security Events** | WAF rule matches, bot score distribution, rate limit triggers, challenges |
| **Workers Metrics** | CPU time, errors, requests, subrequests by Worker name |
| **Log Explorer Queries** | Any saved Log Explorer query turned into a persistent chart |
| **Zone Analytics** | Aggregated zone-level summaries |

### Chart Types

| Chart Type | Best For |
|-----------|---------|
| **Time Series (Line)** | Trends over time, comparing two metrics on same timeline |
| **Bar Chart** | Comparing categories at a point in time |
| **Pie/Donut** | Distribution (what % is each category) |
| **Table** | Top-N lists (top countries, top URLs, top IPs) |
| **Number (Single Stat)** | KPIs: total requests, total threats, error rate |
| **Stacked Area** | Volume over time with breakdown by category |

---

## Deep Dive (Architect-Level)

### Dashboard Architecture: Three Use-Case Templates

#### Use Case 1: SOC Dashboard (Security Operations)

A security team needs a single view of all security-related events:

**Widgets to include:**
1. **Threats blocked** (Number) — total WAF blocks in last 24h
2. **Threat volume over time** (Time Series) — firewall events per hour
3. **Top blocked countries** (Bar) — where attacks originate
4. **WAF rule matches by action** (Pie) — block vs challenge vs log
5. **Bot activity** (Stacked Area) — legitimate vs automated vs potentially automated over time
6. **Rate limit triggers** (Number) — current rate limit events
7. **Top attacked paths** (Table) — which URL paths are being targeted

**Data sources:** Firewall Events + HTTP Requests + Bot Management

#### Use Case 2: Engineering Dashboard (Performance + Reliability)

An engineering team monitoring production health:

**Widgets to include:**
1. **Error rate** (Number) — HTTP 5xx rate as a percentage
2. **Origin response time P95** (Time Series) — slow request tracking
3. **Cache hit rate** (Number) — current cache effectiveness
4. **Workers CPU P99** (Time Series) — compute health
5. **Workers error rate** (Number) — uncaught exceptions
6. **Cache hit rate by content type** (Table) — optimization opportunities
7. **Bandwidth usage** (Time Series) — cost tracking

**Data sources:** HTTP Requests + Workers Metrics + Performance Analytics

#### Use Case 3: Executive Dashboard (Business KPIs)

Leadership needs a high-level traffic and security summary:

**Widgets to include:**
1. **Total traffic this week** (Number) with WoW comparison
2. **Bandwidth saved** (Number) — CDN ROI signal
3. **Threats blocked** (Number) — security value demonstration
4. **Traffic over time** (Time Series) — growth trend
5. **Traffic by geography** (Map or Table) — audience distribution
6. **Unique visitors** (Number) — audience reach

**Data sources:** HTTP Requests only (keep it simple for exec audience)

### Turning Log Explorer Queries into Dashboard Widgets

The most powerful Custom Dashboard feature is the ability to save a Log Explorer SQL query as a persistent chart widget.

**Workflow:**
1. Open Log Explorer and write a query (e.g., "count requests grouped by status code per hour")
2. Run the query and validate the results
3. Click "Add to Dashboard"
4. Choose an existing dashboard or create a new one
5. The query runs automatically on a refresh interval

**Example: 5xx Error Rate Widget from Log Explorer**

```sql
-- Log Explorer query to track 5xx error rate over time
SELECT
  toStartOfInterval(datetime, INTERVAL '1' HOUR) AS hour,
  countIf(edgeResponseStatus >= 500 AND edgeResponseStatus < 600) AS errors_5xx,
  count() AS total_requests,
  round(countIf(edgeResponseStatus >= 500 AND edgeResponseStatus < 600) * 100.0 / count(), 2) AS error_rate_pct
FROM
  http_requests
WHERE
  datetime >= now() - INTERVAL '24' HOUR
GROUP BY hour
ORDER BY hour ASC
```

This becomes a time series chart showing 5xx error rate over the last 24 hours, automatically refreshing.

### Dashboard Sharing and Access Control

**Shareable links:** Dashboards can be shared via read-only links. Recipients do not need a Cloudflare account to view the dashboard. The link is valid for the duration you configure.

**Access control:** Dashboard access follows the user's Cloudflare account permissions. If a user has `Zone:Analytics:Read`, they can view dashboards. Editing requires `Zone:Analytics:Edit`.

**Export:** Charts can be exported as:
- **PNG** (screenshot for presentations)
- **CSV** (raw data for further analysis in Excel/Sheets)
- **JSON** (structured data for programmatic processing)

### Dashboard Limits

| Plan | Dashboards | Widgets per Dashboard | Data Retention |
|------|-----------|----------------------|----------------|
| **Free** | 25 | 25 | 24-48h |
| **Pro** | 25 | 25 | 7 days |
| **Business** | 25 | 25 | 30 days |
| **Enterprise + Log Explorer** | 100 | 50 | 90+ days |

---

## Dashboard Walkthrough

### Step 1: Create a New Custom Dashboard

1. macksportreport.com → Analytics → Dashboards (or Custom Dashboards)
2. Click **New Dashboard**
3. Give it a name: "macksportreport.com — Engineering Dashboard"
4. Set a default time range (Last 24 hours)
5. Click **Create**

### Step 2: Add Your First Widget — Traffic Volume

1. Click **Add Widget**
2. Select source: **HTTP Requests**
3. Select metric: **Requests**
4. Select chart type: **Time Series**
5. Set title: "Total Requests Per Hour"
6. Click **Save Widget**

### Step 3: Add a Security Widget

1. Click **Add Widget**
2. Select source: **Firewall Events**
3. Select metric: **Events**
4. Filter by: **Action = Block**
5. Select chart type: **Number (Single Stat)**
6. Set title: "Threats Blocked (24h)"
7. Click **Save Widget**

### Step 4: Add a Workers Widget

1. Click **Add Widget**
2. Select source: **Workers**
3. Select metric: **CPU Time P99**
4. Select chart type: **Time Series**
5. Set title: "Workers CPU P99 Over Time"
6. Click **Save Widget**

### Step 5: Arrange and Resize

Drag widgets to arrange them in a logical layout:
- Put single-stat Numbers across the top as a summary bar
- Put time series charts in the main body
- Put tables at the bottom

### Step 6: Enable Auto-Refresh

Set the dashboard to auto-refresh every 5 minutes for a live view during incidents.

### Step 7: Create a Shareable Link

1. Click **Share**
2. Set link expiration (7 days, 30 days, or permanent)
3. Copy the link — share with stakeholders who don't have Cloudflare dashboard access

---

## Hands-On Lab

### Prerequisites

- macksportreport.com with some traffic
- Access to Custom Dashboards (any plan for basic; Enterprise for Log Explorer widgets)

### Lab 1: Build the SOC Mini-Dashboard

Follow these steps to build a basic security dashboard:

**Widget 1: Threats blocked (last 24h)**
- Source: Firewall Events
- Metric: Count
- Filter: Action = block
- Type: Number (Single Stat)
- Title: "Threats Blocked — Last 24h"

**Widget 2: Firewall events over time**
- Source: Firewall Events
- Metric: Count over time
- Group by: Action (block/challenge/log)
- Type: Stacked Area
- Title: "Security Events by Action"

**Widget 3: Top attacking countries**
- Source: Firewall Events
- Metric: Count
- Dimension: Client Country
- Filter: Action = block
- Type: Bar Chart (Top 10)
- Title: "Top Threat Origins"

**Widget 4: WAF vs Bot vs Rate Limit split**
- Source: Firewall Events
- Metric: Count
- Dimension: Source (WAF / Bot Management / Rate Limiting)
- Type: Pie Chart
- Title: "Threat Type Distribution"

### Lab 2: Export Dashboard Data for a Weekly Report

```bash
# After building your dashboard, use the API to pull the underlying data
# This simulates what you'd build for an automated weekly report

export CF_EMAIL="your@email.com"
export CF_API_KEY="your-api-key"
export ZONE_ID="your-zone-id"

# Pull last 7 days of daily threat counts
curl -s -X POST \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"{ viewer { zones(filter: { zoneTag: \\\"$ZONE_ID\\\" }) { firewallEventsAdaptiveGroups( limit: 7, filter: { datetime_geq: \\\"$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)\\\", action: \\\"block\\\" }, orderBy: [datetime_ASC] ) { dimensions { datetime } count } } } }\"
  }" \
  https://api.cloudflare.com/client/v4/graphql | jq '.data.viewer.zones[0].firewallEventsAdaptiveGroups[] | {date: .dimensions.datetime, threats_blocked: .count}'
```

### Lab 3: Build a Combined HTTP + Security Widget Query

```bash
# Combine traffic + security data to calculate "clean traffic ratio"
curl -s -X POST \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"{ viewer { zones(filter: { zoneTag: \\\"$ZONE_ID\\\" }) { httpRequests1dGroups(limit: 7, filter: { date_geq: \\\"$(date -u -v-7d +%Y-%m-%d)\\\" }, orderBy: [date_ASC]) { dimensions { date } sum { requests threats } } } } }\"
  }" \
  https://api.cloudflare.com/client/v4/graphql | jq '.data.viewer.zones[0].httpRequests1dGroups[] | {
    date: .dimensions.date,
    total_requests: .sum.requests,
    threats: .sum.threats,
    clean_traffic_pct: ((((.sum.requests - .sum.threats) / .sum.requests) * 100) | round | tostring + "%")
  }'
```

### Lab 4: Create a Template Dashboard for a New Zone

Document the process of creating a standard engineering dashboard that can be reproduced for any new zone:

```markdown
## Standard Engineering Dashboard Template

Widget 1: Total Requests (Number, 24h)
Widget 2: Cache Hit Rate (Number, 24h)  
Widget 3: Threats Blocked (Number, 24h)
Widget 4: 5xx Error Rate % (Number, 24h)
Widget 5: Requests + Cached Requests over time (Stacked Area)
Widget 6: Firewall events over time (Time Series)
Widget 7: Workers CPU P99 (Time Series) — if Workers are deployed
Widget 8: Origin Response Time P95 (Time Series)

Time Range: Default to 24h
Auto-refresh: 5 minutes
Share: Generate a read-only link for the team
```

---

## Demo Script (2 Minutes)

**Setup:** Have a Custom Dashboard with 4-6 widgets open, showing the engineering dashboard layout.

---

"One of the things that separates mature Cloudflare customers from new ones is custom dashboards. Instead of jumping between Traffic, Security, and Workers tabs during an incident, everything is in one view.

[Gesture to the dashboard layout]

This is our engineering dashboard. Top row: four KPI numbers — total requests, cache hit rate, threats blocked, 5xx error rate. Everything I need to know about right now at a glance.

[Point to time series charts]

Main body: traffic over time overlaid with security events. When I see a traffic spike, I can immediately tell: was that spike legitimate traffic, or was it attacks being blocked? Here — Tuesday at 3pm — traffic spiked by 40%. But threats stayed flat. That's a legitimate traffic spike, not an attack.

[Point to Workers CPU widget]

Bottom: Workers CPU P99. Running at 23ms P99 today — well within our 50ms limit. If I see this approaching 45ms, I know I need to optimize the Worker before we hit the ceiling.

[Click share button]

One click — shareable link. Anyone on the team, or the customer's security team, or a VP who wants a real-time view — doesn't need a Cloudflare account. Just the link.

This is operational visibility at zero cost. It doesn't require a SIEM, a separate APM tool, or any configuration beyond the dashboard you see right here."

---

## Competitive Context

| Feature | Cloudflare Custom Dashboards | Datadog Dashboards | Grafana |
|---------|-----------------------------|--------------------|---------|
| **No additional agent** | Yes (CF data native) | Requires agents/integrations | Requires data sources |
| **Security + Performance unified** | Yes | Yes (requires integrations) | Yes (requires integrations) |
| **Shareable read-only links** | Yes | Yes | Yes |
| **Log Explorer integration** | Yes | Yes (Log Management) | Yes (Loki) |
| **Auto-refresh** | Yes | Yes | Yes |
| **Alert from dashboard** | No (use Alerts section) | Yes | Yes |
| **Annotation overlays** | No | Yes | Yes |
| **Cross-account data** | No | Yes | Yes (multi-source) |
| **Cost** | Included in CF plan | $23+/host/month | Free (OSS) |
| **Setup complexity** | Low (native data) | Medium | High (data source config) |

**Cloudflare differentiator:** Zero additional cost, zero additional agent deployment, zero integration work. The data is already in Cloudflare — Custom Dashboards just visualizes it. For teams that only use Cloudflare as their CDN/WAF, this eliminates the need to stand up Grafana or pay for Datadog just to correlate traffic and security data.

---

## Self-Check Questions

**Question 1:** A customer wants to create a dashboard that shows, on the same time axis, both WAF blocks per minute and total HTTP requests per minute. Which widget type would you use, and what two data sources would you combine?

```
Your answer:




```

---

**Question 2:** A security team wants to share a real-time dashboard with their CISO who doesn't have a Cloudflare account. What feature enables this, and are there any limitations or risks to be aware of?

```
Your answer:




```

---

**Question 3:** A customer on the Free plan says they can only see the last 24 hours of data in Custom Dashboards even though they set the time range to "Last 7 days." What is the cause?

```
Your answer:




```

---

**Question 4:** Walk through the steps to build a widget that shows the 5xx error rate (as a percentage of total requests) over time using a Log Explorer query.

```
Your answer:




```

---

**Question 5:** A customer has three Cloudflare zones (three different websites) and wants a single dashboard showing combined traffic across all three. Is this possible with Custom Dashboards? If not, what workaround would you suggest?

```
Your answer:




```

---

## Sources

- [Cloudflare Custom Dashboards Documentation](https://developers.cloudflare.com/analytics/account-and-zone-analytics/dashboards/)
- [Cloudflare Log Explorer](https://developers.cloudflare.com/logs/log-explorer/)
- [Cloudflare Analytics Overview](https://developers.cloudflare.com/analytics/)
- [Zone Analytics GraphQL API](https://developers.cloudflare.com/analytics/graphql-api/)
- [Firewall Events Dataset](https://developers.cloudflare.com/logs/reference/log-fields/zone/firewall_events/)
- [Workers Analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)
