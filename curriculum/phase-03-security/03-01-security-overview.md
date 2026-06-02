# Module 3.1 — Security Overview
> Dashboard Location: macksportreport.com → Security → Overview | Estimated Time: 90 minutes | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is the Security Overview?

The Security Overview page is the top-level dashboard for all security-related activity on a Cloudflare zone. It aggregates data from multiple security subsystems — WAF, Bot Management, DDoS Protection, Rate Limiting — and surfaces them in a single pane of glass. For a Solutions Engineer, this is the first place to go when a customer says "we're getting attacked" or "why is traffic spiking?"

The overview shows:
- Total threats blocked in a configurable time window
- Breakdown of threat types (WAF matches, bot activity, DDoS mitigations)
- Geographic threat distribution (which countries are attacking you)
- Top threat rules triggered
- Action distribution (blocked, challenged, logged)

### Security Level

Security Level is a zone-wide setting that controls how aggressively Cloudflare challenges visitors based on their **threat score**. Threat score is a reputation score from 0–100 assigned to every IP that makes a request. Higher score = more suspicious history.

| Level | Description | Threshold |
|-------|-------------|-----------|
| **Essentially Off** | Only challenges IPs with the worst reputation (score > 49) | > 49 |
| **Low** | Challenges IPs with somewhat suspicious history (score > 24) | > 24 |
| **Medium** | Default. Challenges moderately suspicious IPs | > 14 |
| **High** | Challenges all visitors with any elevated risk | > 0 |
| **I'm Under Attack** | Presents a 5-second JS challenge to **everyone** | Everyone |

**Key insight for customers:** "I'm Under Attack" mode adds a 5-second interstitial page that runs JavaScript. This breaks APIs and mobile apps. It should only be used as an emergency measure during active DDoS events, not as a permanent setting.

**How Security Level Works Internally:**
When a request arrives at a Cloudflare edge PoP:
1. The IP is looked up in Cloudflare's IP reputation database (built from data across ~50M+ zones)
2. A threat score (0–100) is returned
3. The zone's Security Level threshold is compared against the threat score
4. If score exceeds threshold → present a challenge
5. If visitor passes the challenge → issue a clearance cookie (`cf_clearance`) valid for the Challenge Passage duration

### Challenge Types

Cloudflare has evolved its challenge mechanisms significantly. Understanding the differences matters for customer conversations:

**JS Challenge (Legacy)**
- Presents a blank page, runs a JavaScript computation in the browser
- No human interaction required — purely automated detection
- Creates a `cf_clearance` cookie on success
- Can be bypassed by sophisticated bots that execute JavaScript
- Being deprecated in favor of Managed Challenge

**Managed Challenge (Recommended)**
- Cloudflare automatically chooses the best challenge type based on visitor signals
- May serve a non-interactive JS challenge, a Cloudflare Turnstile (CAPTCHA-free), or an interactive CAPTCHA
- Uses risk-scoring: low-risk visitors may pass silently, higher-risk visitors see more friction
- Reduces false positives vs traditional CAPTCHA
- This is the action you should recommend for WAF rules when you want friction without hard blocks

**Interactive Challenge (CAPTCHA)**
- The classic "click the traffic lights" visual challenge
- High friction, high human-confidence when passed
- Less common now due to Managed Challenge being smarter
- Still used as a fallback or for high-security contexts

**Turnstile (Privacy-Preserving)**
- Cloudflare's CAPTCHA replacement product
- Uses device, browser, and behavioral signals without visual puzzles
- Can be embedded in forms as a widget
- Available as standalone product separate from zone-level security

### Browser Integrity Check (BIC)

Browser Integrity Check examines HTTP request headers for signs of suspicious or bot-like behavior. It specifically looks for:

- Missing `User-Agent` header (common in automated tools)
- Non-standard `User-Agent` strings used by known attack tools
- Missing `Accept` header
- Headers characteristic of scrapers or vulnerability scanners

When BIC detects a suspicious header pattern, it challenges the visitor based on the zone's Security Level.

**Important caveat:** BIC can trigger false positives for API clients or mobile apps that send non-standard headers. If a customer reports legitimate API traffic being challenged, BIC is one of the first things to check.

