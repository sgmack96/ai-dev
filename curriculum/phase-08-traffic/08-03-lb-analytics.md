# Module 8.3 — Load Balancing Analytics
> Dashboard Location: macksportreport.com → Traffic → Load Balancing Analytics
> Estimated Time: 45 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is Load Balancing Analytics?

Load Balancing Analytics is the observability layer for Cloudflare Load Balancers. It gives you visibility into:
- How traffic is distributed across pools and origins over time
- When failover events occurred and why
- Pool health history — which pools were healthy or degraded
- Whether the steering policy is distributing traffic as expected

Without analytics, load balancing is a black box. You configure it, enable it, and hope it works. Analytics makes it observable and debuggable.

### Why This Matters

**Incident Post-Mortem:** If your site had an outage at 2 AM on Tuesday, LB Analytics tells you:
- Which pool went unhealthy at what exact timestamp
- How many health check failures preceded the pool being marked down
- When traffic failed over to the secondary pool
- When the primary pool recovered

**Capacity Planning:** Are your pools evenly loaded? Is one pool receiving 90% of traffic while another sits mostly idle? Is the weight configuration working as intended?

**Steering Validation:** If you configured geo steering to send European users to your EU pool, are they actually going there? Analytics lets you verify.

**Health Check Audit:** Which health check failures have been recurring? Is there an origin that intermittently fails and causes brief traffic disruptions?

### Data Available in LB Analytics

**Traffic Distribution:**
- Requests per pool over selectable time windows (1h, 6h, 24h, 7d, 30d)
- Percentage of traffic per pool vs expected weights/steering
- Origin-level breakdown within pools

**Health Events:**
- Timeline of pool state changes (healthy → degraded → unhealthy → healthy)
- Origin state changes within pools
- Correlated with health check failure count

**Failover Events:**
- Timestamp of each failover
- Source pool that became unhealthy
- Target pool that received redirected traffic
- Duration of the failover period

**Notification History:**
- When email/webhook alerts were sent
- What triggered them

---

## Deep Dive (Architect-Level)

### Understanding Traffic Distribution Charts

The traffic distribution chart in LB Analytics shows requests per pool as a time series. What to look for:

**Normal state:** Each pool receives traffic proportional to its configured weight/steering rules. Geo-steered load balancers show each pool receiving traffic from the expected regions.

**Failover signature:** 
```
Pool A traffic: ████████████████░░░░░░░░░░░░░░  (drops to zero)
Pool B traffic: ░░░░░░░░░░░░░░░░████████████████  (spikes to absorb)
```
This is a textbook failover event. Note the exact crossover timestamp.

**Gradual degradation:**
```
Pool A traffic: ████████████▓▓▓▓▒▒▒▒░░░░░░░░░░  (gradual reduction)
```
This indicates pool A's health threshold was crossed but not immediately — origins were failing one by one until the pool health minimum was hit.

**Flapping:**
```
Pool A: ██░░░██░░░██░░░██  (alternating healthy/unhealthy)
```
Flapping occurs when an origin is borderline — sometimes passing health checks, sometimes failing. This causes traffic to rapidly switch back and forth. Very disruptive for session-based applications.

### Diagnosing a Past Failover

Step-by-step investigation protocol:

**Step 1: Establish the timeline**
```
From LB Analytics:
- 14:23:00 UTC — Pool 1 (US-East) traffic begins dropping
- 14:23:45 UTC — Pool 1 marked unhealthy
- 14:23:46 UTC — Traffic redirected to Pool 2 (US-West)
- 14:37:12 UTC — Pool 1 health check passes again
- 14:37:13 UTC — Traffic redistributed back to Pool 1
Duration: ~14 minutes
```

**Step 2: Identify the trigger**
```
From Health Check History:
- 14:21:00 UTC — health check failure #1 (timeout)
- 14:22:00 UTC — health check failure #2 (timeout)
- 14:23:00 UTC — health check failure #3 (timeout) — threshold hit
```
Three consecutive failures → pool marked unhealthy. This is configured in the health check (retries: 2 = mark unhealthy after 2 failures, after 3 checks).

**Step 3: Correlate with external data**
- Check CloudWatch/Datadog at 14:21 UTC — was the origin CPU/memory spiking?
- Check deployment logs — was a deployment running?
- Check network logs — was there a network partition?

**Step 4: Determine impact**
```
From Traffic charts:
- Pool 1 normally handles 10,000 req/min
- During 14:23-14:37: those requests went to Pool 2
- Pool 2 capacity: normally 5,000 req/min (sized for failover, not primary load)
- Result: Pool 2 was overloaded — response times increased but no outage
```

**Lesson:** Failover pool must be sized for primary traffic volume, not just its normal baseline.

### Pool Health Threshold Design

The `minimum_origins` setting determines when a pool is considered unhealthy. Getting this wrong has consequences:

**Too low (minimum_origins = 1):**
- Pool stays "healthy" even if only 1 of 10 origins is responding
- Users get routed to a single overloaded server
- No failover to secondary pool

