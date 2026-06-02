# Module 6.4 — Origin Rules
> **Dashboard Location:** macksportreport.com → Rules → Origin Rules
> **Estimated Time:** 50 minutes
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Are Origin Rules?

Origin Rules allow you to override **where Cloudflare sends requests** on a per-request basis, without making DNS changes or modifying your origin infrastructure. You can change:

- **Destination hostname:** which server receives the request
- **Destination port:** which port Cloudflare connects to on origin
- **Host header:** what hostname Cloudflare presents to the origin in the Host header
- **DNS resolver override:** which IP address Cloudflare resolves the origin hostname to

This is fundamentally different from your DNS records. Your DNS record might say "send traffic to `api.macksportreport.com`" — but an Origin Rule can override that for specific requests without touching DNS.

### Why Origin Rules Matter for Solutions Engineers

Origin Rules unlock use cases that customers often try to solve with expensive infrastructure changes or complex Load Balancing configurations:

1. **Multi-origin serving from one domain:** `/api/*` → API server, `/images/*` → media server, everything else → main web server
2. **Blue/green deployments without DNS changes:** Route 10% of traffic to new server by matching a cookie or header
3. **Geographic routing without Load Balancing:** Route EU traffic to EU origin, US traffic to US origin
4. **Testing backend changes:** Route a single admin IP to staging server, everyone else to production
5. **Legacy port migrations:** All requests go to new server on port 8080 while DNS catch-up propagates

### The Key Conceptual Point

Origin Rules work at the **proxy level** — Cloudflare's edge is already acting as a reverse proxy between the user and your origin. Origin Rules simply let you configure that proxy behavior dynamically, per request.

---

## Deep Dive (Architect-Level)

### The Four Override Types

#### 1. Destination Hostname Override

Changes which hostname Cloudflare resolves and connects to as the origin:

```
Match: starts_with(http.request.uri.path, "/api/")
Override hostname: api-backend.macksportreport.com
```

When a request arrives for `https://macksportreport.com/api/users`:
- **Without override:** Cloudflare connects to the origin configured in DNS (`www.backend.com`)
- **With override:** Cloudflare connects to `api-backend.macksportreport.com`
- The user still sees `macksportreport.com` in their address bar

#### 2. Destination Port Override

Changes which port Cloudflare connects to on the origin:

```
Match: http.request.uri.path starts_with "/staging/"
Override port: 8080
```

Useful when:
- New version of your app runs on port 8080 while old version is on 443/80
- Origin uses non-standard ports that would be awkward to expose in DNS
- Load balancer targets specific ports per service

**Available ports:** Cloudflare supports a specific set of allowed origin ports. The full list is in the docs, but includes common ports: 80, 81, 88, 443, 2052, 2053, 2082, 2083, 2086, 2087, 2095, 2096, 4343, 4444, 7443, 8080, 8443, 8800, 8880, 8888, 8899.

#### 3. Host Header Override

Changes the `Host:` header that Cloudflare sends to your origin:

```
Match: http.request.uri.path starts_with "/legacy/"
Override Host header: legacy.internal.macksportreport.com
```

This is critical when:
- Your origin uses **virtual hosting** (name-based hosting) and serves different content based on the Host header
- You're routing requests to an origin that expects a different hostname than the public-facing domain
- You're using an AWS ALB or similar that routes based on Host header rules

**Important nuance:** The destination hostname override (which server Cloudflare connects to) and the Host header (what Cloudflare tells the origin) can be configured independently. You can send a request to `api-server-01.internal` but send a Host header of `api.macksportreport.com`.

#### 4. DNS Override (Resolve Override)

Changes the IP address Cloudflare resolves the origin hostname to:

```
Match: ip.src.country eq "DE"
Override resolve IP: 203.0.113.50  # German data center IP
```

This bypasses Cloudflare's normal DNS resolution for the origin and forces traffic to a specific IP. Useful for:
- Canary deployments where you want specific IP-level control
- Multi-datacenter routing without changing DNS records
- Testing a new server by IP before it has a hostname

### Match Conditions for Origin Rules

Origin Rules support the full expression language. Here are the most common patterns:

```
# Route by path prefix
starts_with(http.request.uri.path, "/api/")

# Route by country
ip.src.country eq "GB"

# Route by request method
http.request.method eq "POST"

# Route by custom header (e.g., internal canary header)
http.request.headers["X-Canary"] eq "true"

# Route by cookie value (A/B routing)
http.cookie contains "variant=beta"

# Route by multiple conditions
(starts_with(http.request.uri.path, "/api/")) and
(http.request.method in {"POST" "PUT" "PATCH" "DELETE"})

# Route logged-in users to different origin (based on auth cookie presence)
http.cookie contains "session_id="

# Admin routing
(http.request.uri.path starts_with "/admin/") and
(ip.src in {10.0.0.0/8 172.16.0.0/12 192.168.0.0/16})
```

### Origin Rules vs Load Balancing

This is a critical distinction for SE conversations:

