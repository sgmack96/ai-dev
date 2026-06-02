# Module 12.2 — Cloudflare Gateway (Secure Web Gateway)
> Dashboard Location: Zero Trust → Gateway | Estimated Time: 90 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare Gateway is a Secure Web Gateway (SWG) — it inspects and filters traffic that flows FROM your users TO the internet. Where Access protects inbound access to your internal applications, Gateway protects outbound internet access.

**The problem:** Employees browse the internet from corporate devices. They click phishing links, download malware, visit social media during work hours, and connect to shadow IT SaaS applications that IT doesn't know about. Traditional web proxies (Bluecoat, Cisco Umbrella, Zscaler) sit in front of outbound traffic to filter it.

**What Gateway does:**
1. **DNS filtering:** Block malicious domains, adult content, gambling, social media — at the DNS resolver level. Fast, simple, no TLS inspection required.
2. **HTTP/HTTPS inspection:** Deeper inspection of web traffic — block specific URLs, file downloads, DLP pattern matching (credit card numbers, SSNs in uploads), antivirus scanning of downloads.
3. **Network firewall:** L3/L4 rules — block specific IPs, ports, protocols.

**How users are enrolled:**
- **WARP client:** Cloudflare's device agent (like a VPN client but not VPN). Installed on laptops, phones. Routes DNS and HTTP through Gateway.
- **DNS-over-HTTPS only:** Configure device DNS to Cloudflare's DOH endpoint with a location token. DNS filtering only, no HTTP inspection.
- **Proxy configuration:** Point browser/system proxy settings to Cloudflare's proxy endpoint.

**Typical enterprise use:** Block malware/phishing domains (DNS) + inspect risky HTTPS traffic + DLP for sensitive data leaving the org. Replace Zscaler or Cisco Umbrella.

---

## Deep Dive (Architect-Level)

### Three Policy Layers

**1. DNS Policies (lowest friction, highest coverage)**

Applied before any HTTP connection. Works by filtering DNS queries through Cloudflare's resolver:
- Block by category: malware, phishing, cryptomining, adult content, P2P, social media
- Block specific domains: `facebook.com`, `*.torrent.to`
- Allow list: always allow specific domains regardless of category
- Override DNS: `internal.company.com` → resolve to internal IP (split horizon DNS)
- CNAME flattening: detect malicious CNAME chains

DNS policies apply to every device using Cloudflare as their resolver. No TLS inspection needed. Not bypassable via HTTPS (the domain must resolve before any connection).

**2. HTTP Policies (deep inspection, TLS required)**

Applied after TLS interception to the decrypted HTTP traffic:
- Block by URL category: not just domain, but specific URL path
- Block file types: .exe downloads, .zip from non-trusted sources
- DLP: detect patterns (credit cards, SSNs, API keys) in POST bodies
- Antivirus scanning: scan file downloads for malware signatures
- Remote Browser Isolation: open risky URLs in an isolated browser session
- Shadow IT discovery: identify what SaaS apps employees are using

HTTP policies require TLS inspection, which means:
- Install Cloudflare's root CA certificate on managed devices
- Cloudflare performs break-and-inspect on HTTPS traffic
- Some domains are bypassed by default (banking, healthcare — certificate pinning would break)

**3. Network Policies (L3/L4 firewall)**

Applied to TCP/UDP connections regardless of protocol:
- Block IP addresses
- Block port ranges
- Allow/block by destination geography
- Log connections for visibility

### TLS Inspection Architecture

```
User's browser initiates: CONNECT example.com:443
         │
Cloudflare Gateway (WARP client is proxy endpoint)
         │
         ├─ Check HTTP policy for example.com
         ├─ Establish real TLS connection to example.com
         ├─ Generate fake cert signed by Cloudflare's CA
         ├─ Present fake cert to browser (browser trusts CF CA because it's installed)
         │
         [Cloudflare can now see plaintext HTTP/2 request/response]
         │
         ├─ Apply HTTP policy rules (URL filter, DLP scan, AV scan)
         └─ Forward allowed traffic to origin
```

### WARP Architecture

WARP creates a local WireGuard tunnel on the user's device. Traffic is encrypted and routed to the nearest Cloudflare PoP. The PoP applies DNS and HTTP policies, then forwards traffic to the internet.

Split tunneling configuration determines what traffic goes through WARP vs directly:
- Include: only route specified domains/IPs through WARP
- Exclude: route everything through WARP except specified domains/IPs (e.g., internal tools at known IPs)

