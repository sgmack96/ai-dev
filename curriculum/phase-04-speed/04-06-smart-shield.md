# Module 4.6 — Smart Shield
> Dashboard Location: macksportreport.com → Speed → Smart Shield | Estimated Time: 60 minutes | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is Smart Shield?

Smart Shield is Cloudflare's automated configuration intelligence layer — a recommendations engine that continuously analyzes your zone's current settings against Cloudflare's best-practice database and surfaces prioritized, actionable suggestions. It answers the question: **"Given how my zone is currently configured, what should I change to improve performance, security, or reliability?"**

Think of it as having a Cloudflare SE embedded in your dashboard 24/7, reviewing your configuration and writing you a punch-list of improvements.

**What makes Smart Shield valuable:**
- Eliminates the "I don't know what I'm missing" problem for new zones
- Quantifies improvement potential (estimated score improvement per recommendation)
- One-click apply: many recommendations can be applied directly from the dashboard
- Dynamic: as CF adds new features or as your zone's configuration changes, new recommendations appear
- No consulting hours required — automated expertise at scale

### Why Cloudflare Built Smart Shield

From a product strategy perspective, Smart Shield serves multiple goals:

1. **Activation:** Many customers enable Cloudflare but leave features off because they don't know they exist. Smart Shield drives activation of Pro/Business/Enterprise features.

2. **Security posture improvement:** A significant portion of recommendations are security-focused (HSTS, SSL mode upgrade, WAF rules). Better-secured zones generate fewer security incidents and fewer support tickets.

3. **Performance baselines:** Performance recommendations (Brotli, APO, Early Hints) drive direct measurable improvements that customers can attribute to Cloudflare's value.

4. **Customer success at scale:** Cloudflare has millions of zones. Smart Shield allows the platform to deliver personalized recommendations without requiring a human SE to review every account.

**For you as an SE:** Smart Shield is your meeting opener. Pull it up on a customer's zone before a QBR and you instantly have a prepared agenda of improvements to discuss.

### Types of Recommendations

Smart Shield recommendations span three categories:

**Performance Recommendations:**
- Enable Brotli compression
- Enable Early Hints
- Enable Rocket Loader (with LCP improvement estimate)
- Add Cache Rules for static asset patterns
- Upgrade to APO (for WordPress/CMS sites)
- Enable Polish + WebP
- Enable HTTP/3

**Security Recommendations:**
- Enable HSTS (HTTP Strict Transport Security)
- Upgrade SSL/TLS encryption mode (from Flexible to Full or Full (Strict))
- Enable minimum TLS version (1.2 or 1.3)
- Enable Opportunistic Encryption
- Enable DNSSEC
- Add WAF managed ruleset
- Enable bot management

**Reliability Recommendations:**
- Set up Health Checks
- Configure failover with Load Balancing
- Enable Always Online (serve stale cache during origin outages)
- Add a custom error page
- Configure rate limiting

### How Smart Shield Generates Recommendations

Smart Shield works by comparing your zone's current setting values against a recommendation matrix:

```
Zone config scan:
  brotli = off → Recommendation: "Enable Brotli"
  ssl_mode = flexible → Recommendation: "Upgrade to Full (Strict) SSL"
  hsts = off → Recommendation: "Enable HSTS"
  early_hints = off → Recommendation: "Enable Early Hints"
  cache_rules = 0 → Recommendation: "Add Cache Rules for static assets"
  health_checks = 0 → Recommendation: "Set up Health Checks"
```

Beyond simple setting checks, Smart Shield also analyzes:
- **Traffic patterns:** If your zone has high traffic to cacheable content with low cache hit rate → recommends APO or Cache Rules
- **Error patterns:** If origin 5xx rate is elevated → recommends Health Checks + Load Balancing failover
- **SSL configuration:** Correlates SSL mode with actual origin behavior
- **Observatory score:** If score is low → surfaces relevant performance feature recommendations
- **Plan capabilities:** Only recommends features available on your current plan (or highlights upgrade path)

### Applying and Dismissing Recommendations

Each recommendation in Smart Shield has three possible actions:

**Apply:** CF applies the setting change automatically. Takes effect immediately (or within propagation delay). Logged in Audit Log.

