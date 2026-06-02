# Module 12.11 — Magic Firewall
> Dashboard Location: Networks → Magic Firewall | Estimated Time: 60 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Magic Firewall is Cloudflare's network-layer (L3/L4) firewall that runs on the same infrastructure as Magic Transit and Magic WAN. It lets you write Wireshark-like filter rules that apply to all traffic flowing through your Magic Transit or Magic WAN deployment — at the edge, globally, in hardware-accelerated microseconds.

**What Magic Firewall is NOT:**
- It is not a web application firewall (WAF) — that's for HTTP/HTTPS on port 80/443
- It is not a next-generation firewall with application inspection
- It is not for traffic to Cloudflare-proxied HTTP zones

**What Magic Firewall IS:**
- A stateless L3/L4 packet filter for your Magic Transit and Magic WAN traffic
- Rules written in Wireshark/tcpdump-like syntax
- Evaluated at the Cloudflare edge, before traffic reaches your network
- Complementary to (not a replacement for) DDoS protection

**The key use case:** You have your IP range protected by Magic Transit. Volumetric DDoS is handled automatically. But now you want to write specific allow/block rules:
- Block SSH access to production servers from everything except your office IP
- Block all UDP except DNS and your game server protocol
- Allow only specific countries to reach specific services
- Rate-limit traffic to prevent resource exhaustion without full DDoS

---

## Deep Dive (Architect-Level)

### Rule Language

Magic Firewall uses the Firewall Rules Expression Language — the same syntax used in Cloudflare WAF rules and Spectrum firewall rules. It resembles Wireshark filter syntax closely.

**Supported fields:**

| Category | Fields |
|---|---|
| **IP** | `ip.src`, `ip.dst`, `ip.proto`, `ip.len`, `ip.ttl` |
| **TCP** | `tcp.srcport`, `tcp.dstport`, `tcp.flags.syn`, `tcp.flags.ack`, `tcp.flags.rst`, `tcp.flags.fin`, `tcp.flags.psh` |
| **UDP** | `udp.srcport`, `udp.dstport` |
| **ICMP** | `icmp.type`, `icmp.code` |
| **Geography** | `ip.src.country`, `ip.dst.country` |
| **Packet size** | `pkt_len` |

**Actions:**
- `allow` — Permit the packet
- `block` — Drop the packet (no response to sender)
- `skip` — Bypass all further rules (for allowlist entries)
- `count` — Log the packet count but take no action (for monitoring)

**Evaluation order:** Rules are processed top-to-bottom in priority order. First matching rule wins. This is critical for allowlist/blocklist patterns.

### Common Rule Patterns

**Block SSH from non-office IPs:**
```
ip.proto == 6 and tcp.dstport == 22 and not ip.src in {203.0.113.0/24 198.51.100.0/24}
```

**Block UDP amplification attack vectors:**
```
# NTP amplification
udp.srcport == 123 and pkt_len > 500

# DNS amplification  
udp.srcport == 53 and pkt_len > 512

# Memcached amplification
udp.srcport == 11211
```

**Block traffic from specific countries:**
```
ip.src.country in {"CN" "RU" "KP"} and tcp.dstport in {22 3389 3306 5432}
```

**Allow only specific protocols to a subnet:**
```
# Block everything except HTTP/HTTPS/SSH to 203.0.113.0/24
ip.dst in {203.0.113.0/24} and not ip.proto in {6} and not tcp.dstport in {22 80 443}
```

**SYN flood detection (stateless approximation):**
```
ip.proto == 6 and tcp.flags.syn == 1 and tcp.flags.ack == 0 and pkt_len < 100
```

### Stateless vs Stateful

**Important caveat:** Magic Firewall is stateless. It does not track connection state. This means:
- A rule blocking TCP port 22 will block the SYN (initial connection)
- But you can't write "block established connections that weren't initiated from allowed IPs"
- For stateful filtering, you need an on-premise NGFW or deploy rules carefully

**Practical implication:** Always-allow established connections can be tricky. The recommended pattern:
1. Create allowlist rules (skip action) for trusted sources — these get skipped past all blocks
2. Create block rules for specific threats
3. Default action for unmatched traffic: allow (or block, for zero-trust networks)

### Integration with Magic Transit

Magic Firewall rules apply to all traffic on your Magic Transit routes. The evaluation happens at the Cloudflare edge, before traffic enters the GRE/IPSec tunnel to your network. This means:
- Rules run at line rate (hardware-accelerated)
- No added latency for allowed traffic
- Blocked traffic never reaches your network or consumes your tunnel bandwidth

### Integration with Magic WAN

For inter-site traffic over Magic WAN, Magic Firewall policies apply to traffic flowing between your sites. This enables microsegmentation:
- NYC office → NYC datacenter: allow all
- Branch office → Production subnet port 5432 (PostgreSQL): block (prevent branch office from reaching production DB directly)
- All sites → Finance subnet port 22: block (only finance team has SSH access to finance systems)

