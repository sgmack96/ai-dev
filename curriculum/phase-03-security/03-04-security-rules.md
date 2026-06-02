# Module 3.4 — Security Rules (WAF, Rate Limiting, Managed Rules)
> Dashboard Location: macksportreport.com → Security → Security Rules | Estimated Time: 3 hours | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### The Four Pillars of Security Rules

Cloudflare's Security Rules system is built around four distinct rule categories, each designed for a different threat model:

| Category | Purpose | Trigger | Action |
|----------|---------|---------|--------|
| **Custom Rules** | Your own logic — block specific IPs, paths, conditions | Custom expression (Wireshark-style filter syntax) | Block, Challenge, Log, Skip, Allow |
| **Rate Limiting Rules** | Throttle requests exceeding a threshold | Request count over time window | Block, Challenge, Log |
| **Managed Rules (WAF)** | Pre-built rules maintained by Cloudflare security team | Attack signatures (SQLi, XSS, RCE, etc.) | Block, Challenge, Log, Override |
| **Bot Management** | Classify and act on automated traffic | Bot score, bot category, known bot lists | Block, Challenge, Log, Allow |

Understanding when to use each is the most important skill in this module. The wrong tool leads to either too many false positives or missed attacks.

### How the Ruleset Engine Works

Cloudflare's ruleset engine processes every HTTP request through a series of **phases**. Each phase is an ordered list of rules evaluated in sequence. Rules are evaluated top-to-bottom within a phase, and the first matching rule determines the outcome (unless the action is "log," which logs and continues evaluation).

**Key phases for security:**
- `http_request_firewall_pre` — Custom Rules (before WAF)
- `http_request_firewall_managed` — Managed Rules (WAF rulesets)
- `http_ratelimit` — Rate Limiting Rules
- `http_request_sbfm` — Super Bot Fight Mode / Bot Management

**Evaluation order across phases:**
1. DDoS L7 (automatic, always-on)
2. Custom Rules (http_request_firewall_custom)
3. Rate Limiting (http_ratelimit)
4. Managed Rules / WAF (http_request_firewall_managed)
5. Bot Management
6. Origin request forwarded

**Critical implication:** A Skip/Allow rule in Custom Rules can bypass WAF Managed Rules. This is intentional and necessary for trusted IP allowlisting, but dangerous if misconfigured.

### Rule Priority Within a Phase

Within a phase (e.g., Custom Rules), rules are evaluated in a defined order:
1. Rules are numbered by their position in the list (1, 2, 3...)
2. First matching rule that returns a **terminating action** (Block, Challenge, Skip) stops processing
3. Non-terminating actions (Log) allow processing to continue to the next rule

**Priority management:**
- Rules are ordered by position in the dashboard list
- Drag-and-drop to reorder in the dashboard
- Via API: rules are ordered by their position in the array

**Best practices:**
- Put broad "allow" rules (trusted IPs) FIRST so they skip everything else
- Put specific block rules BEFORE broad allow rules for the specific threats you know about
- Use "Log" action during testing before switching to "Block"

### Custom Rules (formerly Firewall Rules)

Custom Rules are the most flexible security primitive in Cloudflare. They use the **Rules Language** — an expression syntax similar to Wireshark/tcpdump filters.

#### Fields Reference

The following fields are available in rule expressions:

**IP and Network:**
```
ip.src                    # Visitor's IP address (IPv4 or IPv6)
ip.geoip.country          # Country code (US, CN, DE, etc.)
ip.geoip.asnum            # AS number (15169 = Google)
ip.geoip.continent        # Continent code (EU, AS, NA, SA, AF, OC)
cf.threat_score           # Cloudflare IP reputation score (0-100)
```

**HTTP Request:**
```
http.request.method       # GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH
http.request.uri          # Full URI including path and query string
http.request.uri.path     # Path only (/api/users)
http.request.uri.query    # Query string only (id=123&page=2)
http.host                 # Hostname (macksportreport.com)
http.user_agent           # Browser/bot identifier string
http.referer              # HTTP Referer header
http.request.version      # HTTP version (HTTP/1.1, HTTP/2)
http.request.body.raw     # Full request body (POST body) — requires Enterprise
http.request.body.size    # Size of request body in bytes
http.request.body.mime    # MIME type of body
http.cookie               # Full cookie header value
```

