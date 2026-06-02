# Module 8.2 — Load Balancing
> Dashboard Location: macksportreport.com → Traffic → Load Balancing
> Estimated Time: 90 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### Why Load Balancing Exists

Load balancing solves two fundamental problems:
1. **Availability:** If one server goes down, traffic must automatically shift to a healthy one
2. **Scalability:** As traffic grows, distribute it across multiple servers so no single server is overwhelmed

Without load balancing, your architecture has a single point of failure. With it, you can take servers down for maintenance, survive hardware failures, and scale horizontally.

### The Four Core Concepts

**Load Balancer:**
The Cloudflare Load Balancer is a DNS hostname in your zone that points to a load-balancing configuration instead of a fixed IP. When users resolve `api.macksportreport.com`, Cloudflare's load balancer decides which pool (and which origin within that pool) to send them to.

**Pool:**
A pool is a logical grouping of origin servers that can serve traffic together. You might have:
- `us-east-pool`: servers in AWS us-east-1
- `us-west-pool`: servers in AWS us-west-2
- `eu-west-pool`: servers in AWS eu-west-1

Pools have a health threshold: if fewer than X% of origins are healthy, the pool itself is considered unhealthy and traffic fails over to the next pool.

**Origin:**
An individual server within a pool. Defined by:
- IP address or hostname
- Port
- Weight (how much traffic to send relative to other origins in the pool)
- Header (optional custom Host header to send)

**Health Check:**
An active probe that Cloudflare sends to origins to determine if they're alive and responsive. Health checks run on a configurable interval from multiple Cloudflare regions. If an origin fails, it's removed from rotation. When it recovers, it's added back.

### Steering Policies

How Cloudflare decides which pool (and which origin) gets each request.

**Off (Failover Only):**
- Primary pool always receives traffic
- If primary pool becomes unhealthy (below health threshold), traffic shifts to secondary pool
- Secondary is purely a failover destination, not a load-sharing destination
- Use case: Active/passive DR setup

**Random (Round-Robin):**
- Requests are distributed randomly across pools
- Stateless distribution — no session awareness
- Simple, but doesn't account for geographic proximity or pool health/capacity
- Use case: Pools of equal capacity in same region

**Hash:**
- Consistent hashing based on a key: client IP, request URL, or custom HTTP header
- Same client always goes to the same pool (pseudo-session affinity without cookies)
- Use case: Caching layers where same keys should go to same backend, or session-less sticky routing

**Geo Steering:**
- Route users to different pools based on their geographic region
- Cloudflare maps user IP → country → configured region
- Custom regions: configure which countries map to which pool
- Default pool: catch-all for unmapped regions
- Use case: GDPR data residency requirements, serving localized content

**Proximity Steering:**
- Route to the pool with the lowest geographic distance (lat/lng) from the user
- Uses Cloudflare's geolocation of the user and each pool's configured coordinates
- More granular than region-based steering
- Use case: Multi-region setup where geographic distance correlates with latency

**Least Outstanding Requests:**
- Route to the pool with the fewest requests currently being processed
- Prevents overloading a pool that's slow to respond
- Adaptive to real-time pool capacity
- Use case: API servers where request processing time varies significantly

**Least Connections:**
- Route based on active TCP connection count per pool
- Similar to Least Outstanding Requests but connection-count based
- Use case: Long-lived connections (WebSockets, gRPC streaming)

**Dynamic Steering (Argo-powered):**
- Uses Cloudflare's real-time Argo latency measurements between CF PoPs and your origins
- Automatically routes to the pool with the lowest measured latency
- Updates routing decisions every few seconds as latency changes
- Use case: Globally distributed origins where best-latency origin varies by geography and time
- Requires Argo Smart Routing to be enabled

### Health Check Configuration

**HTTP/HTTPS health checks:**
- Cloudflare sends GET or HEAD requests to a configured path
- Checks: HTTP status code, optional response body string
- Expected codes: `2xx`, `200`, `200,301`, etc.
- Body match: response must contain a specific string (e.g., `"status":"ok"`)

**TCP health checks:**
- Simply test if a TCP port accepts connections
- No HTTP layer validation
- Use for non-HTTP services (custom TCP servers, databases via proxy)