**Too high (minimum_origins = 5 out of 5):**
- Any single origin failure marks the pool unhealthy
- Triggers failover even for a minor blip
- Too sensitive for high-traffic environments

**Recommendation:** `minimum_origins = ceil(total_origins * 0.5)`
- For a 4-origin pool: minimum = 2
- For a 6-origin pool: minimum = 3

### Origin Weight Validation via Analytics

After configuring origin weights, use analytics to verify distribution:

Expected: `server1 (w=2): 67%`, `server2 (w=1): 33%`

If analytics shows `server1: 45%, server2: 55%` — the distribution doesn't match. Investigate:
- Is the steering policy correct? (Random or Hash might override weights)
- Is session affinity active? (Sticky sessions bypass weight distribution)
- Did a health check temporarily mark an origin down, causing traffic redistribution?

### Capacity Planning with Analytics

Use 30-day request data to answer:

**Question: Is our failover pool sized correctly?**
```
Primary pool peak: 15,000 req/min (from analytics)
Failover pool current capacity: 8,000 req/min
Gap: 7,000 req/min under-capacity
Action: Add 2 origins to failover pool
```

**Question: Should we add geo steering?**
```
From analytics: 40% of requests hit US-East pool from Europe (high latency path)
Action: Add EU pool, configure geo steering for WEUR region to route locally
Expected: 40% of traffic gets lower latency, user experience improvement measurable in TTFB
```

**Question: Is our health check interval aggressive enough?**
```
From health event history: Average time from origin failure to pool marked unhealthy: 3 minutes
(3 consecutive check failures × 60s interval = 180 seconds)
If 180 seconds of degraded service is unacceptable:
Action: Reduce check interval to 30 seconds (Enterprise) → failure detection in 90 seconds
```

---

## Dashboard Walkthrough

**Navigation:** macksportreport.com → Traffic → Load Balancing → Analytics tab

### Overview Cards

At the top of the Analytics page:
- **Total requests** (selectable time window)
- **Failover events** (count and most recent)
- **Origins currently unhealthy** (real-time)

### Traffic Distribution Chart

A stacked area chart showing requests per pool over time:
- Each pool is a different color
- Hover to see exact request counts at any timestamp
- Look for: sudden drops (pool went unhealthy), gradual shifts (geo steering at work), spikes (failover absorbing traffic)

**Filtering:** Filter by load balancer (if multiple LBs on the zone) and by time range.

### Failover Events Table

Lists all failover events in reverse chronological order:
- Timestamp (UTC)
- Pool that became unhealthy
- Pool that received failover traffic
- Duration of failover

Click on a failover event to see the health check failure timeline that triggered it.

### Origin Health History

A table showing each origin's health status over time:
- Green: passing health checks
- Yellow: degraded (some checks failing, above minimum threshold)
- Red: unhealthy (below minimum threshold)
- Click on any status change to see the specific health check result that caused it

### Alert History

A log of notifications sent:
- Timestamp
- Alert type (pool unhealthy, pool recovered)
- Affected pool/origin
- Notification method (email/webhook)

---

## Hands-On Lab

### Lab 1: Query Load Balancer Analytics via API

```bash
# Get load balancer analytics (GraphQL-based)
# First, find your LB ID
LB_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/load_balancers" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq -r '.result[0].id')
echo "LB ID: $LB_ID"

# GraphQL analytics query for pool health events
curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"
      {
        viewer {
          zones(filter: {zoneTag: \\\"${ZONE_ID}\\\"}) {
            loadBalancingRequests(
              limit: 100,
              filter: {
                datetime_geq: \\\"$(date -v-24H -u +%Y-%m-%dT%H:%M:%SZ)\\\",
                datetime_leq: \\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\\"
              }
            ) {
              datetime
              lbName
              selectedPool {
                name
                isHealthy
              }
              requestsToPool
            }
          }
        }
      }
    \"
  }" | jq '.data.viewer.zones[0].loadBalancingRequests[:10]'
```

### Lab 2: Check Pool Health History

```bash
# Get all pool health checks
POOL_ID="your-pool-id"

curl -s "https://api.cloudflare.com/client/v4/user/load_balancing/pools/${POOL_ID}/health" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.result'

# Get pool details including origin health
curl -s "https://api.cloudflare.com/client/v4/user/load_balancing/pools/${POOL_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result | {name, enabled, origins: [.origins[] | {name, address, enabled, weight}]}'
```

### Lab 3: Simulate and Monitor a Failover