**Configuration:** Security → Settings → Browser Integrity Check (On/Off toggle)

### Threat Score System (0–100)

The threat score is Cloudflare's IP reputation score, aggregated from:
- History of malicious activity across all Cloudflare-protected zones
- Integration with third-party threat intelligence feeds
- Rate of suspicious behavior (scanning, probing, attack signatures)
- Reports from Project Honeypot (an IP reputation database)

Score interpretation:
- **0–1**: Clean. Trusted IPs (Googlebot, known CDNs, datacenter IPs) often score 0
- **2–14**: Minimal suspicion. Some history but not alarming
- **15–24**: Moderate. May be part of botnets or have historical abuse
- **25–49**: High. Associated with malicious activity
- **50–100**: Severe. Active threat actors, known attack infrastructure

**In Firewall Rules / Custom Rules**, you can reference `cf.threat_score` directly:
```
cf.threat_score > 30
```

This lets you build custom logic beyond what Security Level provides.

### Privacy Pass

Privacy Pass is a cryptographic protocol (IETF standard) that reduces challenge friction for users who have already proved they're human.

**How it works:**
1. User solves a Cloudflare challenge (JS, Managed, or Interactive)
2. Cloudflare issues a set of **signed tokens** to the browser
3. Browser stores tokens locally (via browser extension or native support)
4. On subsequent requests to any Cloudflare-protected site, the browser presents a token
5. Cloudflare validates the token cryptographically — no new challenge needed

**Why it matters for SEs:**
- Reduces friction for legitimate users in high-security environments
- Browser extension available at privacypass.github.io
- Backed by IETF RFC 9576 (Privacy Pass Architecture)
- Chrome, Firefox supported

**Configuration:** Security → Settings → Privacy Pass (On/Off)

### Hotlink Protection

