# Module 3.3 — Web Assets & Content Scanning
> Dashboard Location: macksportreport.com → Security → Web Assets | Estimated Time: 75 minutes | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Are "Web Assets" in the Cloudflare Context?

In Cloudflare's security model, "web assets" refers to the dynamic content flowing through your web application — specifically form submissions, file uploads, and user-generated content that enters your system via HTTP requests. This is distinct from static assets (images, JS, CSS) which are primarily a performance/caching concern.

The Security → Web Assets section contains two related but distinct capabilities:

1. **Exposed Credentials Check** — Detects when users submit login credentials that appear in known data breach databases
2. **Content Scanning** — Analyzes uploaded files and content in HTTP request bodies for malware signatures

Both capabilities operate at the **Cloudflare edge**, meaning the scanning happens before the content ever reaches your origin server. This is a significant architectural advantage: you can reject malicious content at the network level, before it touches your application code, your database, or your file storage.

### Exposed Credentials Check

#### What Problem Does It Solve?

**Credential stuffing** is one of the most common attack vectors facing web applications today. The attack pattern is:
1. Attacker obtains a list of username/password combinations from a previous data breach
2. Attacker runs automated login attempts against your application using those credentials
3. Users who reused passwords from the breached service have their accounts compromised on your site

The credential stuffing attack works because:
- 65% of people reuse passwords across sites (LastPass survey data)
- Data breach dumps are freely available on dark web markets
- Breached credential lists contain billions of username/password pairs
- Attacks can be distributed across millions of IPs, bypassing rate limiting

#### How Exposed Credentials Check Works

Cloudflare's Exposed Credentials Check intercepts login form POST requests and checks whether the submitted username/password combination appears in a known breach database:

1. **HTTP POST interception:** The rule engine identifies login form submissions (POST to /login, /auth, /sign-in, etc.)
2. **Credential extraction:** Cloudflare extracts the username and password fields from the POST body
3. **k-anonymity lookup:** The credentials are hashed and a **partial hash** is sent to Cloudflare's lookup service
   - Full credentials are never sent in plaintext — only the first few bytes of the hash
   - This is the same k-anonymity model used by HaveIBeenPwned's HIBP API
4. **Database comparison:** The hash prefix is compared against Cloudflare's breach database
5. **Rule match if compromised:** If the full hash matches a known breached credential pair, the WAF rule fires

#### The k-Anonymity Approach — Why It Matters

The privacy-preserving aspect of this check is worth explaining to security-conscious customers.

Traditional approach (bad):
- Send username + password to a third-party checking service
- Third party now knows your users' credentials