### Resolver Policies (DNS Isolation for Zero Trust)

When a user queries a risky domain, Resolver policies can:
- **Block:** Return NXDOMAIN (domain not found) — connection fails
- **Override:** Return a different IP (for internal DNS)
- **Safe search:** Enforce Google/Bing/YouTube safe search by rewriting DNS
- **Isolate:** Redirect to Remote Browser Isolation session

---

## Dashboard Walkthrough

**Step 1: Navigate to Gateway**
1. Zero Trust → Gateway
2. Overview shows: blocked requests, threat categories, active policies

**Step 2: Create a DNS Policy**
1. Zero Trust → Gateway → Firewall Policies → DNS
2. Click "Add a policy"
3. Name: `Block Malware and Phishing`
4. Traffic match: Security Categories → Malware, Phishing
5. Action: Block
6. Save

**Step 3: Create an HTTP Policy**
1. Zero Trust → Gateway → Firewall Policies → HTTP
2. Click "Add a policy"
3. Name: `Block Executable Downloads`
4. Traffic match: File Type → Executable (.exe, .msi, .dmg)
5. Action: Block
6. Save

**Step 4: Set Up a Location (DNS-only)**
1. Zero Trust → Gateway → Locations
2. Click "Add a location"
3. Name: `Office - Mack Sport Report HQ`
4. Source IP: your office IP range
5. Enable DOH endpoint
6. Configure DNS on office network to use the provided resolver IP

**Step 5: Review Activity Logs**
1. Zero Trust → Logs → Gateway
2. Each row: timestamp, user/device, query/URL, action, rule matched
3. Filter by action=Block to see what's being blocked

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token-with-zero-trust-write"

# Install WARP client (macOS)
# brew install --cask cloudflare-warp
```

### Lab 1: Create DNS Policies via API
```bash
# Block malware and phishing categories
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/gateway/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Block Malware and Phishing",
    "description": "Block known malicious domains",
    "action": "block",
    "enabled": true,
    "filters": ["dns"],
    "traffic": "any(dns.security_category[*] in {68 178 80 83})",
    "precedence": 1
  }'
# Category IDs: 68=Malware, 178=Phishing, 80=Command & Control, 83=Cryptomining
```

### Lab 2: Block Social Media During Work Hours
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/gateway/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Block Social Media (Work Hours)",
    "description": "Block social media 9am-5pm weekdays",
    "action": "block",
    "enabled": true,
    "filters": ["dns"],
    "traffic": "any(dns.content_category[*] in {122}) and http.request.timestamp.hour in {9 10 11 12 13 14 15 16}",
    "precedence": 5
  }'
# Category 122 = Social Networks
```

### Lab 3: Allow List Override (Bypass for Specific Domain)
```bash
# Ensure macksportreport.com is always allowed even if it matches blocked categories
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/gateway/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Always Allow macksportreport.com",
    "description": "Bypass all filtering for our own domain",
    "action": "allow",
    "enabled": true,
    "filters": ["dns"],
    "traffic": "dns.fqdn in {\"macksportreport.com\" \"*.macksportreport.com\"}",
    "precedence": 0
  }'
```

### Lab 4: List Active Gateway Policies
```bash
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/gateway/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 5: Test DNS Filtering
```bash
# Check if a known malware domain resolves
# With Gateway: should return NXDOMAIN or Cloudflare block page
dig @1.1.1.3 malware.testcategory.com   # 1.1.1.3 = CF Gateway resolver (with malware filtering)

# Normal resolution
dig @1.1.1.1 google.com    # 1.1.1.1 = CF public resolver (no filtering)

# Test safe categories
dig @1.1.1.3 google.com     # Should resolve normally
dig @1.1.1.3 facebook.com   # Should resolve (unless you blocked social media)
```

### Lab 6: View Gateway Activity Logs
```bash
# Get last 100 Gateway DNS events
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/gateway/activity_log?limit=100&type=dns" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"

# Filter to only blocked events
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/gateway/activity_log?limit=100&type=dns&action=block" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

---

## Demo Script (2 Minutes)

**Audience:** IT Manager or CISO looking at SWG/DNS filtering

**Opening (20 seconds):**
"What happens right now if one of your employees clicks a phishing link? Does anything stop the connection from completing? Or do you find out later, from your EDR tool, after the credential was already submitted?"