| Feature | Origin Rules | Load Balancing |
|---|---|---|
| **Health checks** | No | Yes — automatic failover |
| **Multiple backends** | One override per rule | Multiple pools with weights |
| **Failover** | No | Yes — automatic on health check failure |
| **Routing logic** | Expression-based | Geographic, weighted, random, session-affinity |
| **Sticky sessions** | No (unless you implement with cookies manually) | Yes — session affinity |
| **Pricing** | Included in plan | Additional billing (starts ~$5/month) |
| **Configuration** | Rules UI/API | Load Balancing-specific UI/API |
| **Best for** | Conditional routing, path-based routing | High-availability, traffic distribution |

**The conversation:** "If you need 'when this condition is true, send to this server' — that's Origin Rules. If you need 'distribute traffic across multiple servers and auto-failover when one goes down' — that's Load Balancing. They solve different problems and can be used together."

### The Host Header Problem: A Common Gotcha

A very common support issue: customer sets up an Origin Rule to route `/api/*` to `api.backend.com`, but the origin returns errors or wrong content.

**Root cause:** When Cloudflare connects to `api.backend.com`, it sends the **original** Host header (`macksportreport.com`). If the origin uses virtual hosting based on Host header, it doesn't find a virtual host matching `macksportreport.com` and returns an error.

**Fix:** Always set the Host header override when overriding the destination hostname:

```
Override hostname: api.backend.com
Override Host header: api.backend.com  ← ALWAYS SET THIS
```

Without the Host header override, virtual hosts, name-based backends, SNI, and AWS-style routing all break.

### Combining Origin Rules with SSL

When you override the hostname, Cloudflare needs to make an SSL connection to the new hostname. If `Full (strict)` SSL mode is enabled, the certificate at the override hostname must be valid for that hostname.

**Scenarios:**
- Override hostname has a valid cert → works fine
- Override hostname is an internal server with a self-signed cert → need `Full` (not strict) SSL, or SSL origin verification disabled for that path

This is a production gotcha customers hit frequently. Document it.

### Terraform: Origin Rules

```hcl
resource "cloudflare_ruleset" "origin_rules" {
  zone_id     = var.zone_id
  name        = "Origin Rules"
  description = "Route requests to appropriate backends"
  kind        = "zone"
  phase       = "http_request_origin"

  rules {
    action      = "route"
    action_parameters {
      origin {
        host = "api-backend.macksportreport.com"
        port = 443
      }
      host_header = "api-backend.macksportreport.com"
    }
    expression  = "starts_with(http.request.uri.path, \"/api/\")"
    description = "Route API requests to API backend"
    enabled     = true
  }

  rules {
    action      = "route"
    action_parameters {
      origin {
        host = "media.macksportreport.com"
        port = 443
      }
      host_header = "media.macksportreport.com"
    }
    expression  = "(starts_with(http.request.uri.path, \"/images/\")) or (starts_with(http.request.uri.path, \"/videos/\"))"
    description = "Route media requests to media server"
    enabled     = true
  }
}
```

---

## Dashboard Walkthrough

### Step 1: Navigate to Origin Rules
1. dash.cloudflare.com → macksportreport.com → **Rules** → **Origin Rules**
2. Empty state: no rules yet → **+ Create rule**

### Step 2: Create an API Routing Rule
1. Name: "Route /api/* to API Backend"
2. Match expression: `starts_with(http.request.uri.path, "/api/")`
3. Under "Then...":
   - **Hostname:** `api.backend.macksportreport.com`
   - **Port:** `443`
   - **Host header:** `api.backend.macksportreport.com` (important!)
4. **Save and deploy**

### Step 3: Create a Staging Routing Rule
1. New rule → Name: "Route admin IP to staging"
2. Match expression: `ip.src eq 203.0.113.1`
3. Override hostname: `staging.macksportreport.com`
4. Override Host header: `staging.macksportreport.com`
5. **Save and deploy**

### Step 4: Verify the Override
1. Using the test IP (via VPN if needed) or by checking Cloudflare logs
2. Analytics → Traffic → Logs → Look for requests where origin hostname differs from zone default

---

## Hands-On Lab

### Prerequisites
```bash
export CF_API_TOKEN="your_api_token"
export ZONE_ID="your_zone_id"
```

### Lab 1: List Origin Rules Phase

```bash
# Check if origin rules ruleset exists
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result[] | select(.phase == "http_request_origin") | {id, name, phase}'
```

### Lab 2: Create Origin Override Rule via API

```bash
# Get the origin ruleset ID (or create one)
ORIGIN_RULESET_ID=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq -r '.result[] | select(.phase == "http_request_origin") | .id')

# Create a routing rule: /api/* → different backend
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${ORIGIN_RULESET_ID}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "route",
    "action_parameters": {
      "origin": {
        "host": "api.macksportreport.com",
        "port": 443
      },
      "host_header": "api.macksportreport.com"
    },
    "expression": "starts_with(http.request.uri.path, \"/api/\")",
    "description": "Lab: Route API traffic to API backend",
    "enabled": true
  }' | jq '{id: .result.id, action: .result.action, description: .result.description}'
```

