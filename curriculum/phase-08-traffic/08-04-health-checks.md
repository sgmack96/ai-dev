# Module 8.4 — Health Checks (Standalone)
> Dashboard Location: macksportreport.com → Traffic → Health Checks
> Estimated Time: 45 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Are Standalone Health Checks?

Standalone Health Checks are uptime monitoring probes that test whether your origin servers (or any HTTP/TCP endpoint) are responding correctly — without being tied to Load Balancing or any traffic routing logic.

**The distinction is critical:**
- **Load Balancing health checks:** monitors that drive routing decisions — if they fail, traffic shifts
- **Standalone health checks:** monitors that drive alerts — if they fail, you get notified

Think of standalone health checks as **Cloudflare's built-in uptime monitoring** — similar to Pingdom, UptimeRobot, or Datadog synthetics, but native to the Cloudflare dashboard and available to any zone.

### What Problem Do Standalone Health Checks Solve?

Without health checks, you find out your origin is down when a user tells you (or your SLA gets violated).

With health checks:
- You know within 60-180 seconds of a failure
- You receive an alert via email, webhook, or PagerDuty
- You can see historical uptime for capacity planning and SLA reporting
- You can detect partial failures: slow responses, wrong status codes, missing content

### Health Check Types

**HTTP/HTTPS:**
- Sends an HTTP GET or HEAD request to a specified URL
- Verifies: HTTP status code, optional response body content
- Most comprehensive — validates application layer, not just network

**TCP:**
- Opens a TCP connection to host:port
- Verifies: port is accepting connections
- No HTTP layer — appropriate for non-HTTP services (database proxies, game servers, custom protocols)
- Lower overhead than HTTP checks

**ICMP (Ping):**
- Sends ICMP echo request
- Verifies: host is reachable at IP layer
- Many hosts block ICMP — not reliable for modern cloud infrastructure
- Use TCP or HTTP instead for most cases

### How Health Checks Work

1. Cloudflare's probing infrastructure selects the configured regions
2. From each selected region, Cloudflare sends a probe to your endpoint
3. The probe evaluates the response against your configured criteria:
   - Did the connection succeed?
   - Did the response arrive within the timeout?
   - Did the HTTP status code match?
   - Does the response body contain the expected string?
4. If ALL configured regions agree the check failed (or a threshold is met), the check status changes
5. Notification is sent via configured channels

### Health Check vs Synthetic Monitoring vs Real User Monitoring

| Type | What It Tests | Who Runs It | Data |
|------|--------------|-------------|------|
| Health Check | Origin responds correctly | Cloudflare PoPs | Binary pass/fail + response time |
| Synthetic Monitoring | Full user journey | Headless browser | Waterfall, screenshots, full page |
| Real User Monitoring | What actual users experience | User browsers | Field data, CWV, actual latency |

Standalone health checks are the simplest tier — binary availability and basic response time. Not a substitute for full synthetic monitoring or RUM.

---

## Deep Dive (Architect-Level)

### Full Configuration Reference

```json
{
  "description": "Production API Health Check",
  "type": "https",
  "method": "GET",
  "path": "/api/health",
  "port": 443,
  "header": {
    "Host": ["api.macksportreport.com"],
    "Authorization": ["Bearer health-check-token"],
    "X-Probe-Source": ["cloudflare"]
  },
  "timeout": 5,
  "retries": 2,
  "interval": 60,
  "consecutive_up": 2,
  "consecutive_down": 2,
  "expected_codes": "200",
  "expected_body": "{\"status\":\"healthy\"}",
  "follow_redirects": false,
  "allow_insecure": false
}
```

**`consecutive_up` / `consecutive_down`:**
- `consecutive_down = 2`: mark unhealthy after 2 consecutive failures
- `consecutive_up = 2`: mark healthy after 2 consecutive successes
- This prevents flapping on borderline endpoints

**`follow_redirects = false`:**
By default, health checks don't follow 301/302 redirects. If your health endpoint redirects, either:
1. Set `follow_redirects: true`, OR
2. Use the final destination URL directly, OR
3. Add the redirect status code to `expected_codes` (e.g., `"301,200"`)

**Custom headers:**
Useful for:
- Bypassing WAF rules that might block health check probes
- Passing authentication to a protected health endpoint
- Adding traceability (`X-Probe-Source: cloudflare`)