**HTTP Headers:**
```
http.request.headers      # Map of all request headers
http.request.headers["x-custom-header"]  # Specific header value
http.request.headers.names   # List of header names
http.request.headers.values  # List of header values
```

**Cloudflare-specific:**
```
cf.bot_management.score        # Bot score (1-99, requires Bot Management)
cf.bot_management.verified_bot # Boolean — is this a known good bot?
cf.bot_management.ja3_hash     # TLS fingerprint (JA3 hash)
cf.client.bot                  # Boolean — is this a known bot category?
cf.threat_score                # Reputation score (0-100)
cf.credentials_compromised     # Boolean — compromised credentials detected
cf.scan.malware.detected       # Boolean — malware in upload detected
cf.edge.server_ip              # Edge server IP that received the request
```

**SSL/TLS:**
```
ssl                       # Boolean — is this an HTTPS request?
cf.tls_client_auth        # mTLS client certificate fields
```

#### Operators

```
eq          # Equals
ne          # Not equals
lt          # Less than (numeric)
le          # Less than or equal
gt          # Greater than (numeric)
ge          # Greater than or equal
contains    # String contains (case-sensitive)
matches     # Regex match (RE2 syntax)
in          # In a list of values: ip.src in {1.2.3.4, 5.6.7.8}
```

**String operators:**
```
~ "pattern"     # Regex match (shorthand for 'matches')
```

**Logical operators:**
```
and         # Both conditions true
or          # Either condition true
not         # Negate a condition
(...)       # Grouping
```

#### Action Types (Detailed)

| Action | HTTP Response | Continues? | Description |
|--------|--------------|------------|-------------|
| **Block** | 403 Forbidden (default) or custom | No | Terminates request, returns error |
| **Managed Challenge** | Challenge interstitial | Depends | CF chooses challenge type based on risk |
| **JS Challenge** | 5-second JS page | Depends | JavaScript-based challenge (legacy) |
| **Interactive Challenge** | Visual CAPTCHA | Depends | Human visual puzzle |
| **Log** | None — request continues | Yes | Records event, does not modify request |
| **Skip** | None — skips rules | Yes | Bypasses specified rulesets for this request |
| **Allow** | None | Yes | Overrides block rules (use with caution) |

**Custom Block Response:**
You can customize the Block action's response:
- HTTP status code (default 403, can set to 429, 503, etc.)
- Custom response body (HTML page or JSON error message)
- Custom response headers

```json
{
  "action": "block",
  "action_parameters": {
    "response": {
      "status_code": 403,
      "content": "{\"error\": \"Request blocked by security policy\", \"code\": \"CF-WAF-001\"}",
      "content_type": "application/json"
    }
  }
}
```

#### Skip Action — Bypassing Specific Rules

The Skip action is powerful but dangerous. It can bypass:
- All managed rulesets
- Specific rulesets
- Specific rules by ID
- Rate limiting
- Bot management

```json
{
  "action": "skip",
  "action_parameters": {
    "ruleset": "managed_ruleset",
    "rulesets": ["efb7b8c949ac4650a09736fc376e9aee"],
    "rules": {
      "efb7b8c949ac4650a09736fc376e9aee": ["100014", "100015"]
    }
  },
  "expression": "ip.src in $trusted_ip_list"
}
```

### Rate Limiting Rules

Rate limiting protects against volumetric attacks: brute force login, credential stuffing, API abuse, scraping.

**Key components of a rate limiting rule:**

1. **Matching expression:** Which requests to count (same syntax as Custom Rules)
2. **Counting expression:** What to count per window (optional — can count subset of matched requests)
3. **Threshold:** Number of matching requests before triggering
4. **Period (window):** Time window over which to count (10s, 60s, 120s, 300s, 600s, 3600s)
5. **Characteristics:** What to use as the "key" for counting
6. **Mitigation action:** What to do when threshold is exceeded
7. **Mitigation timeout:** How long to apply the mitigation

#### Characteristics (Rate Limit Keys)

The characteristic determines "who" is being rate limited:

```
IP address               # Count per unique IP
IP with NAT              # Count per IP, accounting for NAT pools
Cookie value             # Count per session cookie value
Query string value       # Count per query parameter
HTTP header value        # Count per header value (e.g., API key)
IP + path                # Count per IP per URL path combination
ASN                      # Count per autonomous system number
```