### Lab 3: Verify Routing (Using curl verbose to see origin)

```bash
# Use -v to see which host Cloudflare connects to
# Check the "Connected to" line in verbose output
curl -sv https://macksportreport.com/api/test 2>&1 | grep -E "Connected|Host|< HTTP|> Host"

# The origin Cloudflare resolves should be api.macksportreport.com, not www.macksportreport.com
```

### Lab 4: Test Country-Based Routing (Simulation)

```bash
# You can't easily simulate different IP countries in a lab
# But you can verify the rule is created and enabled:
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${ORIGIN_RULESET_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result.rules[] | {description, action, enabled, expression: .expression}'
```

### Lab 5: Add a Port Override

```bash
# Create a rule to route /staging/* to port 8080
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${ORIGIN_RULESET_ID}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "route",
    "action_parameters": {
      "origin": {
        "port": 8080
      }
    },
    "expression": "starts_with(http.request.uri.path, \"/staging/\")",
    "description": "Lab: Route /staging/* to port 8080",
    "enabled": false
  }' | jq '{id: .result.id, enabled: .result.enabled, description: .result.description}'
```

Note: `enabled: false` — we're creating it disabled so we don't break production in the lab.

---

## Demo Script (2 Minutes)

**Audience:** DevOps engineer at a startup with a monolith they're decomposing into microservices

---

*"You're pulling the API out of your monolith into a separate service. Your frontend makes requests to `api.macksportreport.com/v2/users` — that's fine. But all your third-party integrations still hit `macksportreport.com/api/users`. You don't control those URLs. Normally you'd need to run both backends simultaneously for months while partners migrate."*

[Navigate to Rules → Origin Rules → Create rule]

*"One origin rule: match requests where path starts with `/api/`. Override destination hostname to your new API service. Override the Host header so it knows what it's receiving. Save and deploy."*

*"Now every request to `macksportreport.com/api/*` gets silently routed to your new API service. Your monolith only receives the non-API traffic. Zero changes to your partners' integration code. Zero DNS changes. You can migrate services one endpoint group at a time."*

[Show Terraform snippet]

*"And because it's just a Cloudflare rule, your infrastructure team can manage it in Terraform. Add a rule, do a code review, apply it — the same workflow as any other infrastructure change. No sneaky DNS changes, no surprise cutover."*

---

## Competitive Context

| Feature | Cloudflare Origin Rules | AWS ALB Routing Rules | Nginx upstream routing | Kubernetes Ingress |
|---|---|---|---|---|
| **Path-based routing** | Yes — expression language | Yes — path-based conditions | Yes — location blocks | Yes — Ingress rules |
| **Header-based routing** | Yes | Yes | Yes | Yes (with annotations) |
| **Country-based routing** | Yes — native ip.src.country | No — needs Lambda | Via GeoIP module | No |
| **Cookie-based routing** | Yes | Yes | Yes | Via NGINX ingress |
| **Host header override** | Yes | Yes (header conditions) | Yes | Yes |
| **No infrastructure changes** | Yes — pure configuration | ALB is infra change | Nginx config = deployment | K8s config change |
| **Health checks + failover** | No — use LB for that | Yes | Upstream health checks | Yes — readiness probes |
| **Latency** | Edge-level (~0ms overhead) | Regional (~1-5ms) | Server-side (0ms overhead) | Server-side |
| **Cost** | Included in plan | ALB: ~$16/month + rules | Included (server hardware) | Included (cluster cost) |

---

## Self-Check Questions

**Question 1:** A customer has an Origin Rule routing `/api/*` to `api.backend.com`, but the API is returning 404 errors that don't match what they see when they hit `api.backend.com` directly. What is the most likely cause, and how do you fix it?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 2:** Customer wants to use Origin Rules for a blue/green deployment: 50% of traffic to `v1-app.internal`, 50% to `v2-app.internal`. Can Origin Rules do this alone? What's the limitation, and what would you recommend instead?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 3:** Describe the exact sequence of events from DNS resolution to origin connection when an Origin Rule with a hostname override fires.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 4:** When would you use a "resolve override" (DNS IP override) instead of a "hostname override"? What specific scenario requires IP-level control?

```
Your answer:
_______________________________________________
_______________________________________________
```

**Question 5:** A customer has both Origin Rules and Cloudflare Load Balancing configured. A request comes in that matches an Origin Rule. Does it go to the Load Balancer pool, or to the Origin Rule destination?

```
Your answer:
_______________________________________________
_______________________________________________
```

---

## Sources

- [Origin Rules Documentation](https://developers.cloudflare.com/rules/origin-rules/)
- [Origin Rules — Parameters](https://developers.cloudflare.com/rules/origin-rules/parameters/)
- [Origin Rules — Examples](https://developers.cloudflare.com/rules/origin-rules/examples/)
- [Rules Language Reference](https://developers.cloudflare.com/ruleset-engine/rules-language/)
- [Cloudflare Load Balancing](https://developers.cloudflare.com/load-balancing/)
- [Allowed Origin Ports](https://developers.cloudflare.com/rules/origin-rules/parameters/#port)