**Learn more:** Opens documentation for the feature. Good for understanding before applying.

**Dismiss:** Removes the recommendation. Use when you've intentionally chosen NOT to enable a feature (e.g., Rocket Loader dismissed because you've tested it and it breaks your app).

**Important:** Dismissed recommendations can be un-dismissed. They're stored per zone, not permanently hidden.

### Smart Shield as a New Zone Checklist

The most efficient use of Smart Shield for SEs: use it as a structured onboarding checklist when a new customer zone is set up.

**New Zone Onboarding via Smart Shield — 15-Minute Sequence:**

1. Open Smart Shield → review all active recommendations
2. Categorize: Apply now vs. needs testing vs. dismiss
3. Apply security recommendations first (lowest risk, highest impact)
4. Apply performance recommendations for features already well-understood
5. Flag Rocket Loader and Polish for testing on staging before applying to production
6. Document dismissed recommendations with reason in customer notes

This gives you a defensible, documented "we reviewed the zone configuration against Cloudflare best practices" deliverable.

---

## Deep Dive (Architect-Level)

### Smart Shield vs Manual Configuration — Philosophy

Smart Shield operates on a **closed-world assumption**: it knows the ideal configuration for Cloudflare's features in most scenarios. It does NOT know:
- Your application's specific quirks (e.g., inline scripts that break Rocket Loader)
- Your business logic (e.g., intentionally caching for only 30 seconds on your news feed)
- Your compliance requirements (e.g., not enabling HSTS because your subdomain uses HTTP for legacy app)
- Your vendor constraints (e.g., your CDN vendor contract requires specific header behavior)

**Architect principle:** Smart Shield is a starting point, not the final word. Apply every recommendation to a staging environment first, verify with Observatory + functional testing, then apply to production.

### The Relationship Between Smart Shield and Observatory Score

Smart Shield and Observatory are complementary feedback loops:

```
Observatory runs test
    ↓
Identifies failing audits (e.g., "Serve images in next-gen formats")
    ↓
Smart Shield surfaces recommendation ("Enable Polish + WebP")
    ↓
You apply the recommendation
    ↓
Observatory test re-runs → score improves
    ↓
Smart Shield marks recommendation as applied, removes it from list
```

This creates a virtuous cycle: every Observatory improvement drives Smart Shield to mark a recommendation complete, driving higher completion percentage and a cleaner zone configuration.

### Priority Scoring in Smart Shield

Not all recommendations are equal. Smart Shield assigns a priority score based on:

- **Estimated impact:** How much will this improve performance/security? (e.g., SSL mode upgrade = high security impact)
- **Implementation risk:** How likely is this to cause issues? (Brotli = low risk, Rocket Loader = medium risk)
- **Plan availability:** Is this available on your current plan?
- **Zone characteristics:** High-traffic zones get higher priority on performance recommendations

### Integrating Smart Shield Into SE Workflow

**Pre-call preparation:**
```bash
# Pull Smart Shield recommendations via API before a customer call
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/smart_shield" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[] | {
    id: .id,
    title: .title,
    category: .category,
    impact: .impact,
    status: .status
  }'
```

**QBR Agenda Built From Smart Shield:**
```
Customer Quarterly Business Review — Agenda

1. Observatory Score Review (5 min) — show trend over last 90 days
2. Active Smart Shield Recommendations (10 min):
   - Applied last quarter: [list with measurable outcomes]
   - Remaining recommendations: [prioritized list]
   - Dismissed recommendations: [with documented rationale]
3. Proposed actions this quarter: [2-3 highest-impact items]
4. Plan upgrade discussion (if Pro features recommended on Free plan)
```

### Common Recommendation Deep-Dives

#### "Enable HSTS"
HSTS (HTTP Strict Transport Security) tells browsers to ONLY use HTTPS for your domain — never HTTP — for a defined period. Once a browser has seen the HSTS header, it upgrades all HTTP requests to HTTPS locally without even making the HTTP request.