**`expected_body`:**
String match against the response body. Cloudflare checks if the body **contains** the string (not exact match). Use a unique string that your health endpoint returns only when truly healthy:

```json
// Good health endpoint response
{"status":"healthy","db":"connected","cache":"connected","timestamp":1700000000}

// Config: expected_body = "\"status\":\"healthy\""
// This will FAIL if db or cache is down and your app changes the status field
```

### Health Check Regions

Cloudflare probes from multiple geographic regions:
- WNAM (Western North America)
- ENAM (Eastern North America)
- WEU (Western Europe)
- EEU (Eastern Europe)
- NSAM (South America)
- SEAS (Southeast Asia)
- NEAS (Northeast Asia)
- ALL (all available regions)

**Best practice:** Select 2-3 regions that represent your primary user geographies. Multi-region health checks provide:
- More accurate results (single-region failure could be a regional Cloudflare issue, not your origin)
- Visibility into geographic availability (is your origin healthy from Asia but not from Europe?)

**Aggregation logic:** By default, if a majority of selected regions report failure, the check is marked unhealthy. This prevents single-region network events from causing false positives.

### Health Endpoint Best Practices

Design your `/health` or `/status` endpoint to:

**Check dependencies, not just the app process:**
```javascript
// Workers health endpoint example
app.get('/health', async (c) => {
  const checks = {};
  
  // Check database connectivity
  try {
    await c.env.DB.prepare("SELECT 1").run();
    checks.database = "ok";
  } catch (e) {
    checks.database = "error";
  }

  // Check cache connectivity
  try {
    await c.env.KV.get("__health_check__");
    checks.cache = "ok";
  } catch (e) {
    checks.cache = "error";
  }

  const allHealthy = Object.values(checks).every(v => v === "ok");
  
  return c.json({
    status: allHealthy ? "healthy" : "degraded",
    checks
  }, allHealthy ? 200 : 503);
});
```

**Return 503 (not 200) when unhealthy:**
Cloudflare health checks look for the expected status code. If your app is broken but still returns 200, the health check passes — and that's wrong. Return 503 when your service is unhealthy so the health check (and downstream systems) know.

**Keep it fast:**
Health endpoints should respond in <100ms. If the health check itself is slow, it may timeout and cause false negatives.

**Protect it appropriately:**
The health endpoint should not expose sensitive data. But it also shouldn't require authentication that might fail independently of your app's core health. Consider:
- IP allowlist (Cloudflare probe IPs)
- Shared secret header (obscure, not truly secure)
- Keep the endpoint simple and separate from authenticated endpoints

### Cloudflare Probe IP Addresses

Cloudflare health checks originate from Cloudflare IPs. If your origin has a firewall allowlisting inbound connections, you must allow Cloudflare's IP ranges:

```bash
# Get Cloudflare IP ranges
curl -s https://www.cloudflare.com/ips-v4
curl -s https://www.cloudflare.com/ips-v6

# Sample IPs (not exhaustive — always use the above URLs):
# 103.21.244.0/22
# 103.22.200.0/22
# 103.31.4.0/22
# 104.16.0.0/13
# 141.101.64.0/18
```

**Important:** If you use WAF rules that block suspicious user agents or rate limit requests, ensure Cloudflare health check probes are excluded. The health check user agent is typically `Mozilla/5.0 (compatible; CloudflareHealthCheck/1.0)` — create a WAF rule to allow this agent from Cloudflare IPs.

### Notification Channels

**Email:**
- Immediate notification on status change
- Configured per health check
- Rate-limited to prevent alert storms (Cloudflare will not send more than 1 alert per 30 minutes for the same check)

**Webhooks:**
- HTTP POST to a configured URL on status change
- Payload includes: check name, status, timestamp, origin details
- Integrate with: Slack, PagerDuty, Opsgenie, custom automation

**PagerDuty Integration:**
- Native integration via PagerDuty service key
- Creates/resolves PagerDuty incidents automatically
- Links to Cloudflare dashboard from PagerDuty

**Notification Payload Example:**
```json
{
  "name": "Production API Health Check",
  "status": "Unhealthy",
  "origin": "203.0.113.1",
  "response_code": null,
  "failure_reason": "Connection timed out",
  "timestamp": "2025-01-15T14:23:45Z",
  "check_regions": ["WNAM", "ENAM"],
  "check_url": "https://api.macksportreport.com/health"
}
```

