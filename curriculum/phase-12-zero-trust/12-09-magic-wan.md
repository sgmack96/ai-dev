# Module 12.9 — Magic WAN
> Dashboard Location: Networks → Magic WAN | Estimated Time: 75 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Magic WAN replaces an enterprise's private WAN (Wide Area Network) with Cloudflare's global network. Instead of connecting branch offices, data centers, and cloud VPCs with MPLS circuits or SD-WAN appliances, all locations connect to Cloudflare — and Cloudflare's backbone handles routing between them.

**What WAN means:** Enterprises with multiple locations (offices, data centers, cloud regions) need a private network connecting them. Your San Francisco office needs to reach your New York data center. Your AWS VPC needs to reach your on-premise servers. Traditionally: MPLS circuits, SD-WAN appliances, or site-to-site VPNs.

**The problems with traditional WAN:**
- **MPLS:** Expensive ($1,000-5,000/month per site), long provisioning times (6-12 weeks), fixed routes
- **SD-WAN appliances:** Hardware to buy and maintain, still needs underlying transport circuits
- **VPNs:** Complex to manage at scale, performance issues, no intelligent routing

**Magic WAN's approach:** Connect every site to Cloudflare via IPSec tunnel, GRE tunnel, or WARP Connector. All traffic between sites routes through Cloudflare's backbone. Cloudflare acts as the private network hub with intelligent routing, traffic policies, and integrated security.

**Key benefits:**
- No MPLS contracts
- Global reach instantly (connect to any CF PoP)
- Integrated security (Magic Firewall, Gateway, Access)
- SD-WAN-style intelligent routing without proprietary hardware
- WARP for remote workers connecting to Magic WAN

---

## Deep Dive (Architect-Level)

### Connection Methods

**IPSec Tunnels:**
- Industry-standard, works with any router/firewall
- Configure on your existing Cisco/Juniper/Palo Alto/Fortinet router
- Cloudflare terminates the tunnel at the nearest PoP
- Bidirectional (traffic can originate from either side)

**GRE Tunnels:**
- Generic Routing Encapsulation — simpler, no encryption overhead
- Use when traffic will also go through Cloudflare's DDoS scrubbing (Magic Transit)
- GRE inside Cloudflare's network is implicitly encrypted (CF internal encryption)

**Cloudflare Connector (hardware):**
- Physical device Cloudflare provides
- Plug in, auto-connects to Cloudflare
- For sites without IT-managed routers or for simple office connectivity

**WARP for remote workers:**
- Individual laptops/phones connect to Magic WAN via WARP
- Workers on WARP can reach any Magic WAN-connected resource
- Enables "remote worker → Cloudflare → branch office" routing

### Routing Architecture

```
Branch Office A (NYC)
   [Router with IPSec tunnel] → Cloudflare PoP NYC
                                         │
                                   [CF Backbone]
                                         │
                                  Cloudflare PoP SFO → [Router with IPSec tunnel]
                                                         Branch Office B (SFO)

                                         │
                                  Cloudflare PoP DFW → [GRE tunnel]
                                                         AWS VPC (us-east-1)
                                         │
                                  [WARP clients]
                                  Remote Workers
```

All routing decisions happen inside Cloudflare's network. Cloudflare chooses the best path based on real-time latency measurements between PoPs.

### Traffic Policies

Once traffic is inside Magic WAN, you apply policies at the CF level:

- **Magic Firewall:** L3/L4 rules (block specific IPs, ports, protocols between sites)
- **Gateway HTTP policies:** Apply to HTTP/HTTPS traffic between sites (DLP, URL filtering)
- **Gateway DNS policies:** DNS filtering for all Magic WAN sites
- **Traffic steering:** Route specific traffic types over different paths (e.g., video conferencing prioritized)

### SD-WAN Integration

Magic WAN can work alongside existing SD-WAN infrastructure:
- Use your SD-WAN for local internet breakout
- Route corporate traffic to Magic WAN
- Cloudflare handles inter-site routing; SD-WAN handles local decisions

**Common migration path:**
1. Start with Magic WAN for a few new sites
2. Phase out MPLS circuits site by site
3. Eventually replace SD-WAN appliances with Cloudflare Connectors

### Zero Trust Network Segmentation