**Act 1 — Show DNS blocking (40 seconds):**
"Gateway's DNS filtering intercepts the DNS query before any connection happens. [Show policy: Block Phishing.] Known phishing domains — blocked at the resolver. Malware command-and-control — blocked. No connection ever made. [Test a blocked domain in terminal.] NXDOMAIN. Done. The browser never even tries to connect."

**Act 2 — Show the coverage (30 seconds):**
"This covers every device that uses Cloudflare as their DNS resolver. The WARP client sets this automatically. Or you point your office network DNS to our resolver. 100% of DNS queries on those devices go through these policies."

**Act 3 — Show visibility (20 seconds):**
"[Logs → Gateway.] Every DNS query logged. Every blocked request — who, what time, what domain, which policy matched. You can see exactly what sites every employee on WARP is visiting. This is your shadow IT discovery too."

**Close (20 seconds):**
"What are you currently using for DNS filtering? If it's Cisco Umbrella, I can show you a feature-by-feature comparison. The pricing is typically 30-40% lower, and you get this tightly integrated with your access policies and device posture — in the same dashboard."

---

## Competitive Context

| Feature | Cloudflare Gateway | Cisco Umbrella | Zscaler Internet Access | iboss | NextDNS |
|---|---|---|---|---|---|
| **DNS filtering** | Yes | Yes (primary focus) | Yes | Yes | Yes |
| **HTTP/TLS inspection** | Yes (with WARP) | Yes | Yes | Yes | No |
| **DLP** | Yes | Limited | Yes (full) | Yes | No |
| **Antivirus scanning** | Yes (file downloads) | Limited | Yes | Yes | No |
| **Remote Browser Isolation** | Yes (CF RBI) | No native | No native | No | No |
| **WARP integration** | Native | Cisco AnyConnect | ZPA client | iboss client | Manual DNS |
| **Shadow IT discovery** | Yes | Yes | Yes | Yes | Limited |
| **Safe search enforcement** | Yes | Yes | Yes | Yes | Yes |
| **Network firewall (L3/L4)** | Yes | Limited | Yes | Yes | No |
| **Pricing** | Per seat (~$5-10) | $2-5/user/mo | $5-15/user/mo | ~$8/user/mo | $2/user/mo (DNS only) |
| **Platform consolidation** | Yes (full ZT stack) | Cisco-only | Zscaler-only | iboss-only | DNS only |

**Key positioning:** Gateway is the only SWG where DNS filtering, HTTP inspection, RBI, and ZTNA are all in a single Zero Trust platform — same dashboard, same policies, same audit logs. Zscaler and Cisco are separate products that require separate integrations.

---

## Self-Check Questions

**Question 1:** What is the difference between a DNS policy and an HTTP policy in Gateway? Give a specific example of a threat each is better suited to catch.

```
Your answer:




```

**Question 2:** A company wants to block employees from uploading sensitive documents to personal Google Drive but still allow access to corporate Google Drive. Is this possible with Gateway? What type of policy (DNS vs HTTP) would handle this?

```
Your answer:




```

**Question 3:** A developer on the security team asks: "When Gateway does TLS inspection, can it see traffic to my banking website?" What is the accurate technical answer?

```
Your answer:




```

**Question 4:** Explain the difference between routing DNS-only through Gateway vs full traffic (WARP). What threats does each protect against, and which doesn't it protect against?

```
Your answer:




```

**Question 5:** A customer says their employees are using personal iPhones for work email and browsing. How would you extend Gateway protection to these unmanaged devices?

```
Your answer:




```

---

## Sources

- [Cloudflare Gateway Documentation](https://developers.cloudflare.com/cloudflare-one/policies/gateway/)
- [Gateway DNS Policies](https://developers.cloudflare.com/cloudflare-one/policies/gateway/dns-policies/)
- [Gateway HTTP Policies](https://developers.cloudflare.com/cloudflare-one/policies/gateway/http-policies/)
- [Gateway Network Policies](https://developers.cloudflare.com/cloudflare-one/policies/gateway/network-policies/)
- [WARP Client Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/)
- [TLS Decryption](https://developers.cloudflare.com/cloudflare-one/policies/gateway/http-policies/tls-decryption/)
- [Gateway Activity Logs](https://developers.cloudflare.com/cloudflare-one/insights/logs/gateway-logs/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [Gartner SWG Market Guide](https://www.gartner.com/en/information-technology/glossary/secure-web-gateway)