---

## Dashboard Walkthrough

**Navigation:** macksportreport.com → Traffic → Health Checks

### Create a Health Check

1. Click **Create Health Check**
2. **Name:** `production-api-check`
3. **Monitor Type:** HTTPS
4. **URL:** `https://api.macksportreport.com/health`
5. **Request Method:** GET
6. **Response Code:** 200
7. **Response Body:** `healthy`
8. **Interval:** 60 seconds
9. **Retries:** 2
10. **Timeout:** 5 seconds
11. **Health Check Regions:** Select WNAM, ENAM, WEU (3 regions)
12. **Consecutive failures before marking down:** 2
13. **Consecutive successes before marking healthy:** 2
14. **Notifications:** Add email address
15. Click **Save**

### View Health Check Status

After creation, the health check appears in the list with:
- **Status indicator:** Green (healthy) or Red (unhealthy)
- **Response time:** Latest probe response time
- **Last check:** Timestamp of most recent probe
- **Uptime:** Percentage uptime over the last 24h/7d/30d

Click on a health check to see:
- Per-region status breakdown
- Response time trend graph
- Recent check history (pass/fail log)

### Edit or Pause a Health Check

1. Click the three-dot menu on a health check
2. Options: Edit, Pause, Delete
3. **Pause** is useful during maintenance windows — prevents false alerts when you're intentionally taking an origin offline

---

## Hands-On Lab

### Lab 1: Create a Health Check via API

```bash
# Create a standalone health check (not tied to Load Balancing)
# Note: standalone checks use the /healthchecks endpoint, NOT /load_balancing/monitors

curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/healthchecks" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "production-api-health",
    "description": "Production API availability check",
    "address": "api.macksportreport.com",
    "type": "HTTPS",
    "port": 443,
    "path": "/health",
    "method": "GET",
    "timeout": 5,
    "retries": 2,
    "interval": 60,
    "consecutive_up": 2,
    "consecutive_down": 2,
    "expected_codes": "200",
    "expected_body": "healthy",
    "follow_redirects": false,
    "allow_insecure": false,
    "check_regions": ["WNAM", "ENAM", "WEU"],
    "suspended": false,
    "notification_email": "alerts@yourdomain.com",
    "notification_suspended": false
  }' | jq '.result | {id, name, type, address, status}'

# Save the health check ID
HC_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/healthchecks" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq -r '.result[0].id')
echo "Health Check ID: $HC_ID"
```

### Lab 2: List and Monitor Health Checks

```bash
# List all health checks for the zone
curl -s "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/healthchecks" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result[] | {name, type, address, status, created_on}'

# Get detailed status of a specific health check
curl -s "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/healthchecks/${HC_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result | {name, status, failure_reason, checked_at}'
```

### Lab 3: Build a Simple Health Endpoint

```bash
# Create a simple health endpoint using Cloudflare Workers

mkdir health-worker && cd health-worker

cat > wrangler.toml << 'EOF'
name = "health-endpoint"
main = "src/index.js"
compatibility_date = "2024-09-23"

[[d1_databases]]
binding = "DB"
database_name = "macksportreport-db"
database_id = "your-d1-database-id"
EOF

cat > src/index.js << 'EOF'
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/health') {
      return new Response('Not Found', { status: 404 });
    }

    const checks = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      checks: {}
    };

    // Check D1 database
    try {
      await env.DB.prepare('SELECT 1').run();
      checks.checks.database = 'ok';
    } catch (e) {
      checks.checks.database = 'error: ' + e.message;
      checks.status = 'degraded';
    }

    const statusCode = checks.status === 'healthy' ? 200 : 503;

    return new Response(JSON.stringify(checks), {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'  // Never cache health check responses
      }
    });
  }
};
EOF

npx wrangler deploy
```

### Lab 4: Test Health Endpoint Responses

```bash
# Test the health endpoint manually
curl -s -v "https://health-endpoint.your-subdomain.workers.dev/health" | jq '.'

# Test what the health check probe sees
# Simulate Cloudflare's check
curl -s \
  -H "User-Agent: Mozilla/5.0 (compatible; CloudflareHealthCheck/1.0)" \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_starttransfer}s\n" \
  "https://api.macksportreport.com/health"

# Test from multiple regions using curl's --resolve
# (Requires knowing PoP IPs, use for testing only)
curl -s "https://api.macksportreport.com/health" \
  -H "CF-Connecting-IP: 1.1.1.1" \  # Spoof check from CF PoP region
  -w "Status: %{http_code}\n"
```

