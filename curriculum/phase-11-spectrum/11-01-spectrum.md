# Module 11.1 — Spectrum (TCP/UDP Proxy)
> Dashboard Location: macksportreport.com → Network → Spectrum | Estimated Time: 60 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Spectrum is Cloudflare's proxy for non-HTTP protocols. Everything Cloudflare does for HTTP — DDoS protection, IP hiding, global load balancing, Argo routing — Spectrum extends to raw TCP and UDP traffic.

**Why this matters:** Cloudflare's core product protects HTTP/HTTPS traffic on port 80 and 443. But your infrastructure runs more than web traffic:
- SSH servers (port 22) — targeted by credential stuffing attacks
- Game servers (UDP ports, custom TCP) — primary targets for volumetric DDoS
- RDP (port 3389) — constantly scanned and attacked for ransomware entry
- FTP (port 21) — legacy file transfer
- SMTP/email servers (port 25) — spam and DDoS
- Database ports exposed to the internet
- Custom protocol applications

Without Spectrum, all of these services have their real IP addresses visible to attackers. One scan of your IP range reveals your entire infrastructure. Attackers can target any exposed port directly.

**With Spectrum:**
- Traffic hits Cloudflare's anycast network first
- DDoS is absorbed at the Cloudflare edge (multi-Tbps scrubbing capacity)
- Your origin IP is hidden (Cloudflare IP is what the world sees)
- Clean traffic is forwarded to your origin via Cloudflare's network

**Plan requirement:** Spectrum is available on Developer plan for specific ports (SSH, Minecraft), and fully on Enterprise. Some use cases require pro or business tiers. Check the current plan page for exact availability.

---

## Deep Dive (Architect-Level)

### How TCP/UDP Proxying Works

For HTTP, Cloudflare can inspect and cache the payload. For TCP/UDP, Cloudflare acts as a transparent proxy:

1. Client initiates TCP connection to Cloudflare anycast IP on the configured port
2. Cloudflare accepts the connection at the nearest PoP
3. Cloudflare opens a corresponding TCP connection to your origin IP:port
4. All data is proxied bidirectionally (transparent to both client and server)
5. DDoS protection applies to the L3/L4 layer (volume, packet rate, connection rate)

**For UDP:** Similar model but connectionless. Cloudflare receives UDP packets, scrubs them, and forwards clean packets to origin.

### PROXY Protocol

When traffic is proxied, your origin server sees Cloudflare's IP as the source — not the actual client IP. For many applications, knowing the real client IP is important:
- SSH logs showing "who connected"
- Game servers showing player geography
- Rate limiting by source IP

PROXY protocol is a standard that inserts the real client IP into the TCP stream header before any application data. Applications that support PROXY protocol can read the real IP from this header.

Cloudflare Spectrum supports PROXY Protocol v1 (text) and v2 (binary). You configure it in the Spectrum app settings and your origin application must be configured to accept PROXY protocol headers.

Example PROXY protocol v1 header prepended to SSH session:
```
PROXY TCP4 203.0.113.5 198.51.100.10 64999 22\r\n
```
(real client IP, CF IP, client port, server port)

### DDoS at TCP/UDP Layer

Cloudflare's DDoS protection for Spectrum covers:
- **Volumetric:** Multi-Gbps/Tbps traffic floods — absorbed at the CF edge
- **State exhaustion:** SYN floods, connection table exhaustion attacks
- **Application-layer TCP:** Malformed packets, protocol abuse
- **Reflection/amplification (UDP):** DNS amplification, NTP amplification targeting UDP ports

For game servers specifically, Cloudflare has specialized DDoS heuristics that distinguish legitimate game traffic patterns from DDoS.

### Smart Routing (Argo)

Argo Smart Routing is available for Spectrum, routing TCP traffic over Cloudflare's optimized backbone rather than the public internet. For latency-sensitive applications (gaming, trading, interactive SSH), this can reduce latency by 15-30% by avoiding congested public internet paths.

### Load Balancing

Spectrum can forward to multiple origins (IP:port pairs) and load balance across them:
- Round-robin
- Failover (primary + backup)
- Integration with Cloudflare Load Balancing product (health checks, geo-routing)

### Use Case: Hiding Game Server IPs

This is the most common Spectrum use case for startups:

1. Game server runs on `203.0.113.10:25565` (Minecraft) or custom port
2. Spectrum app configured: external port 25565, origin `203.0.113.10:25565`
3. DNS: `mc.macksportreport.com` → Cloudflare anycast IP (not your server IP)
4. Players connect to `mc.macksportreport.com:25565`
5. DDoS hits Cloudflare, not your server
6. Your server IP is never exposed

