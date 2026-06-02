# Module 3.5 — Security Settings
> Dashboard Location: macksportreport.com → Security → Settings | Estimated Time: 75 minutes | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is the Security Settings Page?

The Security Settings page is the control panel for zone-level security configuration options that aren't rule-based. Unlike Security Rules (which let you write conditional logic), Security Settings are global toggles and thresholds that affect how Cloudflare handles all traffic to the zone.

Think of Security Settings as the knobs and dials on the security infrastructure itself — they configure the behavior of the platform, while Security Rules configure the logic applied to requests.

**Settings covered in this module:**

| Setting | Category | Default |
|---------|----------|---------|
| Security Level | Threshold | Medium |
| Challenge Passage | Duration | 30 minutes |
| Browser Integrity Check | Inspection | On |
| Privacy Pass | Privacy/UX | Off |
| Email Address Obfuscation | Content protection | On |
| Server-Side Excludes (SSE) | Content protection | On |
| Hotlink Protection | Resource protection | Off |
| Onion Routing | Access | Off |
| Scrape Shield | Content protection | Various |

### Security Level — Full Detail

**What it controls:** The IP reputation threshold below which Cloudflare challenges visitors.

Security Level maps to `cf.threat_score` thresholds:

| Level | Setting Value | Challenges When | Behavior |
|-------|--------------|-----------------|----------|
| Essentially Off | `essentially_off` | threat_score > 49 | Only worst-reputation IPs challenged |
| Low | `low` | threat_score > 24 | Moderate suspicious IPs |
| Medium | `medium` | threat_score > 14 | Default, balanced |
| High | `high` | threat_score > 0 | All IPs with any reputation history |
| I'm Under Attack | `under_attack` | All visitors | 5-second JS challenge for everyone |

**What changes with each level:**
Cloudflare doesn't change any WAF rules when you change Security Level. It only changes the threshold for the challenge that fires when a visitor's IP exceeds the threat score. This is completely separate from your Custom Rules and Managed Rules.

**How Security Level interacts with other features:**
- Security Level fires BEFORE Custom Rules (earlier in the request lifecycle)
- If Security Level challenges a visitor and they pass, they continue to Custom Rules
- Custom Rules with `cf.threat_score` can apply additional controls beyond Security Level
- Security Level does NOT bypass WAF managed rules

**When to use each level:**

*Essentially Off:* Rarely. Use for testing or when you want essentially no automatic challenges. Your Custom Rules and Managed Rules still apply.

*Low:* Good for sites with a lot of API traffic or partner integrations where you don't want friction, but still want protection against the very worst IPs.

*Medium:* Default. Most sites should stay here. Balanced between protection and legitimate user friction.

*High:* Spike in attacks. When you're seeing elevated suspicious activity but not under active DDoS. Expect some legitimate user friction.