Unlike MPLS (where any site can reach any other site), Magic WAN enables microsegmentation:
- Define which sites/networks can communicate with each other
- Finance systems can only reach Finance systems, not Engineering
- Magic Firewall enforces this at the network layer
- No "flat network" risk — a compromised workstation in Branch A can't directly access Branch B servers

---

## Dashboard Walkthrough

**Step 1: Navigate to Magic WAN**
1. Account Home → Networks → Magic WAN
2. Overview: connected sites, total tunnels, traffic volume

**Step 2: Create a Site**
1. Click "Create" → "Sites"
2. Site name: `NYC Office`
3. Location: New York
4. Add a tunnel:
   - Type: IPSec
   - Cloudflare endpoint: assigned automatically from CF anycast
   - Customer endpoint: your router's public IP
   - Pre-shared key: generate or enter
   - Interface address: `/31` pair for BGP or static routing

**Step 3: Configure Routing**
1. After tunnel is up, add static routes
2. Network: `10.10.0.0/24` (NYC office LAN)
3. Nexthop: through tunnel
4. Or: configure BGP if your router supports it

**Step 4: Test Connectivity**
1. From NYC office device, ping a resource in SFO office
2. Traffic should traverse Cloudflare backbone
3. Check: Zero Trust → Networks → Magic WAN → Analytics for traffic confirmation

**Step 5: Apply Magic Firewall Rules**
1. Networks → Magic Firewall
2. Create rule: block traffic from NYC office LAN to production servers in NYC DC on port 22
3. Rule applies immediately to all Magic WAN traffic

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token-with-magic-wan-edit"
# Note: Magic WAN is an Enterprise feature
# For lab purposes, we'll use the API to explore configuration
```

### Lab 1: List Magic WAN Sites
```bash
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/sites" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 2: Create a Site via API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/sites" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "NYC Office - Mack Sport Report",
    "description": "Primary NYC office location",
    "location": {
      "latitude": "40.7589",
      "longitude": "-73.9851"
    },
    "secondary_wan_policy": "balanced"
  }'
```

### Lab 3: Create an IPSec Tunnel Configuration
```bash
# This creates the tunnel configuration
# Actual tunnel must also be configured on your router
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/ipsec_tunnels" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "nyc-office-tunnel-01",
    "description": "NYC Office Primary IPSec Tunnel",
    "customer_endpoint": "203.0.113.5",
    "cloudflare_endpoint": "162.159.64.1",
    "interface_address": "169.254.244.0/31",
    "psk": "your-pre-shared-key-here",
    "health_check": {
      "enabled": true,
      "target": "customer",
      "type": "request",
      "rate": "mid"
    }
  }'
```

### Lab 4: Add Static Routes
```bash
TUNNEL_ID="your-tunnel-id"

curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/routes" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "routes": [
      {
        "description": "NYC Office LAN",
        "prefix": "10.10.0.0/24",
        "nexthop": "169.254.244.1",
        "priority": 100,
        "scope": {
          "regions": ["ENAM"]
        }
      }
    ]
  }'
```

### Lab 5: Sample Router Configuration (Cisco IOS)
```bash
# This is a reference configuration for a Cisco router
# Run on your router, not in bash
cat << 'ROUTER_CONFIG'
! Cloudflare Magic WAN IPSec Tunnel Configuration
! Replace <CF_ENDPOINT> with Cloudflare-assigned IP
! Replace <YOUR_PUBLIC_IP> with your router's public IP

crypto isakmp policy 10
 encryption aes 256
 hash sha256
 authentication pre-share
 group 20
 lifetime 28800

crypto isakmp key <YOUR_PSK> address <CF_ENDPOINT>

crypto ipsec transform-set CLOUDFLARE esp-aes 256 esp-sha256-hmac
 mode tunnel

crypto map CLOUDFLARE_MAP 10 ipsec-isakmp
 set peer <CF_ENDPOINT>
 set transform-set CLOUDFLARE
 match address CLOUDFLARE_ACL

interface Tunnel1
 ip address 169.254.244.1 255.255.255.254
 tunnel source <YOUR_PUBLIC_IP>
 tunnel destination <CF_ENDPOINT>
 tunnel mode ipsec ipv4
 tunnel protection ipsec profile CLOUDFLARE_PROFILE