k-Anonymity approach (Cloudflare's method):
1. Hash the password: `SHA1("hunter2") = ABCDE12345FGHIJ...`
2. Send only the first 5 characters of the hash to the lookup service: `ABCDE`
3. Service returns all hashes starting with `ABCDE` (could be thousands)
4. Client checks locally if the full hash is in the returned list
5. The lookup service never sees the full hash — just the prefix

This means Cloudflare can check credentials without ever knowing what those credentials are.

#### Have I Been Pwned (HIBP) Dataset

Cloudflare's exposure database is derived from, and augmented beyond, the Have I Been Pwned (HIBP) dataset maintained by Troy Hunt:

- **Scale:** 14+ billion breached account records
- **Sources:** LinkedIn (2012), Adobe (2013), Yahoo (2016), Collection #1–5 (2019), and hundreds of smaller breaches
- **Format:** SHA-1 hashes of passwords; bcrypt hashes in some cases
- **Update frequency:** Cloudflare updates the database as new breaches are disclosed

The NIST SP 800-63B digital identity guideline (Section 5.1.1) specifically recommends:
> "Memorized secrets SHALL be compared against a list that contains values known to be commonly-used, expected, or compromised."

Cloudflare's Exposed Credentials Check is an implementation of this NIST recommendation.

#### What Happens When Compromised Credentials Are Detected?

When the Exposed Credentials Check fires, you have two options:

**Option 1: Block** — Prevent the login attempt entirely and return an error to the user
- Pros: Stops account takeover immediately
- Cons: May frustrate legitimate users who happen to reuse a breached password but haven't been compromised yet

**Option 2: Log** — Allow the request but log it for investigation
- Pros: Doesn't impact UX; lets your application handle the response
- Cons: If an attacker has the right password, they still get in

**Recommended approach:** Log first, integrate with your application to force password resets for flagged accounts, then optionally block after you have application-level handling.

The event is logged with:
- `cf.credentials_compromised`: boolean field in WAF
- Rule source: `exposed-credentials-check`
- Action taken: whatever your rule specifies (log, block, etc.)

### Content Scanning

#### What Problem Does It Solve?

File upload attacks are a critical vector for:
- **Malware distribution:** Users upload infected files that get served to other users
- **Webshell uploads:** Attackers upload PHP/ASP webshells disguised as images
- **RCE via malicious files:** PDF exploits, malformed images, Office macros
- **Data exfiltration:** Oversized file uploads used to probe for input validation weaknesses

Traditional defenses happen at the application layer (AV scanning on the server). Cloudflare Content Scanning moves this to the edge:
- Analyzes `multipart/form-data` uploads
- Scans `application/octet-stream` request bodies
- Detects malware signatures before content reaches origin

#### How Content Scanning Works

1. **Request interception:** Cloudflare identifies HTTP requests containing file upload content types
2. **Content extraction:** The uploaded file content is extracted from the multipart body
3. **Signature matching:** Content is analyzed against a malware signature database
4. **MIME type validation:** Actual file magic bytes are checked against the claimed Content-Type
5. **Rule action:** If malware is detected, your configured action fires (block, log, etc.)

#### Content Scanning Detection Capabilities

- **Malware signatures:** Known virus/malware signatures (similar to ClamAV ruleset)
- **MIME type mismatches:** File claiming to be a JPEG but containing PHP code
- **Malicious archives:** ZIP/RAR files containing malware
- **Office macros:** Excel/Word files with suspicious macros
- **Webshell patterns:** Common PHP/ASP webshell signatures
- **Exploit files:** PDFs or images crafted to exploit parser vulnerabilities

#### What Content Scanning Does NOT Do

Be transparent with customers about limitations:
- Does not decrypt encrypted archives (password-protected ZIPs)
- Does not execute files to detect zero-day polymorphic malware (static analysis only)
- Has a file size limit — very large files may be skipped
- Does not scan request body content that is not multipart/form-data encoded
- Is not a replacement for server-side AV scanning (defense in depth, not single defense)

### Enabling and Configuring Both Features

Both Exposed Credentials Check and Content Scanning are configured through:
1. Dashboard: Security → Web Assets
2. API: Custom rules referencing `cf.credential_exposure` and content scanning fields

**Plan availability:**
- Exposed Credentials Check: Enterprise plan (or add-on)
- Content Scanning: Enterprise plan (or add-on)

---

## Deep Dive (Architect-Level)

### Technical Architecture of Exposed Credentials Check

The implementation uses the **Password Verification API** pattern described in NIST 800-63B Appendix A:

```
Request arrives at CF Edge PoP
    ↓
WAF Phase: http_request_firewall_custom evaluates
    ↓
Rule with "check_exposed_credentials" action fires
    ↓
Credential extractor reads POST body:
  - Parses application/x-www-form-urlencoded
  - Parses application/json (configurable field mapping)
  - Parses multipart/form-data
    ↓
Hash computation: HMAC-SHA1(username + ":" + password)
    ↓
k-Anonymity lookup to CF internal HIPB service (5-char prefix)
    ↓
Returned: list of matching hashes
    ↓
Local comparison: is the full hash in the list?
    ↓
Sets: cf.credentials_compromised = true/false
    ↓
Rule action applied (block/log based on your config)
```

### Custom Rule Expression for Exposed Credentials

The Exposed Credentials Check is implemented as part of a WAF custom rule. The expression identifies the login endpoint, and a special check action enables the credential lookup:

```json
{
  "action": "log",
  "action_parameters": {
    "check_exposed_credentials": true
  },
  "expression": "http.request.method eq \"POST\" and http.request.uri.path eq \"/login\"",
  "description": "Check exposed credentials on login endpoint",
  "enabled": true
}
```

Then a second rule can block if credentials are compromised:
```json
{
  "action": "block",
  "expression": "cf.credentials_compromised eq true",
  "description": "Block requests with compromised credentials",
  "enabled": true
}
```

**Available fields after check:**
- `cf.credentials_compromised` — boolean, true if credentials found in breach database

### Field Extraction Configuration

Cloudflare needs to know which POST body fields contain the username and password. This is configurable per-rule:

**Default field names (auto-detected):**
- Username: `username`, `email`, `user`, `login`, `identifier`
- Password: `password`, `pass`, `passwd`, `pwd`, `secret`

**Custom field names** (for non-standard forms):
You can specify custom field mappings via the API when creating the exposed credentials check rule.

### Content Scanning — Technical Implementation

```
POST /upload HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="file"; filename="report.pdf"
Content-Type: application/pdf

[File bytes]
------WebKitFormBoundary--
```

When this request arrives:
1. CF edge detects `multipart/form-data` Content-Type
2. Content Scanning module extracts file parts
3. File bytes are analyzed:
   - Magic bytes (first 16 bytes) checked to identify actual file type
   - File content scanned against signature database
   - File size checked against configured limits
4. Result stored in `cf.scan.malware.detected` (boolean)
5. WAF rule referencing this field fires

**WAF rule for content scanning:**
```json
{
  "action": "block",
  "expression": "cf.scan.malware.detected eq true",
  "description": "Block malware in file uploads",
  "enabled": true
}
```

### Content Scanning API Configuration

```bash
# Enable Content Scanning for a zone
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/content-upload-scan/enable" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json"

# Check content scanning status
curl -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/content-upload-scan/settings" \
  -H "Authorization: Bearer ${CF_TOKEN}"

# Add a custom scanning expression
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/content-upload-scan/payloads" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "payload": "lookup_json_string(http.request.body.raw, \"file_content\")"
  }'
```

### Alert Configuration for Compromised Credentials

Set up email/PagerDuty/webhook alerts when compromised credentials are detected:

```bash
# Create a notification policy for exposed credentials
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/{account_id}/alerting/v3/policies" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Compromised Credentials Alert",
    "description": "Alert when users submit compromised credentials",
    "enabled": true,
    "alert_type": "exposed_credential_check_alert",
    "mechanisms": {
      "email": [{"id": "your-email-destination-id"}]
    },
    "filters": {
      "zones": ["'${ZONE_ID}'"]
    }
  }'
```

### False Positive Management

**For Exposed Credentials Check:**
False positives occur when a legitimate user's password is in the breach database (they haven't changed it yet) and gets blocked.