Hotlink Protection prevents other websites from embedding your images and files directly by requesting them from your origin. Without protection:
- Another site's HTML: `<img src="https://macksportreport.com/logo.png">`
- Their readers load your images, consuming your bandwidth (and your origin's resources)
- You pay for their traffic

**How it works:**
1. Cloudflare checks the `Referer` HTTP header on requests for images, JS, CSS
2. If `Referer` is set and the domain doesn't match the current zone, block the request
3. Returns a `403 Forbidden` or serves an alternative image

**Important limitations:**
- Does NOT block requests with no `Referer` header (direct URL access still works)
- Can break legitimate cross-origin image loads (CDN subdomains, image optimization services)
- Use with `cf-facebook-preview` and similar exceptions for social sharing

**Configuration:** Security → Settings → Hotlink Protection (On/Off)

---

## Deep Dive (Architect-Level)

### Threat Score Architecture

Cloudflare's threat score infrastructure is a distributed reputation system maintained across their global network. Key components:

**Data Sources:**
- Project Honeypot integration (honeypot.net) — IP abuse data since 2004
- Cloudflare's own network visibility (50M+ websites, 20% of global HTTP traffic)
- External threat feeds (SANS, Spamhaus, etc.)
- User-submitted reports via `cf.threat_score` feedback mechanisms

**Score Persistence:**
Threat scores are not static. An IP's score can change over time:
- A botnet IP that stops attacking may see score decrease over weeks/months
- A clean IP that begins attacking will see immediate score elevation
- Scores are updated in real-time as new threat data is ingested

**Querying Threat Score via API:**
```bash
# Get threat score for a specific IP (via IP Intelligence API)
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{account_id}/intel/ip?ipv4=1.2.3.4" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

Response includes:
```json
{
  "result": {
    "ip": "1.2.3.4",
    "risk_types": [{"id": 123, "super_category_id": 7, "name": "SCANNER"}],
    "belongs_to_ref": {...}
  }
}
```

### Challenge Clearance Cookie Deep Dive

The `cf_clearance` cookie is the mechanism Cloudflare uses to remember that a visitor passed a challenge. Understanding this cookie is important for debugging false positives.

**Cookie properties:**
```
cf_clearance=<token>; path=/; expires=<timestamp>; domain=.macksportreport.com; HttpOnly; Secure; SameSite=None
```

- **Domain:** Set to root domain with leading dot (covers all subdomains)
- **HttpOnly:** Cannot be read by JavaScript — prevents theft via XSS
- **Secure:** Only sent over HTTPS
- **SameSite=None:** Allows cross-site cookie submission (necessary for the challenge flow)
- **Lifetime:** Determined by "Challenge Passage" setting (default: 30 minutes)

**Important:** The `cf_clearance` cookie is tied to the visitor's IP address and user agent. If either changes (mobile network, VPN reconnect), the cookie becomes invalid and the visitor must solve a new challenge. This is a deliberate security measure.

**Debugging challenge loops:**
If a customer reports being stuck in an infinite challenge loop:
1. Check if their IP or user agent changes frequently
2. Check if they have cookies disabled
3. Check if a proxy strips the `cf_clearance` cookie
4. Check if Challenge Passage duration is too short

### Privacy Pass Protocol Internals (IETF RFC 9576)

Privacy Pass uses a **blind token** protocol:
1. **Issuance Phase:** Client sends a blinded nonce to the Cloudflare issuer. Cloudflare signs it without seeing the underlying nonce. Client unblinds the signature. This creates an unlinkable token.
2. **Redemption Phase:** Client presents the unblinded token. Cloudflare verifies the signature is valid but cannot link this token to the original issuance request.

This achieves **privacy**: Cloudflare knows that *some* visitor solved a challenge, but cannot link which specific challenge session to which redemption event.

**Token batching:** When a user solves a challenge, they typically receive 30 tokens at once, reducing how often they need to solve challenges.

### Security Level and Phase Execution

Security Level checks happen in the **http_request_firewall_pre** phase (before WAF rules). This means:
1. Security Level challenge fires → visitor gets challenge
2. IF visitor has valid `cf_clearance` → request proceeds to WAF phase
3. WAF rules evaluate
4. Request reaches origin (or is blocked by WAF)

This ordering matters when troubleshooting: a visitor who passes Security Level can still be blocked by WAF rules, but not vice versa.

### Browser Integrity Check — Header Analysis

BIC specifically flags these conditions:
- **No User-Agent:** `User-Agent: ` (empty or missing) → immediate challenge
- **No Accept:** Missing `Accept` header → flagged
- **Known bad UA strings:** User-agents containing strings like `python-requests`, `curl/`, `Go-http-client`, `libwww-perl`, `masscan`, `ZmEu`, `sqlmap` → flagged
- **Malformed headers:** Non-RFC-compliant header formatting

**BIC and APIs:**
Many legitimate API clients (Python requests library, curl-based monitoring tools) send headers that BIC flags. The recommended pattern for API traffic:
1. Route API traffic to a dedicated subdomain (api.macksportreport.com)
2. Disable BIC for that subdomain OR create a firewall rule that bypasses BIC for known API paths
3. Use a Firewall Rule with `http.request.uri.path matches "^/api/"` → action: Skip → check: Browser Integrity Check

---

## Dashboard Walkthrough

### Navigating to Security Overview

1. Log in to dash.cloudflare.com
2. Select your account → click on **macksportreport.com**
3. Left sidebar → **Security** → **Overview**

### Overview Page Layout

**Time Range Selector (top right)**
- Options: Last hour, Last 24 hours, Last 7 days, Last 30 days
- Changing this updates all charts and metrics simultaneously

**Top Metrics Row**
Three large number cards:
- **Total Threats Blocked**: Count of requests that received Block, Challenge, or JavaScript Challenge action
- **Threats Allowed**: Requests that were logged but not blocked (Log action)
- **Bot Traffic**: Requests identified as bot traffic (requires Bot Management or Bot Fight Mode)

**Threats Over Time Chart**
- Bar chart showing threats blocked per time bucket
- Hover over a bar to see breakdown by action type
- Click and drag to zoom into a specific time window
- Use this chart to identify the exact start/peak time of an attack

**Top Events Section**
Table showing top triggered rules:
- Rule ID / Rule Name
- Count of triggers
- Action taken
- Clicking a rule ID navigates to Security Events filtered by that rule

**Geographic Threat Map**
- World map with color-coded threat intensity by country
- Darker = more threats from that region
- Hover for country name + count
- Click a country to filter the Security Events view

**Top Threat Types**
Pie/bar chart showing:
- WAF Rule triggers
- Bot Management flags
- DDoS events
- Rate Limit hits

**Security Level Indicator**
- Current zone Security Level displayed with change button
- Quick link to Security → Settings to modify

### Changing Security Level (Dashboard)

1. Security → Overview → Look for "Security Level" card
2. Click the level name (e.g., "Medium")
3. A dropdown appears: Essentially Off, Low, Medium, High, I'm Under Attack
4. Select new level → changes apply within seconds globally

**Alternative path:** Security → Settings → Security Level dropdown

### Enabling "I'm Under Attack" Mode via API

```bash
# Enable I'm Under Attack Mode
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_level" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"value": "under_attack"}'

# Valid values: "essentially_off", "low", "medium", "high", "under_attack"

# Revert to medium after attack
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/{zone_id}/settings/security_level" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"value": "medium"}'
```

---

## Hands-On Lab

### Lab Setup

You'll need:
- macksportreport.com zone active in Cloudflare (proxied, orange-cloud DNS)
- Cloudflare API token with Zone:Zone Settings:Edit permission
- Your Zone ID (found in Dashboard → right sidebar → Zone ID)
- Terminal with `curl` available

### Lab 1.1 — Read Current Security Level

```bash
# Store your credentials
export CF_TOKEN="your_api_token_here"
export ZONE_ID="your_zone_id_here"

# Get current security level
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/security_level" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" | python3 -m json.tool
```

Expected response:
```json
{
  "result": {
    "id": "security_level",
    "value": "medium",
    "modified_on": "2026-05-28T10:00:00Z",
    "editable": true
  },
  "success": true
}
```

### Lab 1.2 — Simulate a Threat Score Check

```bash
# Check threat score for your own IP (for testing)
MY_IP=$(curl -s https://api.ipify.org)
echo "My IP: $MY_IP"

# Query Cloudflare IP Intelligence (requires account-level API token)
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/accounts/{account_id}/intel/ip?ipv4=${MY_IP}" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" | python3 -m json.tool
```

### Lab 1.3 — Enable and Test Hotlink Protection

```bash
# Enable Hotlink Protection via API
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/hotlink_protection" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}'

# Test hotlink protection (simulating a cross-site referrer)
curl -v -H "Referer: https://evil-competitor.com/steal-images.html" \
  "https://macksportreport.com/images/logo.png"
# Should return 403

# Test legitimate access (no referer = direct access = allowed)
curl -v "https://macksportreport.com/images/logo.png"
# Should return 200

# Disable after test
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/hotlink_protection" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "off"}'
```

### Lab 1.4 — Review Security Overview Dashboard

1. Navigate to dash.cloudflare.com → macksportreport.com → Security → Overview
2. Set time range to "Last 7 days"
3. Note: Total threats blocked count (even if 0 for a new zone)
4. Scroll to "Top Events" — should show any test requests that triggered rules
5. Hover over the geographic map
6. Check "Security Level" — confirm it shows "Medium"

### Lab 1.5 — Test Browser Integrity Check

```bash
# BIC enabled - try a request with no User-Agent (should trigger challenge)
curl -v --user-agent "" "https://macksportreport.com/"
# May receive 403 or challenge page

# Try with a known bad UA
curl -v -A "python-requests/2.28.0" "https://macksportreport.com/"
# May receive challenge

# Try with a legitimate browser UA
curl -v -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" "https://macksportreport.com/"
# Should receive 200
```

Note: BIC behavior depends on current Security Level and zone configuration. Results may vary.

---

## Demo Script (2 Minutes)

**Opening (20 seconds):**
"Let me show you the Security Overview for macksportreport.com. This is your command center — one page that shows every security event across your entire site."

**Threats Overview (30 seconds):**
"In the last 7 days, we blocked [X] threats. See this chart? You can see exactly when those attacks happened. If you had an incident on Tuesday, zoom in here and see the spike — that tells you when to start your investigation in the logs."

**Security Level (30 seconds):**
"Security Level is the dial that controls how aggressively we challenge suspicious IPs. We rate every IP on a 0–100 threat score based on its history across our 50 million protected sites. 'Medium' challenges anything above 14. If you're actively under attack, you can switch to 'I'm Under Attack' and we'll challenge every single visitor while the attack is happening."

**Browser Integrity Check (20 seconds):**
"Browser Integrity Check is automatic protection against bots that fake their identity. If a request shows up without a proper browser signature, we stop it before it even gets to your WAF rules."

**Close (20 seconds):**
"All of this is real-time, globally distributed. The moment an IP starts attacking anyone on our network, that intelligence feeds back into the threat scores affecting your site. You get collective defense from 50 million websites without lifting a finger."

---

## Competitive Context

| Feature | Cloudflare | AWS WAF + Shield | Akamai | Fastly |
|---------|-----------|-----------------|--------|--------|
| **IP Reputation Database** | 50M+ zones, real-time | AWS threat intel (limited public) | Akamai network (large, proprietary) | Limited |
| **Security Level Simplicity** | 5 levels, 1 click | No equivalent — per-rule configuration | Kona SiteDefender (complex) | No equivalent |
| **Threat Score Access** | In Firewall Rules (`cf.threat_score`) | IP Sets only | Via Kona policy | No |
| **"Under Attack" Mode** | Built-in, API toggleable | Manually add Shield Advanced rules | Manual rule changes | No |
| **Privacy Pass** | Built-in, IETF standard | Not available | Not available | Not available |
| **Managed Challenge** | Yes (AI-powered, low friction) | CAPTCHA only | Traditional CAPTCHA | CAPTCHA only |
| **Hotlink Protection** | Built-in toggle | Must build with Lambda@Edge | Available but complex | Not built-in |
| **Geographic Threat Map** | Yes, built-in | Requires CloudWatch + custom dashboards | Yes | Limited |
| **BIC (Header Analysis)** | Built-in | Custom WAF rules only | Available | Custom rules |
| **Time to enable** | Seconds (toggle) | Hours (rule configuration) | Days (account setup) | Hours |

---

## Self-Check Questions

**Question 1:** A customer says "we enabled I'm Under Attack mode and now our mobile app is broken." What is the most likely cause, and what should you recommend instead?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 2:** Explain the difference between a JS Challenge, a Managed Challenge, and an Interactive Challenge. In what scenario would you use each?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 3:** A customer's API partner is getting challenged by Cloudflare despite being a legitimate service. The partner's IP has a threat score of 22. The zone is set to "Medium" security level. What is happening, and what are three ways to fix it?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 4:** What is Privacy Pass, and how does it benefit users who frequently access high-security Cloudflare-protected sites?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 5:** A marketing team member complains that a partner site is hotlinking to macksportreport.com images for a legitimate co-marketing campaign. Hotlink Protection is enabled. How do you fix this without disabling Hotlink Protection for everyone?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

---

## Sources

- [Cloudflare Security Overview Documentation](https://developers.cloudflare.com/waf/)
- [Security Level Settings](https://developers.cloudflare.com/waf/reference/cloudflare-challenges/)
- [Challenge Types — Managed Challenge, JS Challenge, CAPTCHA](https://developers.cloudflare.com/waf/reference/cloudflare-challenges/)
- [Browser Integrity Check](https://developers.cloudflare.com/waf/tools/browser-integrity-check/)
- [Hotlink Protection](https://developers.cloudflare.com/waf/tools/scrape-shield/hotlink-protection/)
- [Privacy Pass](https://developers.cloudflare.com/waf/reference/privacy-pass/)
- [Threat Score](https://developers.cloudflare.com/waf/reference/cloudflare-challenges/#threat-score)
- [Zone Settings API — Security Level](https://developers.cloudflare.com/api/operations/zone-settings-get-security-level-setting)
- [IP Intelligence API](https://developers.cloudflare.com/api/operations/ip-intelligence-get-ip-overview)
- [Privacy Pass IETF RFC 9576](https://www.rfc-editor.org/rfc/rfc9576)
- [Project Honeypot](https://www.projecthoneypot.org/)