```
Response header: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

- `max-age=31536000` — 1 year in seconds
- `includeSubDomains` — applies to all subdomains (risky if any subdomain uses HTTP)
- `preload` — submit to browser preload list (browsers ship with your domain on the HTTPS-only list)

**Risk:** If you enable HSTS with `includeSubDomains` and one of your subdomains isn't on HTTPS, it breaks. Test carefully.

#### "Upgrade SSL Mode to Full (Strict)"
SSL mode "Flexible" means CF talks to your origin over HTTP (no encryption between CF and origin). "Full (Strict)" means CF validates your origin's SSL certificate.

- **Flexible:** CF ↔ Browser (encrypted), CF ↔ Origin (unencrypted) — data in plaintext between CF and origin
- **Full:** CF ↔ Browser (encrypted), CF ↔ Origin (encrypted, but certificate not validated — self-signed OK)
- **Full (Strict):** CF ↔ Browser (encrypted), CF ↔ Origin (encrypted, valid certificate required)

Smart Shield recommends upgrading from Flexible to Full (Strict) because Flexible creates a security gap where traffic is unencrypted on the backend.

**Risk:** If your origin doesn't have a valid SSL cert, upgrading to Full (Strict) breaks connectivity. Fix: add a CF Origin CA certificate to your origin first.

#### "Add Cache Rules for Static Assets"
Smart Shield detects patterns like `/images/`, `/css/`, `/js/` paths with no explicit Cache Rules defined, and recommends adding TTL rules.

Recommended rule pattern:
```
Match: URI Path matches regex: \.(jpg|jpeg|png|gif|webp|svg|css|js|woff2|woff|ttf)$
Action: Cache TTL = 30 days (or 1 year for versioned assets)
```

---

## Dashboard Walkthrough

### Step 1: Navigate to Smart Shield
```
macksportreport.com → Speed → Smart Shield
```
*(May also appear as "Recommendations" in some dashboard versions)*

### Step 2: Review the Recommendation Count
- Top of page shows: "X recommendations active"
- Breakdown by category: Performance / Security / Reliability

### Step 3: Prioritize — Apply Quick Wins First
Sort by:
- **Impact:** Apply highest-impact items first
- **Risk:** Start with low-risk items (Brotli, Minify) before medium-risk (Rocket Loader)

Quick wins (apply immediately, essentially zero risk):
- [ ] Enable Brotli
- [ ] Enable Auto Minify (HTML, CSS)
- [ ] Enable Early Hints
- [ ] Enable HTTP/3
- [ ] Enable Minimum TLS 1.2

Requires testing first:
- [ ] Enable Rocket Loader (test for JS errors)
- [ ] Enable Polish (test for image quality)
- [ ] Enable HSTS (test subdomains first)

### Step 4: Apply a Recommendation
1. Click any recommendation card
2. Read the description (what it does, why it matters)
3. Click "Apply" to apply directly, or "Learn More" for documentation
4. Observe: Settings page updates immediately
5. Smart Shield removes the recommendation from the active list

### Step 5: Dismiss a Recommendation
1. Click the three-dot menu on a recommendation card
2. Select "Dismiss"
3. Optionally: add a note explaining why (good for team documentation)
4. Recommendation moves to "Dismissed" tab

### Step 6: Check Applied Recommendations History
- Click "Applied" tab
- See all recommendations applied over the zone's lifetime
- Each shows: date applied, who applied it (if via dashboard), feature enabled

---

## Hands-On Lab

### Prerequisites
- macksportreport.com on Cloudflare
- API token with Zone:Read and Zone Settings:Edit permissions

### Lab 1: Fetch All Smart Shield Recommendations via API

```bash
export CF_API_TOKEN="your_api_token_here"
export ZONE_ID="your_zone_id_here"

# List all current Smart Shield recommendations
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/smart_shield" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.'

# Filter for only active (not yet applied or dismissed) recommendations
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/smart_shield" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[] | select(.status == "active") | {
    id: .id,
    title: .title,
    category: .category,
    description: .description
  }'
```

### Lab 2: Simulate a New Zone — Audit Before Touching Anything

```bash
#!/bin/bash
# pre-flight-audit.sh — Run this on a fresh or newly-onboarded zone

CF_API_TOKEN="${CF_API_TOKEN}"
ZONE_ID="${ZONE_ID}"