**Example: Login brute force protection**
```json
{
  "action": "block",
  "ratelimit": {
    "characteristics": ["ip.src"],
    "period": 60,
    "requests_per_period": 5,
    "mitigation_timeout": 300
  },
  "expression": "http.request.method eq \"POST\" and http.request.uri.path eq \"/login\"",
  "description": "Block brute force login attempts: 5 attempts per minute"
}
```

**Example: API rate limiting (per API key)**
```json
{
  "action": "block",
  "ratelimit": {
    "characteristics": [
      "http.request.headers[\"x-api-key\"]"
    ],
    "period": 3600,
    "requests_per_period": 1000,
    "mitigation_timeout": 3600
  },
  "expression": "http.request.uri.path matches \"^/api/\"",
  "description": "1000 API requests per hour per API key"
}
```

#### Rate Limiting Response Headers

When a request is rate limited, Cloudflare returns:
- `Retry-After: 300` — seconds until rate limit expires
- `X-RateLimit-Limit: 100` — the configured threshold
- `X-RateLimit-Remaining: 0` — remaining requests in current window
- `X-RateLimit-Reset: 1685000000` — Unix timestamp when limit resets

### Managed Rules (WAF)

Managed Rules are pre-built rule sets maintained by the Cloudflare security team and updated continuously as new attack patterns emerge.

#### Available Managed Rulesets

**1. Cloudflare Managed Ruleset**
- Cloudflare's own research-based ruleset
- Covers OWASP Top 10 attack categories
- Updated by Cloudflare's threat intelligence team
- Rule IDs prefixed with `cf.`
- Categories: SQLi, XSS, RCE, Local File Inclusion, Remote File Inclusion, path traversal, etc.

**2. Cloudflare OWASP Core Ruleset**
- Based on the OWASP ModSecurity Core Rule Set (CRS)
- Industry-standard web application protection
- Paranoia levels: 1 (low FP), 2, 3, 4 (high detection, higher FP risk)
- Scoring-based: anomaly score threshold determines blocking
- Rule IDs prefixed with `owasp.`

**3. Cloudflare Exposed Credentials Check**
- Checks login requests against breach database (Module 3.3)

**4. Cloudflare Free Managed Ruleset** (Free plan)
- Subset of Cloudflare Managed Ruleset for free zones

#### Paranoia Levels (OWASP Ruleset)

OWASP CRS paranoia levels progressively add more detection rules:

| Level | Detection | False Positives | Use Case |
|-------|-----------|----------------|----------|
| **PL1** | Basic common attacks | Very low | Production default for most sites |
| **PL2** | More comprehensive | Low | Sites handling sensitive data |
| **PL3** | Aggressive detection | Medium | High-security environments |
| **PL4** | Maximum detection | High | PCI-DSS, HIPAA environments where FP is acceptable |

**Default:** PL1 enabled. PL2+ require explicit activation.

#### Anomaly Score (OWASP)

The OWASP ruleset uses a **scoring model** rather than immediate blocking:
- Each rule match adds an anomaly score value to the request
- Default threshold: 5 points → trigger block
- Higher paranoia = more rules = faster score accumulation

**Score contributions (examples):**
- SQL keyword in query parameter: +5 points
- XSS pattern: +5 points
- Path traversal: +5 points
- Multiple suspicious patterns: scores add up

```bash
# Configure OWASP anomaly threshold
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/{ruleset_id}/rules/{rule_id}" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action_parameters": {
      "overrides": {
        "action": "block",
        "score_threshold": 10
      }
    }
  }'
```

#### Rule Overrides — Disabling and Modifying Specific Rules

When a managed rule causes false positives, you have options:
1. **Disable the rule entirely** (not recommended — reduces protection)
2. **Override the action** (e.g., change Block to Log for a specific rule)
3. **Add an exception** (skip rule for specific requests — recommended)

**Disable a specific rule via API:**
```bash
# Get managed ruleset ID first
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_managed/entrypoint" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -m json.tool

# Override rule 100014 to Log instead of Block
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/{managed_ruleset_id}" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "rules": [{
      "id": "rule_id_of_the_deploy_rule",
      "action": "execute",
      "action_parameters": {
        "id": "efb7b8c949ac4650a09736fc376e9aee",
        "overrides": {
          "rules": [{
            "id": "100014",
            "action": "log",
            "enabled": true
          }]
        }
      }
    }]
  }'
```

