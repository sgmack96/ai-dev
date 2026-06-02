# Module 0.1 — How Cloudflare Works

> **Dashboard Location:** This is the foundation — everything else in the dashboard assumes you understand this model.  
> **Estimated Time:** 45 minutes  
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Is Cloudflare?

Cloudflare is a **reverse proxy and edge network** that sits between your users and your origin server. When a visitor goes to `macksportreport.com`, their request hits a Cloudflare data center first — not your server. Cloudflare processes the request, applies security/performance/routing logic, and then (if needed) forwards it to your origin.

This single architectural fact — Cloudflare is in the middle of every request — is what makes every product on the dashboard possible.

### The Anycast Network

Cloudflare operates one of the world's largest **anycast networks** with 330+ data centers across 120+ countries (as of 2026). Anycast means the same IP address is announced from multiple locations simultaneously. When a user sends a packet to `104.16.x.x` (a Cloudflare IP), BGP routing automatically sends it to the nearest data center — not by geographic lookup, but by actual network topology.

**Why this matters:**
- No round-trips across the globe — users connect to the closest Cloudflare PoP
- DDoS attacks are absorbed globally, not at one origin
- Every feature (WAF, caching, Workers, etc.) runs at the edge, milliseconds from users

### The Request Lifecycle

Every HTTP request through Cloudflare follows this path:

```
User Browser
    |
    | (DNS lookup → Cloudflare IP via anycast)
    |
Cloudflare Edge (nearest PoP)
    |
    ├── 1. TLS Termination (SSL/TLS module)
    ├── 2. HTTP normalization
    ├── 3. Rules Engine evaluation (Firewall, Transform, Redirect, Cache Rules)
    ├── 4. Security checks (WAF, Bot Management, Rate Limiting, DDoS)
    ├── 5. Workers execution (if a route matches)
    ├── 6. Cache lookup (serve from cache if HIT)
    ├── 7. Origin request (if cache MISS or BYPASS)
    |       └── Origin Server (your app, VPS, S3 bucket, etc.)
    ├── 8. Response processing (headers, compression, image optimization)
    └── 9. Cache storage (if response is cacheable)
    |
User Browser receives response
```

Each numbered step corresponds to products in the Cloudflare dashboard. Understanding this pipeline is how you reason about "where does this product fit?"

### The Proxy Status — Orange Cloud vs Grey Cloud

Every DNS record in the Cloudflare dashboard has a **proxy toggle** (the orange cloud icon):

- **Orange cloud (proxied):** Traffic routes through Cloudflare. The visitor sees Cloudflare's IP, not your origin IP. All Cloudflare features (WAF, cache, Workers, etc.) apply.
- **Grey cloud (DNS only):** Cloudflare acts as a plain DNS resolver. Your real origin IP is exposed. No Cloudflare security, caching, or performance features apply.

**Golden rule:** If it's not orange, Cloudflare can't protect or accelerate it.

### What Cloudflare Does NOT Do

- Cloudflare is **not a CDN for large file hosting** — it's a network proxy. R2 handles storage.
- Cloudflare **does not host your origin** — you still need a server, VPS, or serverless backend.
- Cloudflare **cannot decrypt end-to-end encrypted traffic** it doesn't terminate (QUIC/H3 edge termination is the exception).

---

## Deep Dive (Architect-Level)

### How the Anycast Network Routes Traffic

Cloudflare peers with thousands of ISPs globally. When you register `macksportreport.com` and enable the orange cloud, Cloudflare:
1. Issues you two custom nameservers (e.g., `elmo.ns.cloudflare.com`)
2. When DNS is queried, returns one of Cloudflare's anycast IP ranges (`104.16.0.0/12`, `172.64.0.0/13`, `131.0.72.0/22`)
3. Packets destined for those IPs get routed to the nearest PoP via BGP anycast

Each PoP runs the full Cloudflare stack: `nginx`-based edge proxy, Workers runtime (V8 isolates), caching layer, WAF engine, and more.

### How Cloudflare Identifies Your Traffic at the Edge

The edge uses several mechanisms to understand and route requests:
- **Zone lookup:** The `Host` header maps to your account/zone. This is how one Cloudflare edge node handles millions of customers simultaneously.
- **Worker routes:** Pattern-matching against the URL to decide which Worker (if any) handles the request.
- **Ruleset engine:** Rules are evaluated in a defined order (phase pipeline). More on this in Module 6.1.

### TLS at the Edge

Cloudflare terminates TLS at the PoP nearest the user. This means:
- The TLS handshake happens close to the user (low latency)
- Cloudflare holds the private key for the edge certificate (your origin uses a separate cert)
- In "Full (Strict)" mode, Cloudflare also establishes a separate TLS connection to your origin

This split-TLS model is why Cloudflare can inspect, modify, and cache HTTPS traffic.

### V8 Isolates — How Workers Run at the Edge

Workers don't run in containers or VMs. They run in **V8 isolates** — lightweight JavaScript execution contexts that start in microseconds. This is how Cloudflare can run your code globally without cold starts. Each isolate is isolated from others (memory, CPU) but shares the same OS process, making them 10-100x cheaper to spin up than container-based FaaS.

---

## Dashboard Walkthrough

### Finding the Basics