**Check intervals:**
- Minimum: 60 seconds (Free/Pro), can be lower on Enterprise
- Recommended: 60-120 seconds for most use cases
- High-frequency: 30 seconds for critical services

**Retry logic:**
- Retries: number of consecutive failures before marking unhealthy
- Timeout: seconds to wait for a response before counting as failure
- Typical: 2-3 retries, 5-second timeout

**Health check regions:**
- Choose which Cloudflare regions run the health checks
- Recommended: 2-3 regions for accurate health assessment
- All regions: health check from 7+ global regions

**Notifications:**
- Email when pool health changes (healthy → unhealthy, unhealthy → healthy)
- Webhook support for PagerDuty, Slack, custom endpoints

---

## Deep Dive (Architect-Level)

### Load Balancer Architecture Diagram

```
                            Cloudflare Edge
                           ┌─────────────────┐
User DNS query             │                 │
api.macksportreport.com ──►│  Load Balancer  │
                           │  (steering policy│
                           │  evaluation)     │
                           └────────┬────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
           ┌────────────┐  ┌────────────┐  ┌────────────┐
           │  US-East   │  │  US-West   │  │  EU-West   │
           │    Pool    │  │    Pool    │  │    Pool    │
           │ (healthy)  │  │ (healthy)  │  │ (healthy)  │
           └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
                 │               │               │
           ┌─────┴──────┐  ┌─────┴──────┐  ┌─────┴──────┐
           │  origin1   │  │  origin3   │  │  origin5   │
           │  origin2   │  │  origin4   │  │  origin6   │
           │ (w=1, w=1) │  │ (w=2, w=1) │  │ (w=1, w=1) │
           └────────────┘  └────────────┘  └────────────┘
```

### Failover Configuration in Depth

Failover is defined by pool **order** in the load balancer configuration:

```json
{
  "fallback_pool": "pool-3-eu-fallback",
  "default_pools": ["pool-1-us-east", "pool-2-us-west"],
  "steering_policy": "off",
  "session_affinity": "cookie"
}
```

**Failover priority:**
1. Traffic goes to `pool-1-us-east` (first in `default_pools`)
2. If `pool-1-us-east` becomes unhealthy, traffic shifts to `pool-2-us-west`
3. If both become unhealthy, traffic shifts to `fallback_pool`

**Pool health threshold:**
```json
{
  "minimum_origins": 1,
  "notification_threshold": 1
}
```
- `minimum_origins`: minimum healthy origins for the pool to be considered healthy
- `notification_threshold`: send alert when this many origins become unhealthy

### Session Affinity Deep Dive

Session affinity ensures a user's requests always go to the same origin (useful for stateful applications — shopping carts, user sessions in memory, etc.).

**Cookie-based affinity:**
- Cloudflare sets a cookie (`CF_LB_AFFINITY` or custom name) on the first response
- Cookie contains encoded pool/origin selection
- Subsequent requests with the cookie are routed to the same origin
- Cookie TTL configurable: session-length (browser close) or persistent
- Works across load balancer steering policy

**IP-based affinity:**
- Hash the client IP to determine origin
- Simpler than cookie (no state), but less reliable (IP can change — IPv6 rotation, mobile users)
- Prefer cookie for session affinity

**Header-based affinity:**
- Route based on a specific HTTP header value (e.g., `X-User-ID`)
- Useful for microservices or API gateways that set user identity headers

**Origin drain:**
Session affinity creates a challenge when removing an origin for maintenance. Use **drain time**:
```
drain time: 300 seconds (5 minutes)
```
When an origin is marked for drain:
1. No new sessions are routed to it
2. Existing sessions continue for up to `drain_time` seconds
3. After drain_time, existing sessions are migrated to healthy origins

### Origin Weights

Within a pool, origins can have different weights:

```json
{
  "origins": [
    {"name": "server1", "address": "203.0.113.1", "weight": 2},
    {"name": "server2", "address": "203.0.113.2", "weight": 1},
    {"name": "canary",  "address": "203.0.113.3", "weight": 0.1}
  ]
}
```