**Add a WAF exception (recommended over disabling rules):**
```json
{
  "action": "skip",
  "action_parameters": {
    "rules": {
      "efb7b8c949ac4650a09736fc376e9aee": ["100014"]
    }
  },
  "expression": "http.request.uri.path eq \"/api/search\" and http.request.method eq \"GET\"",
  "description": "Skip SQLi rule 100014 for known-safe search endpoint"
}
```

#### Rule Tags

Managed rules are tagged by category, allowing bulk enable/disable:
- `sqli` — SQL injection rules
- `xss` — Cross-site scripting rules
- `rce` — Remote code execution rules
- `lfi` — Local file inclusion rules
- `rfi` — Remote file inclusion rules
- `csrf` — Cross-site request forgery rules
- `dos` — Denial of service rules
- `scanner` — Scanner and probe detection rules
- `wordpress` — WordPress-specific rules
- `joomla` — Joomla-specific rules
- `drupal` — Drupal-specific rules

### Bot Management

Bot Management is Cloudflare's advanced bot mitigation product (Enterprise/add-on feature). It is distinct from the simpler "Bot Fight Mode" available on lower plans.

#### Bot Score (1–99)

Every request receives a **bot score** from 1 to 99:
- **1 = definitely a bot** — automated traffic with high confidence
- **30 = likely automated** — suspicious signals
- **50 = uncertain** — could be human or bot
- **80 = likely human** — browser characteristics indicate human
- **99 = definitely human** — very high confidence human visitor

**How the score is calculated:**
- TLS fingerprint (JA3 hash) — browser TLS behavior patterns
- HTTP/2 fingerprint — how the HTTP connection is opened
- Browser behavior (JavaScript execution, timing, interaction patterns)
- IP reputation
- Historical traffic patterns
- Matching against known bot fingerprints

#### cf.bot_management Fields

```
cf.bot_management.score              # 1-99 bot score
cf.bot_management.verified_bot       # Boolean — Googlebot, Bingbot, etc.
cf.bot_management.ja3_hash           # TLS fingerprint (JA3)
cf.bot_management.js_detection.passed # Did the JS detection check pass?
cf.bot_management.detection_ids      # Which bot detection signals fired
cf.bot_management.decision           # Bot management decision (ALLOW/BLOCK/CHALLENGE)
cf.bot_management.score_src          # Source of the bot score (model, heuristic, etc.)
```

#### Bot Score Usage in Rules

```json
{
  "action": "managed_challenge",
  "expression": "cf.bot_management.score lt 30 and not cf.bot_management.verified_bot",
  "description": "Challenge likely bots (score < 30) that aren't verified crawlers"
}
```

```json
{
  "action": "block",
  "expression": "cf.bot_management.score lt 10",
  "description": "Block definite bots (score < 10)"
}
```

```json
{
  "action": "skip",
  "action_parameters": {"ruleset": "current"},
  "expression": "cf.bot_management.verified_bot eq true",
  "description": "Allow verified bots (Googlebot, etc.) through"
}
```

### IP Lists

Cloudflare allows you to create and manage lists of IPs that can be referenced in rule expressions. This is much more efficient than hardcoding IPs in rule expressions.

**List types:**
- **IP list** — Individual IPv4/IPv6 addresses and CIDR ranges
- **Redirect list** — URL pairs for bulk redirects
- **ASN list** — Autonomous System Numbers
- **Hostname list** — Hostnames

**Creating and using an IP list:**
```bash
# Create an IP list at the account level
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/{account_id}/rules/lists" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "trusted_monitoring_ips",
    "description": "Monitoring and security scanning IPs to allow",
    "kind": "ip"
  }'

# Add IPs to the list (replace LIST_ID with the returned ID)
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/{account_id}/rules/lists/{list_id}/items" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[
    {"ip": "10.0.0.0/8", "comment": "Internal network"},
    {"ip": "192.168.1.100", "comment": "Monitoring server"},
    {"ip": "203.0.113.0/24", "comment": "Partner network"}
  ]'
```

**Using the list in a rule expression:**
```
ip.src in $trusted_monitoring_ips
```

Note: List references use the `$` prefix followed by the list name.

---

## Deep Dive (Architect-Level)

### Ruleset Engine Phases — Full Reference

The Cloudflare Ruleset Engine processes requests through phases in this order:

```
Phase: ddos_l7                    # DDoS L7 mitigation (automatic)
Phase: http_config_settings       # Config rules (response headers, etc.)
Phase: http_request_sbfm          # Super Bot Fight Mode (bot detection)
Phase: http_request_firewall_pre  # Custom Rules (before managed rules)
Phase: http_request_ratelimit     # Rate Limiting
Phase: http_request_firewall_managed  # Managed WAF Rules
Phase: http_request_late          # Rules that run after routing
Phase: http_response_headers_transform  # Response header transformation
Phase: http_response_firewall_managed   # Response-phase rules
```

**Phase entrypoints** — each phase has a "zone entrypoint" — the ruleset attached to that zone for that phase. When you create a custom rule, it's added to the entrypoint for `http_request_firewall_custom`.

### Ruleset API — Full CRUD Operations

```bash
# List all rulesets for a zone
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -m json.tool

# Get a specific ruleset (e.g., custom rules entrypoint)
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -m json.tool

# Create a complete custom rules entrypoint with multiple rules
curl -X PUT \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "rules": [
      {
        "action": "skip",
        "action_parameters": {"ruleset": "current"},
        "expression": "ip.src in {203.0.113.0/24} and http.request.headers[\"x-monitoring-key\"] eq \"secret123\"",
        "description": "Skip all rules for monitoring IPs with valid header",
        "enabled": true
      },
      {
        "action": "block",
        "expression": "ip.geoip.country in {\"CN\" \"RU\" \"KP\"} and http.request.method eq \"POST\" and not http.request.uri.path contains \"/public/\"",
        "description": "Block POST requests from high-risk countries to non-public paths",
        "enabled": true
      },
      {
        "action": "managed_challenge",
        "expression": "cf.threat_score gt 30",
        "description": "Challenge high threat-score IPs",
        "enabled": true
      }
    ]
  }'
```

### JA3 TLS Fingerprinting

JA3 is a method to fingerprint TLS clients based on the TLS ClientHello message. Unlike user-agent strings (easily faked), JA3 fingerprints are harder to spoof without also changing the underlying TLS stack.

**JA3 components:**
- TLS version
- Cipher suites (listed in order)
- Extension types (listed in order)
- Elliptic curves
- Elliptic curve point formats

These values are concatenated and MD5-hashed to produce the JA3 hash.

**In Cloudflare:**
```
cf.bot_management.ja3_hash    # The JA3 hash of the TLS connection
```

**Use case:** A bot that fakes a Chrome User-Agent but uses a Python Requests TLS fingerprint will show:
- `http.user_agent` = Chrome
- `cf.bot_management.ja3_hash` = known Python Requests JA3 hash

This mismatch is a strong bot signal.

### Rate Limiting — Counting Algorithm

Cloudflare rate limiting uses a **sliding window** algorithm:

1. Each request increments a counter keyed by {characteristic} + {time bucket}
2. Counter is stored in Cloudflare's distributed KV system
3. The counter for the current window + the counter for the previous window (weighted by overlap) = effective count
4. If effective count exceeds threshold → mitigation action fires

**Example with 10 req/min limit:**
```
Time: 12:00:50 (50s into the minute)
Previous window (12:00:00-12:01:00) had 8 requests
Current window (12:01:00-12:02:00) has 3 requests so far

Overlap: 10 seconds into current window = 10/60 = 16.7% into window
Effective count = 3 + (8 × (1 - 0.167)) = 3 + 6.67 = 9.67 ≈ 10

Result: THRESHOLD MET → mitigation fires
```

This prevents the "bursting through window boundaries" attack that fixed-window algorithms are vulnerable to.

### WAF Bypass Techniques (Know What You're Defending Against)

Understanding bypass techniques helps you explain why managed rules aren't sufficient alone:

**Encoding bypasses:**
- URL encoding: `%27` = `'` (single quote for SQLi)
- Double URL encoding: `%2527` = `%27` = `'`
- HTML entities: `&#39;` = `'`
- Base64 encoding of payloads

**Case variation:**
- `SeLeCt` instead of `SELECT`
- `<ScRiPt>` instead of `<script>`

**Comment injection:**
- `SE/**/LECT` — MySQL/MariaDB comment to break up keywords
- `SE--\nLECT` — Line comment bypass

**Cloudflare's defense:** The managed ruleset uses normalization (URL decode, HTML decode, case normalization) before pattern matching. This defeats most simple encoding bypasses.