---

## Dashboard Walkthrough

**Step 1: Access Magic Firewall**
1. Account Home → Networks → Magic Firewall
2. Overview: total rules, rules by action, recent changes

**Step 2: Create a New Rule**
1. Click "Create"
2. Rule name: `Block SSH from Non-Trusted IPs`
3. Expression builder OR expression editor (text)
4. Enter expression:
   ```
   ip.proto == 6 and tcp.dstport == 22 and not ip.src in {203.0.113.0/24}
   ```
5. Action: Block
6. Description: "Block SSH access from non-office IPs"
7. Save and enable

**Step 3: View Rule Hits**
1. Click on a rule
2. See: hit count (packets matched), last hit timestamp
3. For count-action rules: only logging, no blocking — useful to test before enforcing

**Step 4: Test a Rule Safely (Count First)**
1. Create rule with same expression but action=count
2. Wait 24 hours
3. Review hit count — if 10,000 hits in 24h from unknown IPs, rule would block that traffic
4. Change to block action when confident

**Step 5: Order Rules**
1. Rules are evaluated top-to-bottom
2. Use Priority number (lower = higher priority)
3. Put allowlist rules (skip action) at priority 1-10
4. Put block rules at priority 11-100
5. Put default allow/block at highest number

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"
# Magic Firewall requires Magic Transit or Magic WAN
```

### Lab 1: Create a Block Rule via API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/firewall/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "rules": [
      {
        "action": "block",
        "description": "Block SSH from non-trusted IPs",
        "enabled": true,
        "filter": {
          "expression": "ip.proto == 6 and tcp.dstport == 22 and not ip.src in {203.0.113.0/24 198.51.100.0/24}"
        }
      }
    ]
  }'
```

### Lab 2: Create an Allow-First (Skip) Rule Pattern
```bash
# First: create allowlist rule with highest priority
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/firewall/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "rules": [
      {
        "action": "skip",
        "description": "Always allow traffic from corporate office IPs",
        "enabled": true,
        "priority": 1,
        "filter": {
          "expression": "ip.src in {203.0.113.0/24 198.51.100.0/24}"
        }
      }
    ]
  }'

# Then: create block rules with lower priority
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/firewall/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "rules": [
      {
        "action": "block",
        "description": "Block NTP amplification attack vector",
        "enabled": true,
        "priority": 10,
        "filter": {
          "expression": "udp.srcport == 123 and pkt_len > 500"
        }
      },
      {
        "action": "block",
        "description": "Block Memcached amplification",
        "enabled": true,
        "priority": 11,
        "filter": {
          "expression": "udp.srcport == 11211"
        }
      }
    ]
  }'
```

### Lab 3: Create a Country-Based Block Rule
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/firewall/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "rules": [
      {
        "action": "block",
        "description": "Block database ports from non-corporate countries",
        "enabled": true,
        "priority": 20,
        "filter": {
          "expression": "tcp.dstport in {3306 5432 27017 6379} and not ip.src.country in {\"US\" \"CA\" \"GB\"}"
        }
      }
    ]
  }'
```

### Lab 4: List All Firewall Rules
```bash
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/firewall/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -m json.tool
```

### Lab 5: Create a Count-Only Monitoring Rule
```bash
# Count without blocking — safe way to test rule impact
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/magic/firewall/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "rules": [
      {
        "action": "count",
        "description": "Count: potential SYN floods (monitor only)",
        "enabled": true,
        "priority": 50,
        "filter": {
          "expression": "ip.proto == 6 and tcp.flags.syn == 1 and tcp.flags.ack == 0 and pkt_len < 80"
        }
      }
    ]
  }'
```

### Lab 6: Expression Syntax Practice

Practice writing these rules (answers in sources):

```bash
# 1. Block all ICMP (ping flood protection)
# Expression: _______________

# 2. Block RDP (port 3389) from all sources except 10.0.0.0/8
# Expression: _______________

# 3. Block UDP to port 53 (DNS) from non-private IPs (prevent your servers from being DNS amplification vectors)
# Expression: _______________

# 4. Block packets larger than 1500 bytes to UDP (prevent fragmentation attacks)
# Expression: _______________