Best practice:
1. Run in **Log mode** initially for 2–4 weeks
2. Review frequency of credential exposure events
3. Integrate with your identity system to force password resets programmatically
4. Consider: Block mode only after application-level handling is in place

**For Content Scanning:**
False positives can occur for:
- Password-protected ZIP files (encrypted content looks suspicious)
- Binary files with byte patterns resembling signatures
- Custom application formats

To exclude specific upload paths:
```json
{
  "action": "skip",
  "action_parameters": {
    "ruleset": "current"
  },
  "expression": "http.request.uri.path eq \"/internal-upload-endpoint\"",
  "description": "Skip content scanning for internal trusted path"
}
```

---

## Dashboard Walkthrough

### Navigating to Web Assets

1. dash.cloudflare.com → macksportreport.com → Security → **Web Assets**
2. You'll see two sections: **Exposed Credentials** and **Content Scanning**

### Exposed Credentials Check Setup

1. Under "Exposed Credentials Check," click **Enable**
2. You'll be prompted to:
   - Select the HTTP method (POST)
   - Enter the login path (e.g., `/login`, `/auth/signin`)
   - Map username field name (default: `username` or `email`)
   - Map password field name (default: `password`)
   - Select action: Log, Block, or Challenge
3. Click **Deploy**

A WAF rule is automatically created in your custom rules.