### Testing Rules Safely — The Log Mode Pattern

**Golden rule:** Always deploy new rules in Log mode first.

Process:
1. Create rule with `"action": "log"`
2. Wait 24–72 hours to capture traffic patterns
3. Review Security Events for this rule: look for false positives
4. Identify any legitimate traffic that would be affected
5. Add exceptions for legitimate traffic patterns
6. Change action to `"block"` or `"challenge"`

**Monitoring during rollout:**
```bash
# Watch for rule matches in real-time (via GraphQL, 1-min aggregation)
while true; do
  curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"query":"{ viewer { zones(filter: { zoneTag: \"'${ZONE_ID}'\" }) { firewallEventsAdaptiveGroups(filter: { datetime_geq: \"'$(date -u -v-5M +%Y-%m-%dT%H:%M:%SZ)'\" }, limit: 5, orderBy: [count_DESC]) { count dimensions { ruleId action } } } } }"}' \
    | python3 -c "import sys,json; data=json.load(sys.stdin); [print(g['count'], g['dimensions']['ruleId'], g['dimensions']['action']) for zone in data['result']['data']['viewer']['zones'] for g in zone.get('firewallEventsAdaptiveGroups',[])]"
  sleep 60
done
```

---

## Dashboard Walkthrough

### Navigating to Security Rules

1. dash.cloudflare.com → macksportreport.com → Security → **Security Rules** (or "WAF" depending on UI version)
2. Four tabs: **Custom Rules**, **Rate Limiting Rules**, **Managed Rules**, **Tools**

### Custom Rules Tab

**Creating a new Custom Rule:**
1. Click **Create rule**
2. Rule Builder appears with two modes:
   - **Expression Builder (Visual):** Dropdown selectors for field, operator, value
   - **Expression Editor (Text):** Direct expression syntax input

**Expression Builder:**
- Click **+ And** or **+ Or** to add conditions
- Select field from dropdown (All fields listed alphabetically)
- Select operator
- Enter value
- Click **Deploy** when ready

**Rule Actions in UI:**
- Action dropdown at bottom of rule form
- "Block" shows sub-options: HTTP status code, custom response
- "Skip" shows sub-options: which rulesets/rules to skip

**Rule ordering:**
- Rules listed in order (top = evaluated first)
- Drag the ≡ handle on the left to reorder
- "Enabled/Disabled" toggle on right of each rule row

### Rate Limiting Rules Tab

**Creating a Rate Limiting Rule:**
1. Click **Create rule**
2. Fill in:
   - **Name:** Human-readable description
   - **When incoming requests match:** Expression (same syntax as custom rules)
   - **Requests:** Threshold number
   - **Period:** Time window (10s/1m/2m/5m/10m/1h)
   - **With the same:** Characteristic(s) — IP, header value, cookie value
   - **Then take action:** Block/Challenge/Log
   - **For duration:** How long to apply mitigation

### Managed Rules Tab

**Enabling/Configuring Managed Rules:**
1. Find "Cloudflare Managed Ruleset" row → click **Edit**
2. Toggle the ruleset On/Off
3. For OWASP: select Paranoia Level and Anomaly Score Threshold

**Overriding a specific rule:**
1. Click the ruleset → **Edit**
2. Search for rule by ID or keyword
3. Click the rule → toggle action from "Default" to "Log" or "Disabled"

**Adding exceptions (recommended over disabling):**
1. Click **Add exception** button
2. Define: expression that identifies the legitimate traffic
3. Select which rules to skip for matching requests
4. Save

### Tools Tab

- **IP Access Rules:** Quick legacy IP block/allow/challenge tool (predates custom rules)
- **User Agent Blocking:** Block specific user agent strings (legacy tool)
- **Zone Lockdown:** Restrict zone access to specific IPs only

---

## Hands-On Lab

### Lab 4.1 — Create a Custom Block Rule for a Specific Path

```bash
# Create a rule that blocks access to /admin from non-US IPs
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint/rules" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "log",
    "expression": "http.request.uri.path starts_with \"/admin\" and not ip.geoip.country eq \"US\"",
    "description": "Lab 4.1 - Log non-US access to admin (log mode for testing)",
    "enabled": true
  }'

# Test the rule from your current location
curl -v "https://macksportreport.com/admin" 2>&1 | grep -E "(< HTTP|403|200)"

# Then check Security Events to see if your request was logged
```