# Answers:
# 1: ip.proto == 1
# 2: ip.proto == 6 and tcp.dstport == 3389 and not ip.src in {10.0.0.0/8}
# 3: ip.proto == 17 and udp.dstport == 53 and not ip.src in {10.0.0.0/8 172.16.0.0/12 192.168.0.0/16}
# 4: ip.proto == 17 and pkt_len > 1500
```

---

## Demo Script (2 Minutes)

**Audience:** Security engineer or network operations at an enterprise with Magic Transit

**Opening (15 seconds):**
"Once your traffic is flowing through Cloudflare, you have a programmable firewall at the edge. Not on your hardware. On Cloudflare's hardware, in every PoP, processing at line rate."

**Act 1 — Show the expression language (30 seconds):**
"The rules look like Wireshark filters. [Open rule editor.] Block NTP amplification: `udp.srcport == 123 and pkt_len > 500`. Block SSH from everything except my office range: `tcp.dstport == 22 and not ip.src in {203.0.113.0/24}`. If you've ever written a Wireshark filter, you already know how to write these."

**Act 2 — Show the edge enforcement (30 seconds):**
"Here's the difference from an on-premise firewall: this rule runs in every Cloudflare PoP. A 500Gbps attack from 50,000 source IPs that match my block rule — all 500Gbps is dropped at the edge. None of it reaches my GRE tunnel. None of it reaches my datacenter. I'm not debugging hardware firewall logs at 3am."

**Act 3 — Show count mode (20 seconds):**
"And I can test rules safely. Set action to 'count' — it matches packets but doesn't block them. I can see hit counts for 24 hours and confirm the rule does what I think it does before I enable blocking."

**Close (15 seconds):**
"What does your current L3/L4 firewall topology look like? This replaces the perimeter firewall you're running at the edge of your data center, except it runs globally in hardware."

---

## Competitive Context

| Feature | Magic Firewall | Palo Alto NGFW | Cisco ASA | AWS Network Firewall | Azure Firewall |
|---|---|---|---|---|---|
| **Layer** | L3/L4 (stateless) | L3-L7 (stateful) | L3-L7 (stateful) | L3-L7 (stateful) | L3-L7 (stateful) |
| **Edge enforcement** | CF global edge (300+ PoPs) | On-premise/cloud appliance | On-premise | AWS region | Azure region |
| **DDoS absorption** | Complements Magic Transit | No | No | Limited | Limited |
| **Rule language** | Wireshark-like expressions | PAN-OS policies | ACL/policy | Suricata rules | Azure Policy |
| **Stateful tracking** | No (stateless) | Yes | Yes | Yes | Yes |
| **Throughput** | Line rate at CF edge | Hardware-limited | Hardware-limited | ~100 Gbps | ~30 Gbps |
| **Geographic rules** | Yes (ip.src.country) | Yes (GeoIP feeds) | Yes (GeoIP) | Yes (IP sets) | Yes |
| **Hardware required** | No | Yes | Yes | No (managed) | No (managed) |
| **Cost** | Included with Magic Transit | $20K-$500K+ | $10K-$100K+ | $0.065/GB | $1.25/hr + $0.016/GB |
| **Application awareness** | No | Yes (App-ID) | Limited | Limited | Yes |

**Key positioning:** Magic Firewall's advantage is not feature richness versus a NGFW — it's where it runs. A Palo Alto runs in your data center and you manage hardware. Magic Firewall runs at Cloudflare's edge, absorbing attacks before they reach your network, globally, with zero hardware to manage.

---

## Self-Check Questions

**Question 1:** Explain the difference between Magic Firewall and the Cloudflare WAF. What traffic types does each protect?

```
Your answer:




```

**Question 2:** Magic Firewall is stateless. Explain what this limitation means in practice. Give an example of a filtering scenario you CAN implement and one you CANNOT with stateless rules alone.

```
Your answer:




```

**Question 3:** Write the Magic Firewall expression to: block all traffic to TCP port 3389 (RDP) from any IP address except the range `10.10.0.0/16`. What action would you use?

```
Your answer:




```

**Question 4:** Why is it important to put allowlist rules (skip action) at a higher priority than block rules? What happens if you reverse this order?

```
Your answer:




```

**Question 5:** A customer wants to protect their Memcached servers from being used as amplification attack vectors. Memcached uses UDP port 11211. Write the expression and explain why Memcached amplification works and how this rule stops it.

```
Your answer:




```

---

## Sources

- [Cloudflare Magic Firewall Documentation](https://developers.cloudflare.com/magic-firewall/)
- [Magic Firewall Rules](https://developers.cloudflare.com/magic-firewall/rules/)
- [Magic Firewall Expression Language](https://developers.cloudflare.com/magic-firewall/rules/fields-and-expressions/)
- [Magic Transit + Magic Firewall](https://developers.cloudflare.com/magic-transit/)
- [Cloudflare Firewall Rules Language Reference](https://developers.cloudflare.com/ruleset-engine/rules-language/)
- [Cloudflare Blog: Magic Firewall](https://blog.cloudflare.com/introducing-magic-firewall/)
- [NTP Amplification Attack Explanation](https://www.cloudflare.com/learning/ddos/ntp-amplification-ddos-attack/)
- [Wireshark Display Filter Reference](https://www.wireshark.org/docs/dfref/)