Traffic distribution:
- server1: 2/(2+1+0.1) = 64.5%
- server2: 1/(2+1+0.1) = 32.3%
- canary: 0.1/(2+1+0.1) = 3.2%

**Canary deployment pattern:** Add a new server as an origin with low weight (e.g., 0.1) to receive ~3% of traffic before full rollout.

### Geo Steering Configuration

```json
{
  "steering_policy": "geo",
  "location_strategy": {
    "prefer_ecs": "always",
    "mode": "resolver_ip"
  },
  "region_pools": {
    "WNAM": ["us-west-pool", "us-east-pool"],
    "ENAM": ["us-east-pool", "us-west-pool"],
    "WEU":  ["eu-west-pool", "us-east-pool"],
    "EEU":  ["eu-east-pool", "eu-west-pool"],
    "SEAS": ["apac-pool", "us-west-pool"],
    "NEAS": ["apac-pool", "us-west-pool"],
    "WAFR": ["eu-west-pool", "us-east-pool"],
    "default": ["us-east-pool"]
  },
  "country_pools": {
    "US": ["us-east-pool", "us-west-pool"],
    "DE": ["eu-west-pool", "eu-east-pool"],
    "GB": ["eu-west-pool"]
  }
}
```

**`prefer_ecs`:** Use EDNS Client Subnet data from DNS resolvers (provides more accurate geo info when resolver supports ECS). Recommended: `always`.

### Load Balancing with Cloudflare Workers

Workers can act as a programmable load balancer using `fetch()`:

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const userId = request.headers.get('X-User-ID');

    // Custom routing logic
    let origin;
    if (userId && userId.startsWith('enterprise-')) {
      origin = 'https://enterprise-api.macksportreport.com';
    } else if (url.pathname.startsWith('/api/v2/')) {
      origin = 'https://api-v2.macksportreport.com';
    } else {
      // Round-robin between origins
      const origins = [
        'https://origin1.macksportreport.com',
        'https://origin2.macksportreport.com',
      ];
      origin = origins[Math.floor(Math.random() * origins.length)];
    }

    return fetch(new Request(origin + url.pathname + url.search, request));
  }
};
```

For simple failover + health check use cases, the Cloudflare Load Balancer is easier. For complex routing logic that depends on request content, Workers provide more flexibility.

### Enterprise Limits vs Lower Plans

| Feature | Free | Pro | Business | Enterprise |
|---------|------|-----|----------|------------|
| Load balancers | 0 | 0 | 0 | 5+ |
| Pools per LB | — | — | — | 100 |
| Origins per pool | — | — | — | 100 |
| Health check interval | — | — | — | 10s min |
| Geo steering | No | No | No | Yes |
| Dynamic steering | No | No | No | Yes |
| Session affinity | No | No | No | Yes |
| Argo steering | No | No | No | Yes |

**Pricing (add-on):** Starts at $5/month for basic, scales with pool count and health check volume. Enterprise has custom pricing.

---

## Dashboard Walkthrough

**Navigation:** macksportreport.com → Traffic → Load Balancing

### Create a Health Check

1. Traffic → Load Balancing → Health Checks tab
2. Click **Create**
3. Configure:
   - Name: `api-health-check`
   - Monitor Type: HTTP
   - URL: `https://macksportreport.com/health`
   - Method: GET
   - Expected Status: 200
   - Expected Body: `{"status":"ok"}`
   - Interval: 60 seconds
   - Timeout: 5 seconds
   - Retries: 2
4. **Notifications:** Add email for alerts
5. Click **Save**

### Create a Pool

1. Traffic → Load Balancing → Origin Pools tab
2. Click **Create pool**
3. Configure:
   - Pool Name: `us-east-production`
   - Description: "US East production servers"
4. Add origins:
   - Origin Name: `server-1`, Address: `203.0.113.10`, Weight: 1
   - Origin Name: `server-2`, Address: `203.0.113.11`, Weight: 1
5. Health Check: Select the health check created above
6. Notification Email: your email
7. **Minimum Origins:** 1 (pool healthy if at least 1 origin is healthy)
8. Click **Save**

### Create a Load Balancer

