# Module 12.10 — Magic Transit
> Dashboard Location: Networks → Magic Transit | Estimated Time: 60 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Magic Transit is Cloudflare's DDoS protection service for your own IP address space. Unlike standard Cloudflare protection (which protects traffic to domains you proxy), Magic Transit protects IP prefixes you own — regardless of what protocol or application runs on those IPs.

**Who needs Magic Transit:**
- ISPs and hosting providers with their own IP blocks
- Enterprises with on-premise data centers using their own IP ranges
- Gaming companies with dedicated server IPs
- Financial institutions with direct internet presence
- Any organization that "owns" IP address space (has ASN + IP allocation from ARIN/RIPE/APNIC)

**The key distinction:** Standard Cloudflare protects `macksportreport.com` (a domain). Magic Transit protects `203.0.113.0/24` (an IP prefix you own). If attackers know your IP range, they can target it directly regardless of DNS. Magic Transit is how you protect the raw IP layer.

**How it works:**
1. Cloudflare announces your IP prefixes via BGP to the global internet
2. All traffic destined for your IPs routes to Cloudflare first (via anycast)
3. Cloudflare scrubs DDoS traffic at the edge (absorbs Tbps of attack volume)
4. Clean traffic is delivered to your network via a GRE or IPSec tunnel
5. Your servers receive clean traffic; attackers are stopped at Cloudflare's edge

**Technical prerequisite:** You must own a `/24` or larger IP prefix (256 IPs minimum) and have an autonomous system number (ASN). Cloudflare will announce your prefixes via BGP, routing the entire internet to Cloudflare first.

---

## Deep Dive (Architect-Level)

### BGP Announcement and Traffic Flow

```
Internet Client (wants to reach 203.0.113.10)
         │
         │ BGP routing table says: 203.0.113.0/24 → AS13335 (Cloudflare)
         ▼
Cloudflare Edge PoP (anycast, all CF PoPs announce your prefix)
         │
         ├─ [DDoS scrubbing: volume, state exhaustion, protocol attacks]
         ├─ [Magic Firewall: your custom L3/L4 rules]
         │
         │ Clean traffic
         ▼
Your Network (via GRE/IPSec tunnel from CF to your router)
         │
         ▼
Your Server at 203.0.113.10
```

**BGP process:**
- Cloudflare receives your Letter of Authorization (LOA) and route objects
- Cloudflare announces `203.0.113.0/24` globally from all CF PoPs
- Your existing internet transit providers may still announce your prefix (Cloudflare announces a more-specific /24 that wins longest-prefix match)
- In on-demand mode: you only activate CF announcement during attacks; normally your ISPs announce the prefix

### Anycast Scrubbing Architecture

Cloudflare operates 300+ PoPs worldwide, each participating in BGP. When your prefix is announced:
- Attack traffic from any direction hits the nearest Cloudflare PoP
- DDoS scrubbing happens at that PoP (distributed, no single choke point)
- This is why Cloudflare can absorb multi-Tbps attacks — the load is distributed across hundreds of PoPs

Without anycast: traditional DDoS scrubbing centers have a few locations. A 500 Gbps attack aimed at one scrubbing center can overwhelm it. Cloudflare's anycast model distributes the same attack across all PoPs — each sees a fraction.

### Always-On vs On-Demand

**Always-On:**
- Cloudflare permanently announces your prefixes
- All traffic always goes through Cloudflare scrubbing
- Highest protection, consistent clean traffic
- Slightly higher latency (GRE tunnel hop)

**On-Demand:**
- Normally, your ISPs announce your prefixes
- During an attack: you (or automated systems) trigger CF announcement
- Cloudflare announces more-specific routes that win BGP selection
- Attack traffic diverts to Cloudflare; clean traffic returned
- Clean traffic can also be returned to ISP (not through GRE tunnel) for lower latency

**Auto-advertisement:** Cloudflare can automate on-demand by monitoring your traffic for DDoS signals and automatically triggering advertisement without human intervention.

### Magic Firewall Integration

Magic Firewall applies L3/L4 rules to all Magic Transit traffic:

```
# Block SYN floods from specific source ranges
ip.src in {192.0.2.0/24 198.51.100.0/24} and tcp.flags.syn and not tcp.flags.ack

# Block NTP amplification attacks
udp.srcport == 123 and pkt_len > 500

# Allow only specific protocols to production subnet
not (ip.proto in {6 17}) and ip.dst == 203.0.113.0/24
```

Rules apply in microseconds at the edge before traffic reaches your network.