echo "======================================"
echo "  Pre-Flight Zone Audit"
echo "  Zone: $ZONE_ID"
echo "======================================"
echo ""

# Check SSL mode
SSL_MODE=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/ssl" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result.value')
echo "SSL Mode: $SSL_MODE"
if [ "$SSL_MODE" == "flexible" ]; then
  echo "  ⚠️  RISK: Flexible SSL — traffic unencrypted between CF and origin"
fi

# Check HSTS
HSTS=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/security_header" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result.value.strict_transport_security.enabled')
echo "HSTS: $HSTS"

# Check Brotli
BROTLI=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/brotli" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result.value')
echo "Brotli: $BROTLI"
if [ "$BROTLI" == "off" ]; then
  echo "  ℹ️  Recommendation: Enable Brotli for 20-30% compression improvement"
fi

# Check Early Hints
HINTS=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/early_hints" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result.value')
echo "Early Hints: $HINTS"

# Check Rocket Loader
RL=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/rocket_loader" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result.value')
echo "Rocket Loader: $RL"

# Check HTTP/3
H3=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/http3" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result.value')
echo "HTTP/3: $H3"

# Check Min TLS
TLS=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/min_tls_version" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result.value')
echo "Min TLS Version: $TLS"

# Check Polish
POLISH=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/polish" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result.value')
echo "Polish: $POLISH"

# Check Auto Minify
MINIFY=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/minify" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result.value | "HTML:\(.html) CSS:\(.css) JS:\(.js)"')
echo "Auto Minify: $MINIFY"

echo ""
echo "--- Smart Shield Active Recommendations ---"
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/smart_shield" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[] | select(.status == "active") | "[\(.category)] \(.title)"'

echo ""
echo "Audit complete."
```

```bash
chmod +x pre-flight-audit.sh
./pre-flight-audit.sh
```

### Lab 3: Apply All Low-Risk Speed Recommendations

```bash
#!/bin/bash
# apply-quick-wins.sh — Apply all low-risk speed optimizations

CF_API_TOKEN="${CF_API_TOKEN}"
ZONE_ID="${ZONE_ID}"

apply_setting() {
  local endpoint=$1
  local payload=$2
  local name=$3
  
  RESULT=$(curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/$endpoint" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload")
  
  SUCCESS=$(echo "$RESULT" | jq -r '.success')
  VALUE=$(echo "$RESULT" | jq -r '.result.value')
  
  if [ "$SUCCESS" == "true" ]; then
    echo "✅ $name: $VALUE"
  else
    ERROR=$(echo "$RESULT" | jq -r '.errors[0].message')
    echo "❌ $name: FAILED — $ERROR"
  fi
}

echo "Applying low-risk speed optimizations to zone $ZONE_ID..."
echo ""

apply_setting "brotli" '{"value":"on"}' "Brotli"
apply_setting "early_hints" '{"value":"on"}' "Early Hints"
apply_setting "http3" '{"value":"on"}' "HTTP/3"
apply_setting "minify" '{"value":{"css":"on","html":"on","js":"on"}}' "Auto Minify"
apply_setting "min_tls_version" '{"value":"1.2"}' "Minimum TLS 1.2"
apply_setting "opportunistic_encryption" '{"value":"on"}' "Opportunistic Encryption"
apply_setting "automatic_https_rewrites" '{"value":"on"}' "Automatic HTTPS Rewrites"

echo ""
echo "Done. Test your site now before enabling Rocket Loader."
echo "Run Observatory to measure the improvement."
```

```bash
chmod +x apply-quick-wins.sh
./apply-quick-wins.sh
```

### Lab 4: Enable HSTS (With Safety Checks)

```bash
# IMPORTANT: Only enable HSTS after verifying all subdomains use HTTPS
# First, audit your DNS for subdomains

# List all DNS records to find subdomains
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[] | select(.type == "A" or .type == "CNAME") | {
    name: .name,
    type: .type,
    content: .content,
    proxied: .proxied
  }'

# Check each subdomain is accessible via HTTPS before enabling HSTS
# (Replace with your actual subdomains)
for subdomain in "www" "api" "blog" "shop"; do
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "https://$subdomain.macksportreport.com/")
  echo "$subdomain.macksportreport.com: HTTP $RESPONSE"