1. Traffic → Load Balancing → Load Balancers tab
2. Click **Create load balancer**
3. Hostname: `api.macksportreport.com`
4. Proxy status: Proxied (orange cloud)
5. **Add pools** in priority order:
   - Pool 1: `us-east-production` (primary)
   - Pool 2: `us-west-production` (failover)
6. **Steering Policy:** Off (failover) for this example
7. **Session Affinity:** Cookie-based (optional)
8. **Fallback Pool:** Select the least-preferred pool
9. Click **Save**

---

## Hands-On Lab

### Lab 1: Create Health Check via API

```bash
# Create an HTTP health check
curl -s -X POST "https://api.cloudflare.com/client/v4/user/load_balancing/monitors" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "description": "API Health Check",
    "type": "https",
    "port": 443,
    "method": "GET",
    "path": "/health",
    "header": {
      "Host": ["macksportreport.com"],
      "X-Health-Check": ["cloudflare"]
    },
    "timeout": 5,
    "retries": 2,
    "interval": 60,
    "expected_codes": "2xx",
    "expected_body": "ok",
    "follow_redirects": true,
    "allow_insecure": false
  }' | jq '.result | {id, description, type, path}'

# Save the monitor ID
MONITOR_ID=$(curl -s "https://api.cloudflare.com/client/v4/user/load_balancing/monitors" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq -r '.result[0].id')
echo "Monitor ID: $MONITOR_ID"
```

### Lab 2: Create an Origin Pool

```bash
# Create pool
curl -s -X POST "https://api.cloudflare.com/client/v4/user/load_balancing/pools" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{
    \"name\": \"us-east-production\",
    \"description\": \"US East production servers\",
    \"enabled\": true,
    \"minimum_origins\": 1,
    \"monitor\": \"${MONITOR_ID}\",
    \"notification_email\": \"you@example.com\",
    \"origins\": [
      {
        \"name\": \"server-1\",
        \"address\": \"203.0.113.10\",
        \"enabled\": true,
        \"weight\": 1
      },
      {
        \"name\": \"server-2\",
        \"address\": \"203.0.113.11\",
        \"enabled\": true,
        \"weight\": 1
      }
    ]
  }" | jq '.result | {id, name, enabled}'

POOL_ID=$(curl -s "https://api.cloudflare.com/client/v4/user/load_balancing/pools" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq -r '.result[0].id')
echo "Pool ID: $POOL_ID"
```

### Lab 3: Create the Load Balancer

```bash
# Create load balancer on the zone
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/load_balancers" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{
    \"name\": \"api.macksportreport.com\",
    \"description\": \"API Load Balancer\",
    \"ttl\": 1,
    \"proxied\": true,
    \"steering_policy\": \"off\",
    \"fallback_pool\": \"${POOL_ID}\",
    \"default_pools\": [\"${POOL_ID}\"],
    \"session_affinity\": \"cookie\",
    \"session_affinity_ttl\": 3600
  }" | jq '.result | {id, name, enabled, steering_policy}'
```

### Lab 4: Test Failover Behavior

```bash
# Simulate origin failure and observe failover
# First, check current routing
for i in {1..5}; do
  echo -n "Request $i: "
  curl -s -o /dev/null -w "%{remote_ip} - HTTP %{http_code}\n" \
    "https://api.macksportreport.com/health"
done

# Check pool health status
curl -s "https://api.cloudflare.com/client/v4/user/load_balancing/pools/${POOL_ID}/health" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.result.origins'

# Preview health for all pools
curl -s -X GET "https://api.cloudflare.com/client/v4/user/load_balancing/pools?zone_id=${ZONE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result[] | {name, enabled, origins: [.origins[] | {name, address, enabled, weight}]}'
```

### Lab 5: Dynamic Steering with Argo

```bash
# Requires Argo to be enabled on the zone
# Create a load balancer with dynamic steering
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/load_balancers" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{
    \"name\": \"dynamic.macksportreport.com\",
    \"description\": \"Dynamic Steering LB (Argo-powered)\",
    \"proxied\": true,
    \"steering_policy\": \"dynamic_latency\",
    \"fallback_pool\": \"${POOL_ID}\",
    \"default_pools\": [\"${POOL_ID}\"]
  }" | jq '.result | {id, name, steering_policy}'
```