---

## Dashboard Walkthrough

**Step 1: Find Spectrum**
1. Select `macksportreport.com` zone
2. Navigate to Network → Spectrum
3. (Note: older dashboard may show under different sections)

**Step 2: Create a Spectrum Application**
1. Click "Create a Spectrum application"
2. Configure:
   - **Application name:** `macksportreport-ssh`
   - **Protocol:** TCP
   - **External port:** 22 (what clients connect to)
   - **Origin DNS:** `origin.macksportreport.com` or direct IP
   - **Origin port:** 22
   - **Edge IP connectivity:** Shared (use CF shared anycast IP) or Dedicated
   - **PROXY protocol:** Off, v1, or v2

**Step 3: Verify DNS**
1. Add DNS record: `ssh.macksportreport.com` → CF proxied record
2. Spectrum maps the CF IP on port 22 to your origin

**Step 4: Test Connectivity**
```bash
# Test SSH through Spectrum
ssh -v user@ssh.macksportreport.com
```

**Step 5: View Traffic Analytics**
1. Spectrum app → Analytics tab
2. See: bytes transferred, connection count, attack traffic dropped

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ZONE_ID="your-zone-id"
export CF_API_TOKEN="your-cf-api-token"
```

### Lab 1: Create a Spectrum App via API (SSH)
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/spectrum/apps" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "protocol": "tcp/22",
    "dns": {
      "type": "CNAME",
      "name": "ssh.macksportreport.com"
    },
    "origin_dns": {
      "name": "origin.macksportreport.com",
      "ttl": 1200
    },
    "origin_port": 22,
    "ip_firewall": true,
    "proxy_protocol": "off",
    "tls": "off"
  }'
```

### Lab 2: Create a Spectrum App for a Game Server
```bash
# Minecraft server: TCP port 25565
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/spectrum/apps" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "protocol": "tcp/25565",
    "dns": {
      "type": "CNAME",
      "name": "mc.macksportreport.com"
    },
    "origin_dns": {
      "name": "game-server.macksportreport.com",
      "ttl": 300
    },
    "origin_port": 25565,
    "ip_firewall": true,
    "proxy_protocol": "off",
    "tls": "off",
    "traffic_type": "direct"
  }'
```

### Lab 3: Create a UDP Spectrum App
```bash
# Custom game server on UDP port 9000
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/spectrum/apps" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "protocol": "udp/9000",
    "dns": {
      "type": "CNAME",
      "name": "game.macksportreport.com"
    },
    "origin_dns": {
      "name": "game-server.macksportreport.com",
      "ttl": 300
    },
    "origin_port": 9000,
    "ip_firewall": true
  }'
```

### Lab 4: List All Spectrum Apps
```bash
curl "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/spectrum/apps" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 5: Enable PROXY Protocol to Get Real Client IP
```bash
# Update existing Spectrum app to enable PROXY protocol v2
APP_ID="your-spectrum-app-id"

curl -X PUT "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/spectrum/apps/${APP_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "protocol": "tcp/22",
    "dns": {
      "type": "CNAME",
      "name": "ssh.macksportreport.com"
    },
    "origin_dns": {
      "name": "origin.macksportreport.com",
      "ttl": 1200
    },
    "origin_port": 22,
    "ip_firewall": true,
    "proxy_protocol": "v2",
    "tls": "off"
  }'

# Configure sshd to accept PROXY protocol (install haproxy-protocol or use custom sshd)
# Or configure your nginx/HAProxy upstream to strip PROXY protocol header before SSH
```

### Lab 6: Test DDoS Protection (Simulated)
```bash
# Note: do NOT run actual DDoS tools. This simulates checking Spectrum is working.

# Verify origin IP is hidden
nslookup ssh.macksportreport.com
# Should return Cloudflare IP, not your origin IP

# Verify direct origin IP is not connectable (firewall should block non-CF IPs)
# curl --connect-timeout 5 -v tcp://YOUR_ORIGIN_IP:22
# Should fail/timeout