### Lab 4.2 — Create a Rate Limiting Rule

```bash
# Create a rate limit: 5 requests per minute per IP to /login
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint/rules" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "block",
    "ratelimit": {
      "characteristics": ["ip.src"],
      "period": 60,
      "requests_per_period": 5,
      "mitigation_timeout": 300
    },
    "expression": "http.request.method eq \"POST\" and http.request.uri.path eq \"/login\"",
    "description": "Lab 4.2 - Brute force protection for login",
    "enabled": true
  }'

# Test it — send 6 POST requests to /login
for i in {1..7}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "https://macksportreport.com/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=test&password=test123")
  echo "Request $i: HTTP $STATUS"
  sleep 0.5
done
# After the 5th request within 60 seconds, you should see 429
```

### Lab 4.3 — Enable and Configure Managed Rules

```bash
# Get the managed ruleset ID for your zone
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_managed/entrypoint" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -m json.tool

# Test a SQLi attack pattern (should be caught by managed rules)
# Use a harmless but recognizable SQLi pattern
curl -v "https://macksportreport.com/?id=1'+OR+'1'='1" 2>&1 | grep "HTTP/"

# Check the Security Events to see which rule fired
```

### Lab 4.4 — Create an IP Allowlist

```bash
# Create an account-level IP list
ACCOUNT_ID="your_account_id"

curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/rules/lists" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "lab_trusted_ips",
    "description": "Lab 4.4 - Trusted IP allowlist",
    "kind": "ip"
  }'

# Get your current IP and add it to the list
MY_IP=$(curl -s https://api.ipify.org)
LIST_ID="returned_list_id_here"

curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/rules/lists/${LIST_ID}/items" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "[{\"ip\": \"${MY_IP}\", \"comment\": \"My development machine\"}]"

# Create a custom rule that skips all security rules for this IP
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint/rules" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "skip",
    "action_parameters": {
      "ruleset": "current"
    },
    "expression": "ip.src in $lab_trusted_ips",
    "description": "Lab 4.4 - Skip rules for trusted IPs",
    "enabled": true,
    "position": {"before": "first"}
  }'
```

### Lab 4.5 — Bot Score Rule (If Bot Management Enabled)

```bash
# Check if Bot Management is enabled on the zone
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/bot_management" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -m json.tool

# If Bot Management is enabled, create a rule based on bot score
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint/rules" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "log",
    "expression": "cf.bot_management.score lt 30 and not cf.bot_management.verified_bot",
    "description": "Lab 4.5 - Log likely bots (bot score < 30)",
    "enabled": true
  }'
```

### Lab 4.6 — Clean Up All Lab Rules

```bash
# List all custom rules to find lab rule IDs
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
rules = data.get('result', {}).get('rules', [])
for r in rules:
    print(f'ID: {r[\"id\"]} | Desc: {r.get(\"description\", \"\")} | Action: {r[\"action\"]}')
"

# Delete each lab rule by ID (replace RULE_IDs with actual IDs)
# Note: Use the ruleset ID from the GET request above
RULESET_ID="your_ruleset_id"
for RULE_ID in "rule_id_1" "rule_id_2" "rule_id_3"; do
  curl -X DELETE \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules/${RULE_ID}" \
    -H "Authorization: Bearer ${CF_TOKEN}"
  echo "Deleted rule: ${RULE_ID}"
done
```

---

## Demo Script (2 Minutes)

**Opening (15 seconds):**
"Let me show you how Cloudflare's security rules work — this is the core of how you control who can access what on your site."

**Custom Rules (40 seconds):**
"Custom rules are your own logic. This expression language is similar to Wireshark — you can combine any combination of fields. Right now I've written a rule that blocks any POST request to /admin from outside the US, for any IP with a threat score above 20. [Show rule in UI] This deploys globally to 330 data centers in seconds. No DevOps. No infrastructure changes."

**Rate Limiting (30 seconds):**
"Rate limiting is how you stop brute force. This rule says: if any single IP sends more than 5 POST requests to /login within 60 seconds, block them for 5 minutes. Credential stuffing attacks typically run thousands of attempts. This stops them after the 5th attempt per IP per minute, automatically."