---

## Demo Script (2 Minutes)

**Audience:** DevOps engineer, infrastructure-focused CTO

**Opening:**
> "Right now, macksportreport.com runs on one server. That means planned downtime for deployments, unplanned downtime if that server dies, and zero way to scale horizontally. Let me show you what three DNS records and a load balancer configuration changes."

**Show:**
1. Traffic → Load Balancing → show the LB configuration
2. Pool view: "Two origins, weight 1 each. Health check runs every 60 seconds."
3. Health Check tab: "Green checkmarks — both origins healthy. Watch what happens if I toggle one off."
4. Toggle an origin off, refresh → pool health changes, traffic shifts
5. Show the failover tab: "Traffic has automatically shifted. No DNS propagation delay — this is all done at the Cloudflare layer."

**Closer:**
> "Zero-downtime deployments: drain server 1, update it, bring it back, drain server 2, update it. Geo steering: Tokyo users go to your Tokyo server, New York users go to New York. Canary deployments: send 5% to the new version. All configuration, no code."

---

## Competitive Context

| Feature | Cloudflare LB | AWS ALB | AWS Route 53 | Nginx Plus |
|---------|--------------|---------|--------------|------------|
| Global anycast | Yes | No (regional) | Yes (DNS only) | No |
| Health checks | Yes | Yes | Yes | Yes |
| Geo steering | Yes | No | Yes | No |
| Dynamic steering | Yes (Argo) | No | No | No |
| Session affinity | Yes (cookie) | Yes | Limited | Yes |
| Setup complexity | Low | Medium | Medium | High |
| DDoS protection | Yes (inherited) | No | No | No |
| Price | $5+/mo | ~$16+/mo | $0.50/zone + checks | License + ops |
| Multi-cloud origins | Yes | No (AWS-only) | Yes | Yes |
| Workers integration | Yes | No | No | No |

**When Cloudflare LB wins:** Multi-cloud or hybrid origins, want DDoS protection inherited, already using Cloudflare, need Workers integration.

**When AWS ALB wins:** All origins in AWS, need advanced HTTP routing (path-based, header-based per route), need native integration with ECS/EKS/Lambda.

---

## Self-Check Questions

**Q1: What is the difference between a Load Balancer, a Pool, and an Origin? Draw the hierarchy.**

```
Your answer:




```

**Q2: A customer has three data centers: US-East (primary), US-West (secondary), and EU-West (European DR). Configure the appropriate Load Balancer steering policy and explain the failover order.**

```
Your answer:




```

**Q3: What is session affinity and when is it necessary? What are the tradeoffs of cookie-based vs IP-based affinity?**

```
Your answer:




```

**Q4: A customer wants to deploy a new version of their application to 10% of users before a full rollout. How do you configure this with Cloudflare Load Balancing?**

```
Your answer:




```

**Q5: Dynamic Steering is not working as expected. What prerequisite product must be enabled for Dynamic Steering to function?**

```
Your answer:




```

---

## Sources

- [Cloudflare Load Balancing Documentation](https://developers.cloudflare.com/load-balancing/)
- [Load Balancing Steering Policies](https://developers.cloudflare.com/load-balancing/understand-basics/traffic-steering/steering-policies/)
- [Health Checks Configuration](https://developers.cloudflare.com/load-balancing/monitors/)
- [Session Affinity](https://developers.cloudflare.com/load-balancing/understand-basics/session-affinity/)
- [Load Balancing API Reference](https://developers.cloudflare.com/api/operations/load-balancers-list-load-balancers)
- [Origin Pool Configuration](https://developers.cloudflare.com/load-balancing/pools/)
- [Dynamic Steering](https://developers.cloudflare.com/load-balancing/understand-basics/traffic-steering/steering-policies/dynamic-steering/)
- [Geo Steering](https://developers.cloudflare.com/load-balancing/understand-basics/traffic-steering/steering-policies/geo-steering/)
- [Cloudflare Blog: Load Balancing](https://blog.cloudflare.com/cloudflare-load-balancer/)