ip route 0.0.0.0 0.0.0.0 Tunnel1 ! Route to CF
ROUTER_CONFIG
```

---

## Demo Script (2 Minutes)

**Audience:** Network/IT Director at mid-market company with multiple offices

**Opening (20 seconds):**
"How much do you spend on MPLS per year? And when you provision a new office, how long does it take to get it connected to the private network? 8 weeks? 12?"

**Act 1 — Describe the model (40 seconds):**
"Magic WAN replaces that with one concept: every office connects to Cloudflare via an IPSec tunnel to the nearest Cloudflare PoP. [Show site map with CF PoPs.] Cloudflare's backbone connects all of your sites — 300+ locations, globally. A new office comes online in hours, not weeks. You configure an IPSec tunnel on your existing router. That's it."

**Act 2 — Show the security integration (30 seconds):**
"The difference from raw MPLS: all that traffic flowing through Cloudflare can be inspected and filtered. Magic Firewall at the L3/L4 level — block SSH access between specific networks. Gateway for HTTP inspection — DLP on traffic between sites. Access for application-level authentication. One platform."

**Act 3 — The SD-WAN comparison (20 seconds):**
"SD-WAN appliances cost $3,000-15,000 per site plus the circuits underneath. Magic WAN uses whatever internet connection you already have. Fiber, cable, LTE — anything with a public IP works."

**Close (10 seconds):**
"How many sites do you have? Let me calculate what MPLS is costing you vs what this would cost. The math is usually compelling."

---

## Competitive Context

| Feature | Magic WAN | Cisco Meraki SD-WAN | VMware VeloCloud | Palo Alto Prisma SD-WAN | Traditional MPLS |
|---|---|---|---|---|---|
| **Underlying transport** | Any internet | Any internet + MPLS | Any internet | Any internet + MPLS | Dedicated circuits |
| **Hardware required** | Minimal (Connector optional) | Yes (Meraki devices) | Yes (VeloCloud Edge) | Yes (ION device) | Router + CPE |
| **Provisioning time** | Hours | Days-weeks | Days-weeks | Days-weeks | 6-12 weeks |
| **Zero Trust integration** | Native (full ZT stack) | Cisco-only (Umbrella) | VMware NSX-T | Palo Alto NGFW | Manual add-ons |
| **Remote workers** | WARP (native) | AnyConnect add-on | VPN add-on | Prisma Access add-on | VPN required |
| **DDoS protection** | Magic Transit add-on | No | No | No | No |
| **Global PoP count** | 300+ | Limited | ~100 | ~100 | ISP-dependent |
| **Cost model** | Per Mbps or flat enterprise | Per device | Per device | Per device | Per site + transport |
| **Vendor lock-in** | IPSec standard | Meraki hardware | VeloCloud hardware | ION hardware | ISP lock-in |

---

## Self-Check Questions

**Question 1:** Explain the difference between Magic WAN and traditional SD-WAN. What hardware is required for each and what are the trade-offs?

```
Your answer:




```

**Question 2:** A company has 20 branch offices connected via MPLS. They want to migrate to Magic WAN over 12 months. Describe a phased migration approach.

```
Your answer:




```

**Question 3:** How does Magic WAN integrate with Zero Trust security policies? Give a specific example using Magic Firewall and Gateway together.

```
Your answer:




```

**Question 4:** What is the role of WARP in a Magic WAN deployment? How do remote workers fit into the Magic WAN architecture?

```
Your answer:




```

**Question 5:** A customer asks: "What happens if Cloudflare has an outage — do all our offices lose connectivity?" Provide a technically accurate answer and describe the failover options.

```
Your answer:




```

---

## Sources

- [Cloudflare Magic WAN Documentation](https://developers.cloudflare.com/magic-wan/)
- [Magic WAN Tunnel Configuration](https://developers.cloudflare.com/magic-wan/configuration/)
- [Magic WAN Connectors](https://developers.cloudflare.com/magic-wan/configuration/connector/)
- [Magic Firewall with Magic WAN](https://developers.cloudflare.com/magic-firewall/)
- [WARP Connector for Site-to-Site](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/warp-connector/)
- [Cloudflare Blog: Magic WAN](https://blog.cloudflare.com/magic-wan-replacing-legacy-wan-with-cloudflare/)
- [SD-WAN Architecture Overview (Gartner)](https://www.gartner.com/reviews/market/sd-wan-solutions)
- [IPSec IKEv2 RFC 7296](https://datatracker.ietf.org/doc/html/rfc7296)