```bash
# This lab requires two pools configured
# Pool 1: primary (enabled)
# Pool 2: secondary (failover)

# Step 1: Confirm baseline traffic going to Pool 1
echo "=== Before Failover ==="
for i in {1..5}; do
  curl -s -o /dev/null -w "Pool: %{remote_ip}\n" \
    "https://api.macksportreport.com/"
done

# Step 2: Disable an origin in Pool 1 via API (simulate failure)
# (Replace with actual origin ID and pool ID)
curl -s -X PATCH "https://api.cloudflare.com/client/v4/user/load_balancing/pools/${POOL_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "origins": [
      {"name": "server-1", "address": "203.0.113.10", "enabled": false, "weight": 1},
      {"name": "server-2", "address": "203.0.113.11", "enabled": true, "weight": 1}
    ]
  }' | jq '.result.origins[] | {name, enabled}'

# Step 3: Wait for health check to detect failure
echo "Waiting for health check cycle (60 seconds)..."
sleep 65

# Step 4: Check pool health
curl -s "https://api.cloudflare.com/client/v4/user/load_balancing/pools/${POOL_ID}/health" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.result'

# Step 5: Re-enable the origin
curl -s -X PATCH "https://api.cloudflare.com/client/v4/user/load_balancing/pools/${POOL_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "origins": [
      {"name": "server-1", "address": "203.0.113.10", "enabled": true, "weight": 1},
      {"name": "server-2", "address": "203.0.113.11", "enabled": true, "weight": 1}
    ]
  }' | jq '.result.origins[] | {name, enabled}'
```

### Lab 4: Export Analytics Data

```bash
# Generate a summary report of LB health events
# Using the Load Balancing Audit Log API

curl -s "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/load_balancers/preview?load_balancer_id=${LB_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.'

# Poll pool health continuously (for monitoring scripts)
while true; do
  HEALTH=$(curl -s "https://api.cloudflare.com/client/v4/user/load_balancing/pools/${POOL_ID}/health" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" | jq -r '.result | to_entries[] | "\(.key): \(.value.healthy)"')
  echo "$(date -u): $HEALTH"
  sleep 30
done
```

---

## Demo Script (2 Minutes)

**Audience:** On-call engineer, SRE, DevOps lead

**Opening:**
> "You had an incident last night. macksportreport.com was partially down from 2:15 to 2:29 AM. Let me walk you through exactly what happened using Load Balancing Analytics."

**Show:**
1. Traffic → Load Balancing → Analytics → set time range to yesterday night
2. Show the traffic distribution chart: "Pool 1 drops here at 2:15. Pool 2 picks up the traffic."
3. Click on the failover event: "US-East pool became unhealthy. Three consecutive health check failures starting at 2:13 AM."
4. Show origin health: "Origin `server-2` failed. It passed the minimum_origins threshold — dropped pool health to 0 out of 2."
5. Show recovery: "At 2:29 AM, health checks pass again. Traffic redistributes."

**Closer:**
> "Every incident now has a forensic trail. You don't need to guess — you can see exactly which server, at what time, caused the failover. That's the difference between reactive firefighting and proactive infrastructure management."

---

## Competitive Context

| Observability Feature | Cloudflare LB Analytics | AWS ALB | Route 53 Health Checks |
|----------------------|------------------------|---------|----------------------|
| Traffic distribution chart | Yes | Yes (CloudWatch) | No |
| Failover event history | Yes | Partial (CloudTrail) | Yes |
| Origin health history | Yes | Yes (Target Group health) | Yes |
| Real-time pool health | Yes | Yes | Yes |
| Notification history | Yes | Yes (CloudWatch Alarms) | Yes |
| Cross-cloud visibility | Yes | AWS-only | Yes |
| GraphQL analytics API | Yes | No | No |
| Single pane with CDN | Yes | No | No |

**Key advantage:** Cloudflare LB Analytics is in the same dashboard as your CDN, WAF, and Workers analytics. No context switching between AWS Console, CloudWatch, and Route 53 consoles. Single pane of glass.

---

## Self-Check Questions

**Q1: What does a "traffic distribution flap" look like on the LB Analytics chart and what causes it?**

```
Your answer:




```

**Q2: You're investigating an incident that happened last Wednesday at 3 PM UTC. You have LB Analytics access. List the three specific data points you'd check first and explain why.**

```
Your answer:




```

**Q3: A pool has 4 origins. `minimum_origins` is set to 3. Two origins fail health checks simultaneously. What happens to pool health and traffic routing?**

```
Your answer:




```

**Q4: How would you use LB Analytics data to make a capacity planning recommendation for the failover pool?**

```
Your answer:




```

**Q5: Health check intervals are set to 60 seconds with 2 retries. What is the maximum time before an unhealthy origin is removed from rotation? Show your calculation.**

```
Your answer:




```

---

## Sources

- [Cloudflare Load Balancing Analytics](https://developers.cloudflare.com/load-balancing/reference/analytics/)
- [Load Balancing API — Pool Health](https://developers.cloudflare.com/api/operations/load-balancer-pool-health-details)
- [Cloudflare GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/)
- [Load Balancing Troubleshooting](https://developers.cloudflare.com/load-balancing/troubleshooting/)
- [Health Check Reference](https://developers.cloudflare.com/load-balancing/monitors/)
- [Cloudflare Blog: Load Balancing Observability](https://blog.cloudflare.com/cloudflare-load-balancer/)