### Lab 5: Pause and Resume During Maintenance

```bash
# Pause health check during maintenance (prevent false alerts)
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/healthchecks/${HC_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"suspended": true}' | jq '.result | {name, suspended}'

# Perform maintenance...
echo "Performing maintenance..."
sleep 5

# Resume health check
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/healthchecks/${HC_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"suspended": false}' | jq '.result | {name, suspended}'
```

---

## Demo Script (2 Minutes)

**Audience:** Developer, SRE, startup founder who doesn't have monitoring yet

**Opening:**
> "You built macksportreport.com. You deployed it. How do you know right now, at 3 AM on a Saturday, whether it's up or down? Health Checks. Let me show you five minutes of setup that replaces Pingdom."

**Show:**
1. Traffic → Health Checks → "One check, watching the production API, from three global regions"
2. Click on the check: "Green across WNAM, ENAM, WEU. Response time 87ms."
3. Show the response time graph: "If this started climbing toward your 5-second timeout, that's your early warning signal"
4. Show notification settings: "Email when it goes down. Email when it comes back."

**Closer:**
> "Zero extra tooling, zero cost on most plans. And if you're already paying for Load Balancing, these standalone checks are included. One less thing to manage outside Cloudflare."

---

## Competitive Context

| Feature | CF Health Checks | Pingdom | UptimeRobot | Datadog Synthetics |
|---------|-----------------|---------|-------------|-------------------|
| Price | Included/small fee | $15+/mo | Free / $7+/mo | $5/1000 tests |
| Check interval | 60s min | 30s | 5-min free | 1 min |
| HTTP checks | Yes | Yes | Yes | Yes |
| TCP checks | Yes | Yes | Yes | Yes |
| Multi-region | Yes (7 regions) | Yes (100+ nodes) | Yes (50+ locations) | Yes (global) |
| Response body check | Yes | Yes | Yes | Yes |
| Custom headers | Yes | Yes | Limited | Yes |
| PagerDuty integration | Yes | Yes | Yes | Yes |
| Already in your dashboard | Yes | No | No | No |
| LB integration | Yes (native) | No | No | No |

**Cloudflare wins:** Already in the dashboard, native LB integration, free for most plans. Zero additional tooling.

**Competitors win:** Cloudflare check interval minimum is 60 seconds (Pro/Business). Pingdom offers 30s. For sub-minute detection SLAs, a dedicated monitoring tool is better.

---

## Self-Check Questions

**Q1: What is the difference between a Standalone Health Check and a Load Balancing health check (monitor)? When would you use each?**

```
Your answer:




```

**Q2: Your health check is configured with interval=60, retries=2, consecutive_down=2. What is the maximum time before Cloudflare sends an alert after an origin fails? Show the calculation.**

```
Your answer:




```

**Q3: A customer's health check keeps failing with "Connection refused" but they can curl the endpoint manually and it responds correctly. What are three possible causes?**

```
Your answer:




```

**Q4: What HTTP status code should a health endpoint return when the application is running but the database is down? Why?**

```
Your answer:




```

**Q5: Why should health check responses have `Cache-Control: no-store`? What would happen if they were cached?**

```
Your answer:




```

---

## Sources

- [Cloudflare Health Checks Documentation](https://developers.cloudflare.com/health-checks/)
- [Health Check API Reference](https://developers.cloudflare.com/api/operations/health-checks-list-health-checks)
- [Cloudflare IP Ranges](https://www.cloudflare.com/ips/)
- [Health Check Notifications](https://developers.cloudflare.com/notifications/notification-available/#health-checks)
- [Load Balancing Monitors vs Standalone Checks](https://developers.cloudflare.com/load-balancing/monitors/)
- [Best Practices for Health Endpoints — Google SRE Book](https://sre.google/sre-book/monitoring-distributed-systems/)
- [HTTP Semantics — 503 Service Unavailable (RFC 9110)](https://www.rfc-editor.org/rfc/rfc9110#section-15.6.4)