### Health Checks and Failover

If a GRE/IPSec tunnel to your network goes down:
- Cloudflare stops routing traffic through that tunnel
- If you have redundant tunnels, traffic fails over automatically
- Health check probes run to verify tunnel health
- You receive alerts (Notifications) when tunnels change state

Recommended: two GRE/IPSec tunnels from two different physical locations for redundancy.

---

## Dashboard Walkthrough

**Step 1: Access Magic Transit**
1. Account Home → Networks → Magic Transit
2. Overview: protected prefixes, tunnel health, traffic volume, DDoS events

**Step 2: Configure IP Prefixes**
1. Click "IP Prefixes"
2. Add: `203.0.113.0/24` (your prefix)
3. Status: Active (announced) or Inactive (not yet announced)
4. Note: requires Cloudflare to verify you own the prefix (LOA process)

**Step 3: Set Up GRE Tunnels**
1. Click "GRE Tunnels"
2. Create tunnel:
   - Cloudflare GRE endpoint: assigned IP from Cloudflare
   - Customer GRE endpoint: your router's public IP
   - Interface address: /31 pair
   - TTL: 64
   - MTU: 1476 (GRE overhead)
3. Repeat for second tunnel (redundancy)

**Step 4: Configure Static Routes**
1. Add routes pointing your networks through the GRE tunnels
2. Cloudflare will route clean traffic back through the tunnel to these destinations

**Step 5: Monitor Traffic and Attacks**
1. Analytics tab: traffic volume, DDoS mitigation events
2. Each DDoS event: size, duration, attack type, mitigated volume
3. Magic Firewall: rule hit counts, blocked traffic volume

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"
# Magic Transit is Enterprise-only
# These labs show API interaction and configuration review
```

### Lab 1: List Magic Transit Prefixes
```bash
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/addressing/prefixes" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 2: Create a GRE Tunnel via API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/gre_tunnels" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "macksportreport-transit-tunnel-01",
    "description": "Primary GRE tunnel for Magic Transit",
    "customer_gre_endpoint": "203.0.113.5",
    "cloudflare_gre_endpoint": "162.159.64.1",
    "interface_address": "10.212.0.0/31",
    "ttl": 64,
    "mtu": 1476,
    "health_check": {
      "enabled": true,
      "target": "customer",
      "type": "reply",
      "rate": "mid"
    }
  }'
```

### Lab 3: Add Static Routes for Magic Transit
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/routes" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "routes": [
      {
        "description": "Production subnet primary route",
        "prefix": "203.0.113.0/24",
        "nexthop": "10.212.0.1",
        "priority": 100
      },
      {
        "description": "Production subnet failover route",
        "prefix": "203.0.113.0/24",
        "nexthop": "10.212.0.3",
        "priority": 200
      }
    ]
  }'
```

### Lab 4: Check Tunnel Health Status
```bash
# List GRE tunnels and health status
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/gre_tunnels" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for tunnel in data.get('result', {}).get('gre_tunnels', []):
    print(f\"Tunnel: {tunnel['name']} | Status: {tunnel.get('health_check', {}).get('enabled', 'N/A')}\")"
```

### Lab 5: Create a Magic Firewall Rule for Transit Traffic
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/firewall/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "rules": [
      {
        "action": "block",
        "description": "Block NTP amplification attacks",
        "enabled": true,
        "filter": {
          "expression": "udp.srcport == 123 and ip.len > 500"
        }
      }
    ]
  }'
```

### Lab 6: Simulate On-Demand Activation
```bash
# In on-demand mode, you advertise/withdraw your prefix via API
# This is how you "turn on" Cloudflare protection during an attack

PREFIX_ID="your-prefix-id"

# Activate (start advertising your prefix via Cloudflare)
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/addressing/prefixes/${PREFIX_ID}/bgp/status" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"advertised": true}'