### Viewing Exposed Credentials Events

After enabling:
- Security → Security Events
- Filter by: Source = "exposed-credentials-check"
- Each event shows: timestamp, IP, username attempted (truncated/hashed), action taken

### Content Scanning Setup

1. Under "Content Scanning," click **Enable**
2. Cloudflare auto-detects upload paths, OR you can specify:
   - Target paths (e.g., `/upload`, `/api/documents`)
   - Content types to scan (defaults cover multipart/form-data)
3. Select action: Log or Block
4. Click **Deploy**

### Viewing Content Scan Events

- Security → Security Events
- Filter by: Rule message contains "malware" or "content scan"
- Event details include: filename, detected malware signature name, file type

---

## Hands-On Lab

### Lab 3.1 — Test the HIBP k-Anonymity Approach Directly

Understand how the underlying breach check works by querying the HIBP API directly:

```bash
# Hash a test password using SHA-1
echo -n "password123" | openssl dgst -sha1 | awk '{print $2}' | tr '[:lower:]' '[:upper:]'
# Example output: CBFDAC6008F9CAB4083784CBD1874F76618D2A97

# Extract first 5 characters (k-anonymity prefix)
HASH="CBFDAC6008F9CAB4083784CBD1874F76618D2A97"
PREFIX="${HASH:0:5}"
echo "Prefix: $PREFIX"

# Query HIBP API with just the prefix (privacy-preserving)
curl -s "https://api.pwnedpasswords.com/range/${PREFIX}" | grep "${HASH:5}"
# If the hash appears in the response, this password is compromised
# Format: <SUFFIX>:<count>  where count = number of times seen in breaches
```

### Lab 3.2 — Check Exposed Credentials Feature Status

```bash
# Check if exposed credentials check is configured in custom rules
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" | python3 -m json.tool | grep -A5 "credentials"
```

### Lab 3.3 — Check Content Scanning Status

```bash
# Check content scanning settings
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/content-upload-scan/settings" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" | python3 -m json.tool
```

### Lab 3.4 — Review NIST 800-63B Requirements

Read Section 5.1.1 of NIST SP 800-63B:
```bash
# Fetch the NIST document summary (no NIST API — browser only)
# Key requirement text:
echo "NIST SP 800-63B Section 5.1.1.2 requirement:"
echo "When processing requests to establish and change memorized secrets:"
echo "Verifiers SHALL compare the prospective secrets against a list that contains"
echo "values known to be commonly-used, expected, or compromised."
echo ""
echo "Cloudflare's Exposed Credentials Check satisfies this requirement at the edge."
```

### Lab 3.5 — Create a Simulated Exposed Credentials Check Rule (Log Mode)

```bash
# Create a rule in LOG mode to simulate exposed credentials check
# This creates the rule structure without blocking real traffic
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint/rules" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "log",
    "expression": "http.request.method eq \"POST\" and http.request.uri.path contains \"/login\"",
    "description": "Lab 3.5 - Simulate exposed creds check (log mode)",
    "enabled": true
  }'

# Verify the rule was created
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" | python3 -m json.tool

# Clean up: delete the test rule (replace with actual IDs from above)
echo "Remember to clean up the test rule!"
```

---

## Demo Script (2 Minutes)

**Opening (20 seconds):**
"One of the most devastating attack types against web apps is credential stuffing — attackers taking passwords from the LinkedIn breach or the Adobe breach and trying them on your login page. Your app looks fine in the logs, but user accounts are getting taken over. We stop this at the edge."