done

# Once verified all subdomains work on HTTPS:
# Enable HSTS via Security Headers API
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/security_header" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "value": {
      "strict_transport_security": {
        "enabled": true,
        "max_age": 31536000,
        "include_subdomains": false,
        "preload": false,
        "nosniff": true
      }
    }
  }' | jq '.result.value.strict_transport_security'

# NOTE: Start with include_subdomains: false and preload: false
# Increase scope only after confirming all subdomains work correctly
echo "HSTS enabled. Verify with: curl -I https://macksportreport.com/ | grep -i strict"
```

### Lab 5: Verify HSTS is Active

```bash
# Confirm HSTS header is present
curl -s -I https://macksportreport.com/ | grep -i "strict-transport-security"
# Expected: strict-transport-security: max-age=31536000

# Simulate what happens when browser sees HSTS:
# - First visit: browser receives HSTS header, stores it
# - Subsequent visits: browser upgrades http:// → https:// locally
# - Test: curl http://macksportreport.com/ — should redirect to https://

curl -s -I http://macksportreport.com/ | head -5
# Expected: 301 Moved Permanently with Location: https://macksportreport.com/
```

### Lab 6: Document the Recommendation Completion State

```bash
#!/bin/bash
# smart-shield-status.sh — Show full recommendation status for reporting

CF_API_TOKEN="${CF_API_TOKEN}"
ZONE_ID="${ZONE_ID}"

echo "=================================="
echo "Smart Shield Status Report"
echo "Zone: $ZONE_ID"
echo "Date: $(date)"
echo "=================================="
echo ""

RECOMMENDATIONS=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/smart_shield" \
  -H "Authorization: Bearer $CF_API_TOKEN")

echo "=== Active Recommendations (To Do) ==="
echo "$RECOMMENDATIONS" | jq -r '.result[] | select(.status == "active") | "• [\(.category | ascii_upcase)] \(.title)"'

echo ""
echo "=== Applied Recommendations (Done) ==="
echo "$RECOMMENDATIONS" | jq -r '.result[] | select(.status == "applied") | "✓ [\(.category | ascii_upcase)] \(.title)"'

echo ""
echo "=== Dismissed Recommendations (Intentionally Skipped) ==="
echo "$RECOMMENDATIONS" | jq -r '.result[] | select(.status == "dismissed") | "⊘ [\(.category | ascii_upcase)] \(.title)"'

echo ""
TOTAL=$(echo "$RECOMMENDATIONS" | jq '.result | length')
APPLIED=$(echo "$RECOMMENDATIONS" | jq '[.result[] | select(.status == "applied")] | length')
ACTIVE=$(echo "$RECOMMENDATIONS" | jq '[.result[] | select(.status == "active")] | length')

echo "=== Summary ==="
echo "Total: $TOTAL | Applied: $APPLIED | Remaining: $ACTIVE"
if [ "$TOTAL" -gt 0 ]; then
  COMPLETION=$(echo "scale=1; $APPLIED * 100 / $TOTAL" | bc)
  echo "Completion: ${COMPLETION}%"