# Verify Spectrum connection works
ssh -v user@ssh.macksportreport.com
# Should connect successfully through Cloudflare
```

---

## Demo Script (2 Minutes)

**Audience:** Gaming startup or company with SSH/game servers exposed to the internet

**Opening (20 seconds):**
"How often does your game server get DDoS'd? What happens to your players when it does? And more importantly — have you checked if your server's IP is in any public databases right now?"

**Act 1 — Show the risk (20 seconds):**
"[Open shodan.io in browser.] This is Shodan. Any IP address connected to the internet is indexed here within hours. If your game server IP is known, it's a single command away from a 100Gbps attack. You can't stop that at the server level."

**Act 2 — Show the solution (40 seconds):**
"Spectrum proxies your TCP and UDP traffic through Cloudflare's network. [Dashboard.] Players connect to `mc.yourdomain.com`. That resolves to a Cloudflare IP. The attack hits Cloudflare — we absorb Tbps of traffic before it ever reaches your server. Your server IP? Hidden. [Show DNS — only CF IP visible.] Nobody can find it."

**Act 3 — Show the simplicity (20 seconds):**
"Setup is this: protocol = TCP, external port = 25565, origin = your server IP:25565. One form. DNS record is automatic. Your players connect the same way they always did — they don't even know."

**Close (20 seconds):**
"What's your current DDoS mitigation strategy? A lot of game companies are either paying $1,000/month for a DDoS scrubbing service or just hoping they don't get hit. Spectrum is included with the right Cloudflare plan and protects everything on every port."

---

## Competitive Context

| Feature | Cloudflare Spectrum | Path.net | Voxility | AWS Shield Advanced | Self-hosted GRE |
|---|---|---|---|---|---|
| **Protocol support** | TCP + UDP | TCP + UDP | TCP + UDP | L3/L4 any | TCP + UDP |
| **IP hiding** | Yes (CF anycast) | Yes | Yes | No (own IPs only) | Partial |
| **DDoS capacity** | Multi-Tbps | Multi-Tbps | Multi-Tbps | Multi-Tbps | Limited to ISP |
| **Argo smart routing** | Yes | No | No | No | No |
| **Setup complexity** | Low (UI/API) | Medium | High | High | Very high |
| **Custom protocols** | Any TCP/UDP port | Any | Any | Yes | Any |
| **Load balancing** | Yes | Yes | No | Yes | Manual |
| **PROXY protocol** | Yes (v1 and v2) | Varies | No | No | Manual |
| **Gaming latency** | Low (Argo available) | Low | Medium | Medium | Depends |
| **Pricing model** | Usage-based + plan | Enterprise | Enterprise | $3,000/mo base | Infrastructure cost |
| **Analytics** | Yes (per app) | Basic | Basic | CloudWatch | None |

**Key differentiator:** Spectrum is unique in combining DDoS protection, IP hiding, smart routing (Argo), and load balancing for arbitrary TCP/UDP protocols — all on the same global network that protects your HTTP traffic. No competing product integrates this tightly with a broader security platform.

---

## Self-Check Questions

**Question 1:** A customer's SSH server is being scanned and brute-force attacked 10,000 times per day. Their current IP is visible in Shodan. Describe exactly how Spectrum changes the threat model.

```
Your answer:




```

**Question 2:** What is PROXY Protocol and why do you need it with Spectrum? Give an example of an application where the absence of real client IP would cause a problem.

```
Your answer:




```

**Question 3:** Explain the difference between Cloudflare's standard HTTP DDoS protection (for zones) and Spectrum's DDoS protection. What layer does each operate at?

```
Your answer:




```

**Question 4:** A game company wants to use Spectrum for their game server but also wants to reduce latency for players in Southeast Asia connecting to servers in the US. What additional Cloudflare feature should they enable?

```
Your answer:




```

**Question 5:** A customer asks: "Can I use Spectrum to protect my MySQL database on port 3306?" Describe the technical answer and any security considerations.

```
Your answer:




```

---

## Sources

- [Cloudflare Spectrum Documentation](https://developers.cloudflare.com/spectrum/)
- [Spectrum Configuration](https://developers.cloudflare.com/spectrum/configuration/)
- [PROXY Protocol Support](https://developers.cloudflare.com/spectrum/reference/proxy-protocol/)
- [Spectrum DDoS Protection](https://developers.cloudflare.com/spectrum/reference/ddos-protection/)
- [Cloudflare DDoS Protection](https://developers.cloudflare.com/ddos-protection/)
- [Argo Smart Routing](https://developers.cloudflare.com/argo-smart-routing/)
- [PROXY Protocol Specification](https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt)
- [Cloudflare Blog: DDoS Attack Trends](https://blog.cloudflare.com/ddos-threat-report/)