**Exposed Credentials Explanation (40 seconds):**
"Cloudflare sits in front of every login request. When a username and password are submitted, we run a privacy-preserving check — we never see the actual credentials — against a database of 14 billion breached credential pairs. If it's a known-compromised combination, we can block the login attempt before it even gets to your server. [Show Security → Web Assets → Exposed Credentials] This is the NIST 800-63B standard for compromised credential detection, implemented at the network level."

**Content Scanning (30 seconds):**
"On the uploads side — if someone tries to upload a malware-infected PDF or a webshell disguised as an image, Content Scanning catches it at the edge. The file bytes are scanned before they reach your origin, before they hit your application code, before they touch your file storage. Webshell uploads are one of the top ways attackers gain persistent access to web servers."

**Close (30 seconds):**
"The key insight here is that both of these checks happen at our edge network — globally, at 330+ data centers, before anything reaches your servers. You don't need to add scanning libraries to your application code, you don't need to provision scanning infrastructure. You flip a toggle and it works."

---

## Competitive Context

| Feature | Cloudflare | AWS WAF | Imperva | Akamai |
|---------|-----------|---------|---------|--------|
| **Exposed Credentials Check** | Yes — edge-based, HIBP dataset, k-anonymity | No built-in equivalent | Account Takeover Protection (add-on) | Credential Abuse Prevention (add-on) |
| **Breach database size** | 14B+ records (HIBP + CF intel) | N/A | Varies | Varies |
| **k-Anonymity (privacy)** | Yes, hash prefix model | N/A | Unknown | Unknown |
| **NIST 800-63B compliance** | Yes | No (must build manually) | Partial | Partial |
| **File upload malware scanning** | Yes, edge-based | Must integrate AWS Macie or 3rd-party | Yes (add-on) | Yes (add-on) |
| **False positive management** | Log mode → gradual rollout | N/A | Manual whitelisting | Complex policy editor |
| **Deployment complexity** | Toggle in dashboard | Requires WAF + Lambda + DynamoDB custom build | Complex setup | Complex setup |
| **Alert integration** | Built-in notification policies | CloudWatch → SNS | Email/SIEM | Proprietary |
| **Plan availability** | Enterprise / add-on | Enterprise WAF + custom build | Enterprise add-on | Enterprise add-on |
| **Edge scanning (no origin hit)** | Yes | No (must reach Lambda) | No (post-edge) | No |

---

## Self-Check Questions

**Question 1:** A customer asks "Does Cloudflare store my users' passwords to check them against the breach database?" Explain the k-anonymity model in plain English that you could use in a customer conversation.

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 2:** What is NIST SP 800-63B, and how does the Exposed Credentials Check help organizations meet its requirements?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 3:** A content scanning rule is blocking a legitimate PDF upload from a trusted business partner. What is the most appropriate fix? Walk through the steps.

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 4:** Why would you recommend running Exposed Credentials Check in "Log" mode before switching to "Block" mode? What is the risk of starting in Block mode immediately?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 5:** What types of malicious files does Content Scanning detect? Name three. What is one important limitation of Content Scanning that you should tell customers about?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

---

## Sources

- [Exposed Credentials Check Documentation](https://developers.cloudflare.com/waf/managed-rules/check-for-exposed-credentials/)
- [Content Scanning Documentation](https://developers.cloudflare.com/waf/about/content-scanning/)
- [NIST SP 800-63B Digital Identity Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [Have I Been Pwned API — k-Anonymity](https://haveibeenpwned.com/API/v3#SearchingPwnedPasswordsByRange)
- [Cloudflare WAF Fields Reference](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/)
- [WAF Custom Rules — Actions](https://developers.cloudflare.com/waf/custom-rules/create-api/)
- [Notification Policies API](https://developers.cloudflare.com/api/operations/notification-policies-create-a-notification-policy)
- [Content Upload Scan API](https://developers.cloudflare.com/api/operations/content-scanning-enable-content-scanning)