# Deactivate (stop advertising - traffic reverts to ISP routing)
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/addressing/prefixes/${PREFIX_ID}/bgp/status" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"advertised": false}'
```

---

## Demo Script (2 Minutes)

**Audience:** Network Security Manager at ISP, hosting provider, or enterprise with on-premise presence

**Opening (20 seconds):**
"When a 100Gbps attack hits one of your IP ranges directly, what's your response? Can your upstream ISP scrub it in time? What's the impact while you're calling them?"

**Act 1 — Explain the model (30 seconds):**
"Magic Transit works at the BGP layer. Cloudflare announces your IP prefixes globally. [Show anycast map.] When an attack starts, it hits Cloudflare's nearest PoP — not your datacenter. Cloudflare is absorbing multi-Tbps across 300+ locations. Your datacenter sees clean traffic through a GRE tunnel."

**Act 2 — Show on-demand (30 seconds):**
"You don't have to route everything through Cloudflare. On-demand mode means: normally, your ISPs announce your IPs. The moment an attack starts, one API call or one dashboard click activates Cloudflare's announcement. More-specific BGP route wins. Within minutes, attack traffic diverts to Cloudflare. Clean traffic back via your tunnel. One API call is all it takes."

**Act 3 — Show integration (20 seconds):**
"And Magic Firewall runs on all this traffic. [Show rule builder.] Block NTP amplification — one rule. Block SYN floods from specific countries — one rule. This firewall runs at the edge globally, not on your hardware."

**Close (20 seconds):**
"What's your current DDoS scrubbing capacity? How much does your current provider charge per GB of attack traffic? Cloudflare's pricing is flat — you pay for bandwidth, not attack volume. During a 500Gbps attack, your bill doesn't change."

---

## Competitive Context

| Feature | Magic Transit | Imperva DDoS Protection | Radware DefensePro | Akamai Prolexic | AWS Shield Advanced |
|---|---|---|---|---|---|
| **Architecture** | Anycast BGP (distributed) | Scrubbing centers | On-premise hardware | Scrubbing centers | AWS-only scrubbing |
| **Scrubbing capacity** | Multi-Tbps (distributed) | 10+ Tbps | 10+ Tbps | 20+ Tbps | 65 Tbps (claimed) |
| **Anycast coverage** | 300+ PoPs globally | Limited locations | On-premise | 14 scrubbing centers | AWS regions |
| **Protocol support** | Any TCP/UDP (your IP space) | Any | Any | Any | AWS services only |
| **Own IP protection** | Yes (requires BGP) | Yes | Yes | Yes | Limited (Shield Standard) |
| **Magic Firewall** | Integrated | Separate purchase | Separate appliance | Separate | AWS Network Firewall |
| **On-demand mode** | Yes (API/dashboard) | Yes | Yes | Yes | Yes |
| **Time-to-mitigation** | Seconds (anycast) | Minutes | Minutes | Minutes | Minutes |
| **GRE/IPSec return** | Yes | Yes | Yes | Yes | VPN Gateway |
| **Pricing model** | Flat contract | Per Mbps clean + attack | Hardware + license | Per Mbps + surge | $3,000/month base |

**Key differentiator:** Magic Transit's distributed anycast architecture means attack traffic is geographically distributed across 300+ PoPs — no single scrubbing center to overwhelm. Prolexic, Imperva, and Radware operate centralized scrubbing centers that become bottlenecks under massive attacks.

---

## Self-Check Questions

**Question 1:** Explain the difference between Magic Transit and standard Cloudflare zone protection (proxy mode). Who needs Magic Transit that wouldn't be served by just using Cloudflare as their DNS/proxy?

```
Your answer:




```

**Question 2:** What is BGP anycast and why does it matter for DDoS protection? How does it differ from having a single scrubbing center?

```
Your answer:




```

**Question 3:** Describe the traffic flow for clean traffic in a Magic Transit deployment. Where does the GRE tunnel connect, and why is it needed?

```
Your answer:




```

**Question 4:** What is the difference between "always-on" and "on-demand" Magic Transit? What are the trade-offs?

```
Your answer:




```

**Question 5:** A gaming company owns `198.51.100.0/24` and runs game servers on those IPs. They get hit with 200Gbps UDP floods weekly. Describe exactly how Magic Transit would protect them, including the BGP and tunnel configuration steps.

```
Your answer:




```

---

## Sources

- [Cloudflare Magic Transit Documentation](https://developers.cloudflare.com/magic-transit/)
- [Magic Transit Tunnel Setup](https://developers.cloudflare.com/magic-transit/configuration/)
- [Magic Transit On-demand](https://developers.cloudflare.com/magic-transit/on-demand/)
- [Magic Firewall](https://developers.cloudflare.com/magic-firewall/)
- [BGP Route Advertisement](https://developers.cloudflare.com/magic-transit/configuration/ipv4-prefixes/advertise/)
- [Cloudflare Blog: Magic Transit](https://blog.cloudflare.com/magic-transit-network-layer-ddos/)
- [BGP Protocol RFC 4271](https://datatracker.ietf.org/doc/html/rfc4271)
- [Cloudflare DDoS Attack Trends Report](https://blog.cloudflare.com/ddos-threat-report/)