1. Log in to `dash.cloudflare.com`
2. Click on your account → you see all zones (domains)
3. Click on `macksportreport.com` → you're at the zone dashboard

The left sidebar is the full product menu. Every item you listed in your question lives here.

### The Zone Overview Page

After selecting a domain:
- **Quick Actions** — Common settings shortcuts
- **Domain Summary** — Plan, nameservers, auto-renewal, registrar status
- **Recent Activity** — Last changes made
- **Security Overview** — Threat summary
- **Performance Overview** — Cache hit rate

This page is your "at a glance" health check for the zone.

### Reading the Nameserver Configuration

Under **DNS > Settings**, you'll see your assigned Cloudflare nameservers. These must match what's configured at your domain registrar for Cloudflare to work. If they don't match, the zone shows "Pending" status and no Cloudflare features apply.

---

## Hands-On Lab

### Lab 0.1: Verify Your Cloudflare Setup

**Step 1: Confirm nameservers are pointing to Cloudflare**
```bash
dig NS macksportreport.com +short
# Should return something like: elmo.ns.cloudflare.com, wanda.ns.cloudflare.com
```

**Step 2: Confirm your origin IP is hidden (proxied)**
```bash
dig A macksportreport.com +short
# Should return a Cloudflare IP (104.x.x.x or 172.x.x.x), NOT your origin IP
```

**Step 3: Verify Cloudflare is handling the request**
```bash
curl -I https://macksportreport.com
# Look for: cf-ray: <ray-id>-<airport-code>
# Example: cf-ray: 7a3b9c4d8e5f6a7b-EWR
```
The `cf-ray` header confirms the request went through Cloudflare. The airport code tells you which PoP handled it.

**Step 4: Trace the path from your machine**
```bash
traceroute macksportreport.com
# First few hops are your ISP
# You'll hit a Cloudflare IP relatively quickly (before your origin)
```

**Step 5: Check zone status in dashboard**
- Go to `dash.cloudflare.com` → `macksportreport.com` → Overview
- Confirm status shows "Active" (green)
- Note your plan tier

---

## Demo Script (2 Minutes)

> Use this when a customer asks "what does Cloudflare actually do?"

"Think of Cloudflare as a global security and performance layer that wraps around your website. When someone visits your site, their request hits one of our 330+ data centers first — the one physically closest to them. That data center handles TLS, checks for attacks, serves cached content, and only calls your origin if it actually needs to. Your server never even sees most of the traffic — bots, attacks, and cached requests all get handled before they reach you.

The reason this is architecturally interesting is that it's all built on an anycast network. Same IP address, announced from 330 locations simultaneously. BGP routes the user to the nearest point automatically, no latency penalty, no geographic lookup needed. And because we're inline on every request, every product in the dashboard — WAF, caching, Workers, bot management — runs at that same edge, milliseconds from your users."

---

## Competitive Context

| Feature | Cloudflare | AWS CloudFront | Akamai | Fastly |
|---------|-----------|----------------|--------|--------|
| **Network size** | 330+ PoPs | ~450 edge locations | 4,100+ PoPs | 60+ PoPs |
| **Free tier** | Yes (full WAF, CDN, DNS) | No | No | No |
| **Edge compute** | Workers (V8 isolates, no cold start) | Lambda@Edge (Node.js, ~100ms cold start) | EdgeWorkers | Compute@Edge |
| **Unified platform** | Single dashboard: CDN + WAF + DNS + DDoS + Workers + Zero Trust | Separate products (CloudFront, WAF, Shield, Lambda@Edge, Route53) | Fragmented | Compute-focused |
| **DDoS protection** | Unmetered, included | Priced separately (Shield Standard/Advanced) | Enterprise contract | Limited |
| **DNS** | Built-in, fastest authoritative DNS globally | Route53 (separate product) | Included in enterprise | Not included |

**Key differentiator to memorize:** Cloudflare is the only major provider where CDN + WAF + DNS + DDoS + edge compute + Zero Trust + developer platform all live under one account, one API, one billing, and run on the same network. Everyone else bolts these together from separate products.

---

## Self-Check Questions

Answer these before moving to Module 0.2:

1. A customer says "Cloudflare is just a CDN." How do you correct this in one sentence?

2. What does "anycast" mean, and why is it better than geographic load balancing for a security proxy?

3. A DNS record is set to "DNS Only" (grey cloud). Which of these still work: caching, WAF rules, Workers, DDoS protection?

4. A customer's origin IP leaked on Shodan.io. What likely caused this, and how do you fix it?

5. Walk through the 9-step request lifecycle in order from memory.

---

**Your Answers:**

1. 

2. 

3. 

4. 

5. 

---

**Sources:**
- [How Cloudflare Works](https://developers.cloudflare.com/fundamentals/concepts/how-cloudflare-works/)
- [Cloudflare Network Map](https://www.cloudflare.com/network/)
- [Cloudflare Learning: What is a CDN?](https://www.cloudflare.com/learning/cdn/what-is-a-cdn/)
- [Cloudflare Workers Architecture](https://developers.cloudflare.com/workers/reference/how-workers-works/)
- [Anycast — Cloudflare Learning](https://www.cloudflare.com/learning/cdn/glossary/anycast-network/)