**Managed Rules (35 seconds):**
"Managed Rules are what most people mean when they say 'WAF.' Cloudflare's security team maintains a ruleset of attack signatures — SQL injection, XSS, path traversal, remote code execution. When I turn this on, I get protection against the OWASP Top 10 without writing any code. And when a new attack vector emerges — like log4shell or Spring4Shell — Cloudflare updates the ruleset and your site is protected within hours, automatically."

---

## Competitive Context

| Feature | Cloudflare | AWS WAF | Akamai Kona SiteDefender | Imperva |
|---------|-----------|---------|--------------------------|---------|
| **Rule expression language** | Full fields library, Wireshark-style | Limited conditions | Complex policy editor | GUI + expressions |
| **Managed rulesets** | CF Managed + OWASP CRS, auto-updated | AWS Managed Rules (paid per rule) | Kona rules, auto-updated | Imperva rules |
| **Rate limiting characteristics** | IP, header, cookie, path, ASN | IP only (basic), advanced costs more | IP, header, cookie | IP, session |
| **Bot score (ML-based)** | Yes (1-99 score, Bot Management) | Requires AWS WAF Bot Control (add-on) | Bot Manager (add-on) | Advanced Bot Protection (add-on) |
| **JA3 TLS fingerprinting** | Yes (cf.bot_management.ja3_hash) | No | Yes | Yes (Enterprise) |
| **Rule deployment speed** | Seconds globally | Minutes (CloudFront propagation) | Minutes | Minutes |
| **IP list management** | Account-level lists, bulk upload | IP Sets (limited size) | Network lists | Complex |
| **Custom block page** | Yes, per-rule | Yes, via custom responses | Yes, complex | Yes |
| **Log mode (testing)** | Yes, native action | Manual workaround needed | Yes | Yes |
| **API management** | Full CRUD via REST API | Full via CloudFormation/API | API available | API available |
| **Pricing model** | Included in Pro+ / Enterprise add-on | Per-rule per-million-requests | Enterprise contract | Enterprise contract |
| **Free WAF tier** | Yes (Cloudflare Free Managed Ruleset) | No | No | No |
| **OWASP paranoia levels** | Yes (1-4) | No equivalent | Yes (via policy) | Yes |

---

## Self-Check Questions

**Question 1:** A customer has a legitimate application that sends POST requests with raw SQL in the body (it's a database administration tool, not an attack). The Cloudflare Managed Ruleset is blocking it. What is the correct way to handle this false positive without disabling the SQLi rules globally?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 2:** Explain the difference between the `Skip` action and the `Allow` action. In what scenario would the wrong choice between them create a security vulnerability?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 3:** A customer's login page is being credential-stuffed. Each attacking IP sends exactly 3 login attempts and then rotates to a new IP. Their IP pool appears to be a large residential proxy network. Standard IP-based rate limiting at 5 req/min is not effective. What alternative rate limiting strategies could you implement?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 4:** What is the OWASP anomaly score threshold, and why would you increase it from the default of 5? What is the trade-off?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 5:** A customer wants to block all traffic from China except for their Chinese CDN partner's IP range (203.0.113.0/24). Write the exact Cloudflare expression to implement this using an IP list.

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

---

## Sources

- [Custom Rules Documentation](https://developers.cloudflare.com/waf/custom-rules/)
- [Rate Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Managed Rules (WAF)](https://developers.cloudflare.com/waf/managed-rules/)
- [WAF Ruleset Engine](https://developers.cloudflare.com/ruleset-engine/)
- [Rules Language — Fields Reference](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/)
- [Rules Language — Operators](https://developers.cloudflare.com/ruleset-engine/rules-language/operators/)
- [Bot Management](https://developers.cloudflare.com/bots/plans/bm-subscription/)
- [Bot Management Fields](https://developers.cloudflare.com/bots/reference/bot-management-variables/)
- [JA3 Fingerprinting](https://developers.cloudflare.com/bots/concepts/ja3-fingerprint/)
- [IP Lists](https://developers.cloudflare.com/waf/tools/lists/)
- [Ruleset API](https://developers.cloudflare.com/api/operations/zone-rulesets-list-a-zone-s-rulesets)
- [WAF Exceptions](https://developers.cloudflare.com/waf/managed-rules/waf-exceptions/)
- [OWASP ModSecurity Core Rule Set](https://coreruleset.org/)
- [Rule Phases](https://developers.cloudflare.com/ruleset-engine/reference/phases-list/)