*I'm Under Attack:* Active DDoS emergency only. Breaks:
- API clients (can't solve JS challenges)
- Mobile apps without embedded browsers
- Automated monitoring tools
- Web scrapers (legitimate and malicious)
- RSS feed readers
- Curl/wget-based integrations

### Challenge Passage

**What it controls:** How long a visitor's successful challenge completion remains valid before they're challenged again.

**How it works:**
1. Visitor encounters a security challenge (from Security Level, Bot Management, or a WAF rule)
2. Visitor successfully completes the challenge
3. Cloudflare sets a `cf_clearance` cookie with a configured lifetime
4. For the duration of the Challenge Passage period, the visitor is not challenged again on this zone
5. After the period expires, the cookie is invalid and the visitor may be challenged again

**Available values:**
- 5 minutes
- 15 minutes
- 30 minutes (default)
- 45 minutes
- 1 hour
- 2 hours
- 3 hours
- 4 hours
- 5 hours
- 8 hours
- 12 hours
- 1 day
- 1 week
- 1 month

**Considerations for setting Challenge Passage duration:**

*Short duration (5–15 min):* More secure. Visitors re-challenged frequently. Good for high-security admin areas or pages with sensitive data. Increases friction.

*Long duration (hours–days):* Better UX. Legitimate users rarely see challenges. Good for media/content sites where challenges are an emergency measure.

*Important security note:* The `cf_clearance` cookie is tied to the visitor's IP + user agent combination. If either changes (VPN reconnect, mobile network handoff, user agent rotation), the cookie is invalidated regardless of the Challenge Passage duration.

**Cookie properties:**
```
Name: cf_clearance
Domain: .macksportreport.com  (covers all subdomains)
Path: /
Secure: true  (HTTPS only)
HttpOnly: true  (not accessible via JavaScript)
SameSite: None
Expiry: [current time + Challenge Passage duration]
```

### Browser Integrity Check (BIC)

**What it does:** Analyzes the HTTP request headers of incoming requests to detect bot-like behavior before any rules are evaluated.

**Headers it analyzes:**
- `User-Agent` — Missing, empty, or known-bad UA strings
- `Accept` — Missing `Accept` header (most browsers always send this)
- `Accept-Language` — Legitimate browsers almost always include this
- `Accept-Encoding` — Normal browsers send this; simple bots often don't
- Non-RFC-compliant formatting of headers

**What it catches:**
- Raw HTTP clients that don't set standard browser headers
- Command-line tools (curl, wget) without custom header configuration
- Scrapers using basic HTTP libraries
- Automated attack tools with default configurations

**What it does NOT catch:**
- Headless browsers (Puppeteer, Playwright) — these correctly replicate browser headers
- Well-configured scrapers that set proper headers
- APIs built with properly configured HTTP clients

**When to disable BIC:**
- When you have legitimate API clients that send non-standard headers
- When monitoring tools are getting challenged
- When you have curl-based health checks that you want to allow

**Recommended alternative to disabling globally:** Create a Custom Rule that skips BIC for specific paths:
```
# In your WAF custom rule:
# Expression: http.request.uri.path matches "^/api/" OR ip.src in $monitoring_ips
# Action: Skip → Browser Integrity Check
```

However, Skip for BIC specifically is configured through the Zone Settings API rather than as a WAF rule action.

### Email Address Obfuscation

**What it does:** Automatically replaces email addresses found in your HTML source code with JavaScript-rendered versions to prevent email harvesting by bots.

**How it works:**
Without obfuscation, in your HTML:
```html
<p>Contact us at info@macksportreport.com for support.</p>
```

With obfuscation enabled, Cloudflare transforms this (at the edge, without modifying your origin files) to something like:
```html
<p>Contact us at <span class="__cf_email__" data-cfemail="[encoded-email-bytes]">[email&#160;protected]</span><script>/* decode script */</script> for support.</p>
```

Visitors with JavaScript enabled see the real email address (decoded by the JavaScript snippet Cloudflare injects). Bots that scrape raw HTML see only the encoded version.

**Limitation:** Bots that execute JavaScript (headless browsers) can still harvest the email. This protects against simple crawlers, not sophisticated ones.

**When to disable:** If you're using email addresses in structured data (JSON-LD, microdata) and obfuscation is interfering, or if your application relies on email addresses in HTML for functional reasons.

### Server-Side Excludes (SSE)

**What it does:** Allows you to mark specific sections of your HTML with special tags, and Cloudflare will hide that content from visitors with high threat scores (suspicious visitors).

**How it works:**
Wrap sensitive content in your HTML:
```html
<!--sse-->
<p>Special pricing: $99/month for verified customers</p>
<p>Internal phone: 555-0100</p>
<!--/sse-->
```

For visitors with a suspicious IP (based on Security Level), Cloudflare strips out the content between the `<!--sse-->` and `<!--/sse-->` tags before serving the response.

**Use cases:**
- Hide pricing from scrapers
- Hide phone numbers from spam harvesting bots
- Hide internal reference information from suspicious visitors
- Display different promotional content to verified vs. suspicious visitors

**Important limitations:**
- Only works with HTML responses (not JSON, XML, etc.)
- Requires changes to your source HTML — you have to add the SSE comment tags
- High-sophistication scrapers can identify and work around this pattern
- Does not encrypt content — just withholds it from suspicious visitors

**Configuration:** Security → Settings → Server-Side Excludes (On/Off)
The feature needs to be enabled zone-wide, and the `<!--sse-->` tags need to be present in your HTML.

### Hotlink Protection

**What it does:** Prevents other websites from including (hotlinking) your images and other assets directly in their pages, consuming your bandwidth without your permission.

**Technical mechanism:**
When Hotlink Protection is enabled:
1. Cloudflare inspects the `Referer` HTTP header on requests for common asset types (images, JavaScript, CSS, other media)
2. If the `Referer` header is set AND the domain in `Referer` is not your zone's domain — the request is blocked (403)
3. Requests with no `Referer` header (direct URL access, browser address bar) are allowed
4. Requests where `Referer` matches the current zone are allowed

**Asset types that Hotlink Protection applies to:**
- Images: `.jpg`, `.jpeg`, `.gif`, `.png`, `.bmp`, `.svg`, `.ico`, `.webp`
- Media: `.mp4`, `.mov`, `.avi`, `.wmv`, `.flv`
- Audio: `.mp3`, `.wav`, `.ogg`
- Documents: `.pdf`

**What Hotlink Protection does NOT protect:**
- HTML pages (only assets)
- JSON/XML API responses
- Requests where `Referer` is stripped by the client (privacy settings)

**Enabling via API:**
```bash
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/hotlink_protection" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}'
```

**Common false positive scenario:** A customer enables Hotlink Protection and breaks a legitimate image syndication partnership. Solution: Create a Custom Rule that bypasses Hotlink Protection for the partner's domain referrer.

Actually — Hotlink Protection doesn't have a WAF Skip mechanism. For cross-domain image sharing exceptions, you'd need to disable Hotlink Protection and implement it via Custom Rules instead:
```
# Block hotlinks except from partner domain:
# Expression: http.referer ne "" and not (http.referer contains "macksportreport.com" or http.referer contains "partner-site.com") and http.request.uri.path matches "\.(jpg|png|gif|webp)$"
# Action: Block
```

### Onion Routing

**What it does:** Configures whether Cloudflare serves your site to visitors coming through the Tor anonymization network.

**How it works:**
Cloudflare has a partnership with the Tor project. When Onion Routing is enabled:
1. Cloudflare creates a `.onion` address for your site
2. Tor users can access your site via the `.onion` address
3. The Tor network routes traffic to Cloudflare's edge, where it's treated like any other HTTPS request
4. This avoids exit node surveillance (Tor exit nodes see the `.onion` address, not the actual target)
5. Your site's origin server never sees Tor traffic directly

**Privacy implications:**
- Tor users accessing via the `.onion` address get end-to-end encryption from their Tor client to Cloudflare's edge
- Your origin server doesn't need to know about Tor at all

**Security considerations:**
- Some botnets route through Tor; enabling Onion Routing may slightly increase bot traffic
- Tor exit nodes often have high threat scores — Onion Routing bypasses some of this scoring for .onion traffic
- Can be useful for news sites, whistleblowing platforms, or sites serving users in censored regions

**Configuration:** Security → Settings → Onion Routing (On/Off)

### Scrape Shield

Scrape Shield is a collection of features designed to protect your content from scraping:
- **Email Address Obfuscation** (covered above)
- **Server-Side Excludes** (covered above)
- **Hotlink Protection** (covered above)

These three features are grouped under "Scrape Shield" as a conceptual umbrella.

---

## Deep Dive (Architect-Level)

### Challenge Passage Cookie Security Analysis

The `cf_clearance` cookie implementation has interesting security properties worth understanding:

**Cookie binding:**
The `cf_clearance` cookie is cryptographically bound to:
- The visitor's IP address
- The visitor's user agent string

Cloudflare signs the cookie with a server-side key that includes these values. If the cookie is extracted and replayed from a different IP or with a different UA, it's invalid. This prevents:
- Cookie theft via XSS (can't use from different IP)
- Cookie sharing between users
- Cookie replay attacks after IP rotation

**Cookie NOT bound to:**
- Session ID (stateless — no server-side session)
- User identity (anonymous — CF doesn't know WHO this is, just that they passed a challenge)
- Specific URL path (cookie is valid for the entire domain)

**`SameSite=None` Requirement:**
The `cf_clearance` cookie requires `SameSite=None` because it needs to be sent during the challenge redirect flow, which involves cross-origin requests. This is a deliberate security tradeoff — the binding to IP+UA compensates for the SameSite relaxation.

### Security Level and IP Intelligence Internals

Cloudflare's threat score system aggregates multiple signals:

**Signal sources:**
1. **Project Honeypot** — Network of honey pots that identify spam senders, comment spammers, harvesters. IPs appear in the Project Honeypot database when they interact with honey pots.
2. **Cloudflare Network Intelligence** — Cloudflare observes attack traffic across all ~50M+ zones. An IP that attacks one zone immediately has its score elevated across all zones.
3. **Third-party threat feeds** — Integration with commercial and open-source threat intelligence feeds
4. **DNSBL (DNS Blackhole Lists)** — Checks against common email spam blacklists (Spamhaus, etc.)

**Score decay:**
Threat scores are not permanent. They decay over time if the IP is not observed in malicious activity. An IP that was part of a botnet but has been cleaned will eventually recover a lower score.

**Score overrides:**
You can create Custom Rules that ignore the threat score for specific IPs or networks:
```
# Override: trust all Google ASN IPs regardless of threat score
ip.geoip.asnum eq 15169
```

### Email Obfuscation — Technical Implementation

Cloudflare applies email obfuscation in the `http_response_firewall_managed` phase — after content is fetched from origin but before being sent to the visitor.

**Encoding algorithm:**
```javascript
// CF encodes email addresses using a simple XOR cipher
// The key changes per page request, making scraping harder
function encodeEmail(email) {
  const key = Math.floor(Math.random() * 256);
  let encoded = '@' + key.toString(16).padStart(2, '0');
  for (let i = 0; i < email.length; i++) {
    encoded += (email.charCodeAt(i) ^ key).toString(16).padStart(2, '0');
  }
  return encoded;
}
```

The decoding script is injected by Cloudflare's edge servers and runs client-side to reconstruct the email. It's not intended to be cryptographically secure — it's obfuscation against simple scrapers, not encryption.

**Content-Type requirement:**
Email obfuscation only applies to responses with `Content-Type: text/html`. JSON APIs, XML feeds, and other content types are not modified.

**Interaction with caching:**
Email obfuscation happens at the edge on every request for uncached content. For cached responses, the obfuscation is applied when the response is cached and the obfuscated version is served from cache.

### Security Settings via API — Full Reference

```bash
# Get all security-related zone settings
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
security_settings = ['security_level', 'challenge_ttl', 'browser_check', 
                     'privacy_pass', 'email_obfuscation', 'server_side_exclude',
                     'hotlink_protection', 'opportunistic_onion', 'security_header']
for s in data.get('result', []):
    if s['id'] in security_settings:
        print(f\"{s['id']}: {s['value']}\")
"

# Configure Challenge Passage (challenge_ttl) — value in seconds
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/challenge_ttl" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": 1800}'  # 30 minutes = 1800 seconds

# Valid values (seconds): 300, 900, 1800, 2700, 3600, 7200, 10800, 14400, 28800, 57600, 86400, 604800, 2592000

# Enable/disable Browser Integrity Check
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/browser_check" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}'

# Enable/disable Email Obfuscation
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/email_obfuscation" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}'

# Enable/disable Server-Side Excludes
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/server_side_exclude" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}'

# Enable/disable Hotlink Protection
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/hotlink_protection" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "off"}'

# Enable/disable Onion Routing
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/opportunistic_onion" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}'
```

### Challenge Passage and SPA (Single-Page Applications)

SPA applications have a specific challenge with Cloudflare challenges:

**Problem:** An SPA makes API requests in the background. If the API endpoint is challenged, the background XHR/fetch call receives the challenge interstitial HTML, not the JSON the app expected. The app breaks.

**Solutions:**

1. **Separate API subdomain:** Put your API on `api.macksportreport.com` with different security settings (lower Security Level, BIC disabled, no challenges on API endpoints)

2. **API-specific rules:** Custom Rule: `http.request.uri.path starts_with "/api/" AND http.user_agent contains "XMLHttpRequest"` → Skip → Challenge rules

3. **Service tokens (Access):** Use Cloudflare Access service tokens for API authentication, which bypass challenges entirely

4. **Challenge Passage duration:** Longer Challenge Passage means users don't need to re-challenge as often — reduces the chance of a background API call hitting a challenge

### Security Header — HSTS Configuration

The Security Settings page also includes **Security Header (HSTS)** configuration. HSTS (HTTP Strict Transport Security) tells browsers to only use HTTPS for your domain.

```bash
# Enable HSTS via API
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/security_header" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "value": {
      "strict_transport_security": {
        "enabled": true,
        "max_age": 31536000,
        "include_subdomains": true,
        "preload": false,
        "nosniff": true
      }
    }
  }'
```

**Warning:** Enabling HSTS with `preload: true` submits your domain to browser HSTS preload lists. This is irreversible for months/years and means even HTTP connections will be refused by browsers. Only enable preload if you are committed to HTTPS forever.

---

## Dashboard Walkthrough

### Navigating to Security Settings

1. dash.cloudflare.com → macksportreport.com → Security → **Settings**

### Security Level Section

1. Find "Security Level" — shows current value
2. Click the dropdown to see all 5 options
3. Hover over each option to see the description tooltip
4. Select and confirm — changes apply globally within seconds

**Note in dashboard:** "Security Level" may appear at the top of the Security → Overview page as well, with a quick-change link

### Challenge Passage Section

1. "Challenge Passage" or "Challenge TTL" in the settings list
2. Current value shown (default: 30 minutes)
3. Dropdown with all time options
4. Changes take effect immediately (no propagation delay for settings changes)

### Browser Integrity Check Section

1. Find "Browser Integrity Check" — On/Off toggle
2. Hovering shows tooltip: "Evaluate HTTP headers for threats. Enable to block specific threats like missing or non-standard browser headers."
3. Toggle and confirm

### Privacy Pass Section

1. Find "Privacy Pass" — On/Off toggle
2. When enabled, visitors who solve challenges receive Privacy Pass tokens for future frictionless access

### Scrape Shield Section

Three sub-settings:
1. **Email Address Obfuscation** — On/Off toggle
2. **Server-Side Excludes** — On/Off toggle  
   - After enabling, add `<!--sse-->` and `<!--/sse-->` tags to your HTML
3. **Hotlink Protection** — On/Off toggle
   - After enabling, test with `curl -H "Referer: https://evil.com" https://macksportreport.com/image.jpg`

### Security Header (HSTS)

1. Find "Security Header" or "HTTP Strict Transport Security (HSTS)"
2. Click **Configure** or the pencil icon
3. A modal opens with:
   - **Enable HSTS** toggle
   - **Max Age** selector (in seconds — minimum 1 month recommended)
   - **Include subdomains** checkbox
   - **Preload** checkbox (WARNING: read the implications)
   - **No-Sniff** checkbox (X-Content-Type-Options: nosniff)

---

## Hands-On Lab

### Lab 5.1 — Audit All Security Settings

```bash
# Get all settings and display security-relevant ones
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
security_settings = {
    'security_level': 'Security Level',
    'challenge_ttl': 'Challenge Passage (seconds)',
    'browser_check': 'Browser Integrity Check',
    'privacy_pass': 'Privacy Pass',
    'email_obfuscation': 'Email Obfuscation',
    'server_side_exclude': 'Server-Side Excludes',
    'hotlink_protection': 'Hotlink Protection',
    'opportunistic_onion': 'Onion Routing',
    'security_header': 'Security Header (HSTS)',
    'ssl': 'SSL Mode',
    'min_tls_version': 'Minimum TLS Version',
    'tls_1_3': 'TLS 1.3'
}
print('SECURITY SETTINGS AUDIT FOR ZONE')
print('=' * 50)
for s in data.get('result', []):
    if s['id'] in security_settings:
        print(f\"{security_settings[s['id']]}: {s['value']}\")
"
```

### Lab 5.2 — Test Browser Integrity Check

```bash
# Test with missing User-Agent (simulating basic bot)
# Note: BIC behavior depends on current Security Level
curl -v --user-agent "" "https://macksportreport.com/" 2>&1 | head -30

# Test with known-bad user agent
curl -v -A "sqlmap/1.7.8#stable (https://sqlmap.org)" "https://macksportreport.com/" 2>&1 | head -30

# Test with legitimate user agent
curl -v -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" "https://macksportreport.com/" 2>&1 | head -30
```

### Lab 5.3 — Test Email Obfuscation

```bash
# Check if a page with an email address has obfuscation applied
# First, add a test email to your site's HTML (or find an existing one)
# Then fetch the page and look for the obfuscation markers

curl -s "https://macksportreport.com/" | grep -i "__cf_email__"
# If email obfuscation is working, you'll see elements with class __cf_email__

# Compare with what the raw HTML looks like
curl -s "https://macksportreport.com/" | grep -i "cfemail"
```

### Lab 5.4 — Configure Challenge Passage Duration

```bash
# Get current Challenge Passage value
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/challenge_ttl" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -m json.tool

# Change to 1 hour (3600 seconds)
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/challenge_ttl" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": 3600}'

# Verify the change
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/challenge_ttl" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -m json.tool

# Revert to default 30 minutes
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/challenge_ttl" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": 1800}'
```

### Lab 5.5 — Test Hotlink Protection

```bash
# Enable Hotlink Protection
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/hotlink_protection" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}'

# Wait 10 seconds for propagation
sleep 10

# Test 1: Access image without Referer header (should work — 200)
curl -v "https://macksportreport.com/favicon.ico" 2>&1 | grep "< HTTP"

# Test 2: Access image with same-domain Referer (should work — 200)
curl -v -H "Referer: https://macksportreport.com/sports.html" \
  "https://macksportreport.com/favicon.ico" 2>&1 | grep "< HTTP"

# Test 3: Access image with cross-domain Referer (should fail — 403)
curl -v -H "Referer: https://competitor-site.com/page.html" \
  "https://macksportreport.com/favicon.ico" 2>&1 | grep "< HTTP"

# Disable after testing
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/hotlink_protection" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "off"}'
```

### Lab 5.6 — Check Security Header (HSTS) Configuration

```bash
# Check current HSTS settings
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/security_header" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -m json.tool

# Check if HSTS header is being sent in HTTP responses
curl -sI "https://macksportreport.com/" | grep -i "strict-transport"

# Read about HSTS preload risks before enabling:
echo "HSTS Preload List: https://hstspreload.org/"
echo "WARNING: Preload is irreversible for months. Do NOT enable in lab unless you understand the implications."
```

---

## Demo Script (2 Minutes)

**Opening (15 seconds):**
"Let me walk you through the security controls that govern how Cloudflare treats traffic to your entire site — these are the zone-level settings that underpin everything else."

**Security Level + Challenge Passage (40 seconds):**
"Security Level is the dial that controls how aggressive Cloudflare is with suspicious IPs. On Medium — the default — we challenge any IP with a reputation score above 14 out of 100. When you're under attack, you can shift this to High or I'm Under Attack with a single click or an API call. [Show dropdown] Challenge Passage controls how long someone stays 'trusted' after passing a challenge. For a high-security dashboard, you'd set this to 15 minutes. For a public media site, maybe 1 day so legitimate readers aren't re-challenged every time."

**Scrape Shield (30 seconds):**
"Scrape Shield is three protections working together. Email Obfuscation prevents spam harvesters from collecting your staff's contact information — it transforms email addresses in your HTML into JavaScript that bots can't easily harvest. Server-Side Excludes let you tag specific content — like pricing or phone numbers — that you only want shown to real humans. Hotlink Protection stops other sites from embedding your images and consuming your bandwidth."

**BIC + Privacy Pass (35 seconds):**
"Browser Integrity Check catches bots that don't even bother faking a proper browser. If a request shows up with no User-Agent or a curl signature, we stop it automatically. And Privacy Pass is the elegant solution to challenge fatigue — legitimate users who prove they're human get a cryptographic token that lets them skip future challenges across any Cloudflare-protected site, so your security doesn't hurt your legitimate users."

---

## Competitive Context

| Setting | Cloudflare | AWS CloudFront/WAF | Akamai | Fastly |
|---------|-----------|-------------------|--------|--------|
| **Security Level (IP reputation)** | Yes, 5 levels, 1-click | Not equivalent | Reputation score (complex config) | Not built-in |
| **Challenge Passage duration** | 5min to 1 month, configurable | N/A (no challenge mechanism) | Session-based | N/A |
| **Browser Integrity Check** | Built-in toggle | Custom WAF rules only | Header inspection (complex) | Custom VCL |
| **Email Obfuscation** | Automatic, edge-based | Not available | Not available | Not available |
| **Server-Side Excludes** | Yes, HTML comment-based | Not available | Not available | Not available |
| **Hotlink Protection** | 1-click toggle | Lambda@Edge required | Available but complex | Custom VCL |
| **Privacy Pass** | Built-in, IETF standard | Not available | Not available | Not available |
| **HSTS Configuration** | Built-in, in-dashboard | CloudFront response headers policy | Available | Custom VCL |
| **Onion Routing (.onion)** | Yes, native Tor integration | Not available | Not available | Not available |
| **Settings change speed** | Seconds globally | Minutes (propagation) | Minutes | Minutes |
| **API management** | All settings via REST API | CloudFormation/API | API available | API available |
| **Cost** | Included in all plans | Variable add-on costs | Enterprise pricing | Enterprise pricing |

---

## Self-Check Questions

**Question 1:** A customer switches their site to "High" Security Level to handle an attack. The next day, their customer success team reports that enterprise customers are getting challenged when trying to access a B2B portal. What is causing this, and what is the correct long-term solution?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 2:** What is the Challenge Passage cookie (`cf_clearance`)? What is it cryptographically bound to, and what happens if a user's IP changes during a session?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 3:** A customer's SPA is breaking when they're under attack and using "I'm Under Attack" mode. Background AJAX calls are receiving the challenge HTML instead of JSON. What are two architectural solutions to this problem?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 4:** What is the risk of enabling HSTS with the `preload` option, and when should a customer NOT enable it?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 5:** A customer asks if Email Obfuscation prevents all email harvesting. What is the honest answer, and what does it actually protect against?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

---

## Sources

- [Security Level Settings](https://developers.cloudflare.com/waf/reference/cloudflare-challenges/)
- [Challenge Passage (challenge_ttl) API](https://developers.cloudflare.com/api/operations/zone-settings-get-challenge-ttl-setting)
- [Browser Integrity Check](https://developers.cloudflare.com/waf/tools/browser-integrity-check/)
- [Privacy Pass](https://developers.cloudflare.com/waf/reference/privacy-pass/)
- [Email Address Obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/)
- [Server-Side Excludes](https://developers.cloudflare.com/waf/tools/scrape-shield/server-side-excludes/)
- [Hotlink Protection](https://developers.cloudflare.com/waf/tools/scrape-shield/hotlink-protection/)
- [Onion Routing (Opportunistic Encryption)](https://developers.cloudflare.com/network/onion-routing/)
- [HSTS — Security Header](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/)
- [Zone Settings API](https://developers.cloudflare.com/api/operations/zone-settings-list-all-zone-settings)
- [cf_clearance Cookie](https://developers.cloudflare.com/waf/reference/cloudflare-challenges/#clearance-cookies)
- [HSTS Preload List](https://hstspreload.org/)