fi
```

```bash
chmod +x smart-shield-status.sh
./smart-shield-status.sh
```

---

## Demo Script (2 Minutes)

**Audience:** Customer (new zone onboarding or QBR)

---

**[0:00 – 0:20] The Setup**

"I want to show you something that's essentially a Cloudflare expert reviewing your zone configuration and writing you a prioritized to-do list. This is Smart Shield."

*Navigate to: macksportreport.com → Speed → Smart Shield*

---

**[0:20 – 0:50] Read the Recommendations**

"You have [X] active recommendations right now. Let me point out the top ones."

*Scroll through the list.*

"This one — 'Enable Brotli' — is a 30-second fix. It reduces the size of every text response your site serves by 20–30%. Zero risk. I'm going to apply it right now."

*Click Apply on Brotli.*

"Done. That change just propagated to Cloudflare's global network. Every request to your site from this moment on gets compressed with Brotli."

"This one — 'Upgrade SSL Mode to Full (Strict)' — means right now traffic between Cloudflare and your origin server is unencrypted. I'll flag that for the security conversation."

---

**[0:50 – 1:30] Work Through the List**

*Apply 2–3 more low-risk recommendations live.*

"Each time we apply one of these, it disappears from the list. The goal is to get this list to zero — every recommendation applied or explicitly dismissed with a reason. That's what a well-configured Cloudflare zone looks like."

---

**[1:30 – 2:00] The QBR Frame**

"What I'd like to do is make this our agenda for every quarterly review. We pull up Smart Shield, we go through what's new since last quarter, we apply the quick wins together, and we flag anything that needs testing. It takes 15 minutes and it means your Cloudflare configuration is always current with best practices. Does that work for you?"

---

## Competitive Context

| Feature | Cloudflare Smart Shield | AWS Trusted Advisor | GCP Recommender | Fastly |
|---------|------------------------|---------------------|-----------------|--------|
| **What it analyzes** | CF zone configuration | AWS service usage, security, cost | GCP resource config | No equivalent |
| **Recommendation types** | Performance, Security, Reliability | Cost, Security, Fault tolerance, Performance | Security, Cost, Performance, Reliability | N/A |
| **One-click apply** | Yes | Limited (some actions) | Limited | N/A |
| **CDN-integrated** | Yes — CF features directly | No | No | N/A |
| **Free tier** | Yes (basic) | Limited (Basic Support) | Yes | N/A |
| **API access** | Yes (full) | Yes | Yes | N/A |
| **Dismissal with notes** | Yes | Limited | Yes | N/A |
| **Historical tracking** | Yes (applied recs) | Yes | Yes | N/A |

**SE Positioning:** Smart Shield is unique in the CDN space — no other CDN vendor has built an equivalent automated recommendations engine. AWS Trusted Advisor is the closest analog but covers AWS-wide services; Smart Shield is deep on Cloudflare-specific configuration best practices. For a customer managing their zone, Smart Shield removes the need to read through all of Cloudflare's documentation to know "what should I have turned on?"

---

## Self-Check Questions

**Instructions:** Answer each question without referring to your notes.

---

**Q1.** Smart Shield recommends "Upgrade SSL Mode from Flexible to Full (Strict)." A customer asks: "Does this matter? We already have HTTPS." How do you explain the actual security gap that exists with Flexible mode, and what prerequisite must be true on the origin before you can make this change safely?

```
Your answer:




```

---

**Q2.** You pull up Smart Shield before a customer QBR and see 12 active recommendations. How do you triage which to apply immediately vs. which require testing, and what criteria guide that decision?

```
Your answer:




```

---

**Q3.** Smart Shield recommends enabling HSTS with `includeSubDomains`. The customer has an internal app running on `admin.macksportreport.com` that uses HTTP (not HTTPS). What happens if you apply this recommendation without checking, and how do you fix it?

```
Your answer:




```

---

**Q4.** A customer says "Smart Shield keeps recommending Rocket Loader, but we dismissed it because it broke our site. How do we prevent it from appearing again, and should we be worried we're missing out on performance gains?" How do you respond?

```
Your answer:




```

---

**Q5.** Explain how Smart Shield, Observatory, and RUM form a complete performance management system. What role does each play, and in what order would you use them for a new customer onboarding?

```
Your answer:




```

---

## Sources

- [Cloudflare Smart Shield Overview](https://developers.cloudflare.com/fundamentals/basic-tasks/manage-widgets/)
- [Cloudflare Zone Settings API](https://developers.cloudflare.com/api/operations/zone-settings-get-all-zone-settings)
- [HSTS Documentation — Cloudflare](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/)
- [SSL/TLS Encryption Modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/)
- [Cloudflare Minimum TLS Version](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/minimum-tls/)
- [Cloudflare Security Headers](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/security-header/)
- [Automatic HTTPS Rewrites](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/automatic-https-rewrites/)
- [Opportunistic Encryption](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/opportunistic-encryption/)
- [Cloudflare Audit Log](https://developers.cloudflare.com/fundamentals/setup/account/account-security/review-audit-logs/)
- [HSTS Preload List](https://hstspreload.org/)
