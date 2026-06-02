# Module 7.2 — DMARC Management
> Dashboard Location: macksportreport.com → Email → DMARC Management
> Estimated Time: 75 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### The Email Authentication Problem

Email was designed in the 1980s with zero authentication. Any mail server can claim to send email from any address. This is why phishing, Business Email Compromise (BEC), and domain spoofing are rampant.

The solution is a three-layer authentication stack:
1. **SPF** — Which IP addresses are allowed to send email for your domain?
2. **DKIM** — Is the email cryptographically signed by the sending domain?
3. **DMARC** — What should the receiving server do when SPF and/or DKIM fail?

None of these work in isolation. DMARC is the policy layer that sits on top of SPF and DKIM and tells the world how to handle failures.

### SPF (Sender Policy Framework)

SPF is a DNS TXT record that lists which mail servers are authorized to send email for your domain.

**Example:**
```
v=spf1 include:_spf.google.com include:sendgrid.net ~all
```

- `include:_spf.google.com` — Google Workspace servers are authorized
- `include:sendgrid.net` — SendGrid servers are authorized
- `~all` — Everything else: soft fail (mark as suspicious, don't reject)
- `-all` — Everything else: hard fail (reject)

**SPF check:** The receiving server checks if the IP that delivered the email is in the domain's SPF record.

**SPF limitation:** SPF checks the *envelope from* (the SMTP MAIL FROM), not the *header from* (what you see in the email client). This is why SPF alone doesn't stop header spoofing.

### DKIM (DomainKeys Identified Mail)

DKIM uses public-key cryptography. The sending mail server signs the email with a private key. The public key is published in DNS. The receiving server verifies the signature.

**DNS record:**
```
selector1._domainkey.macksportreport.com TXT "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3..."
```

**What gets signed:** The email headers (including From:, Subject:, Date:) and body. If anyone tampers with the email in transit, the signature breaks.

**Why it matters for DMARC:** DKIM provides a domain that must "align" with the From: header domain for DMARC to pass.

### DMARC (Domain-based Message Authentication, Reporting, and Conformance)

DMARC adds two things on top of SPF and DKIM:
1. **Alignment:** Requires that SPF and/or DKIM align with the visible From: header domain
2. **Policy:** Tells receiving servers what to do when authentication fails
3. **Reporting:** Sends aggregate and forensic reports back to the domain owner

**DMARC DNS record format:**
```
_dmarc.macksportreport.com TXT "v=DMARC1; p=reject; rua=mailto:dmarc@macksportreport.com; ruf=mailto:forensic@macksportreport.com; pct=100"
```

**Policy values:**
- `p=none` — Monitor only. Don't take action. Receive reports.
- `p=quarantine` — Route failing mail to spam/junk folder
- `p=reject` — Reject failing mail outright (most secure)

### DMARC Policy Progression

Never start at `p=reject`. You will break legitimate email.

```
p=none (observe) → p=quarantine (soft enforcement) → p=reject (full protection)
```

Typical timeline:
- **Week 1-4:** `p=none` — collect reports, identify all legitimate senders
- **Week 4-8:** `p=quarantine; pct=10` — quarantine 10% of failing mail
- **Week 8-12:** `p=quarantine; pct=100` — quarantine all failing mail
- **Week 12+:** `p=reject` — reject all failing mail

### What Cloudflare DMARC Management Does

Cloudflare's DMARC Management feature:
1. **Receives** aggregate DMARC reports (rua) from receiving mail servers (Gmail, Outlook, Yahoo, etc.)
2. **Parses** the XML reports (which are unreadable without a tool)
3. **Visualizes** the data: who is sending email using your domain, and what percentage passes
4. **Recommends** when to advance your policy

DMARC aggregate reports are XML files that look like this in raw form — this is why you need a tool to parse them:
```xml
<feedback>
  <report_metadata>
    <org_name>google.com</org_name>
    <date_range>
      <begin>1700000000</begin>
      <end>1700086400</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>macksportreport.com</domain>
    <p>none</p>
  </policy_published>
  <record>
    <row>
      <source_ip>209.85.220.41</source_ip>
      <count>47</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
  </record>
</feedback>
```

---

## Deep Dive (Architect-Level)

### DMARC Alignment Explained

DMARC alignment is a concept that trips up most engineers.

There are two alignment modes for each of SPF and DKIM:
- **Relaxed (default):** The organizational domain must match. `mail.macksportreport.com` aligns with `macksportreport.com`
- **Strict:** The exact domain must match. `mail.macksportreport.com` does NOT align with `macksportreport.com`

**In the DMARC record:**
```
v=DMARC1; p=reject; aspf=r; adkim=r
```
- `aspf=r` — SPF alignment: relaxed
- `aspf=s` — SPF alignment: strict
- `adkim=r` — DKIM alignment: relaxed
- `adkim=s` — DKIM alignment: strict

**For DMARC to PASS, one of these must be true:**
1. SPF passes AND the SPF domain aligns with the From: header domain, OR
2. DKIM passes AND the DKIM d= domain aligns with the From: header domain

### Subdomain Policy

DMARC supports a separate policy for subdomains:
```
v=DMARC1; p=reject; sp=quarantine; rua=mailto:dmarc@macksportreport.com
```
- `p=reject` — reject policy for macksportreport.com
- `sp=quarantine` — quarantine policy for subdomains (news.macksportreport.com, etc.)

### Percent (pct) Parameter

During rollout, use `pct=` to apply the policy to only a percentage of failing messages:
```
v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc@macksportreport.com
```
This quarantines 25% of messages that fail DMARC. Useful for staged rollout without full business impact.

### Report Types

**Aggregate Reports (rua):**
- Daily XML summaries
- Sent by every major mail provider (Google, Microsoft, Yahoo, etc.)
- Shows volume, sources, pass/fail statistics
- No PII, no email content

**Forensic Reports (ruf):**
- Per-failure reports with full email headers (sometimes full message)
- Not all providers send these (privacy concerns)
- More sensitive — treat with care
- Often omitted from DMARC records in practice

### Full DMARC Record Reference

```
_dmarc.macksportreport.com IN TXT
  "v=DMARC1;           DMARC version (required, must be first)
   p=reject;           Policy: none/quarantine/reject
   sp=quarantine;      Subdomain policy
   pct=100;            Percentage to apply policy to (1-100)
   rua=mailto:dmarc-reports@macksportreport.com;   Aggregate report address
   ruf=mailto:forensic@macksportreport.com;         Forensic report address
   fo=1;               Failure options: 0=report if all fail, 1=report if any fail
   aspf=r;             SPF alignment: r=relaxed, s=strict
   adkim=r;            DKIM alignment: r=relaxed, s=strict
   ri=86400"           Reporting interval in seconds (default: 86400 = daily)
```

### SPF Record Architecture for Complex Senders

The SPF 10-DNS-lookup limit is real and commonly hit by enterprises:

```
# Problem: too many includes
v=spf1 include:_spf.google.com include:sendgrid.net include:mailchimp.com
       include:salesforce.com include:zendesk.com include:_spf.mx.cloudflare.net
       include:amazonses.com -all
# ^ This likely exceeds 10 lookups → SPF fails
```

**Solution: SPF flattening** — resolve all includes to actual IPs and list them directly:
```
v=spf1 ip4:74.125.0.0/16 ip4:198.21.0.0/21 ip4:66.249.0.0/20 ip6:2a00:1450::/32 -all
```

Or use an SPF flattening service that auto-maintains the record.

### DKIM Setup by Provider

**Google Workspace:**
1. Admin Console → Apps → Google Workspace → Gmail → Authenticate Email
2. Generate DKIM key, add to DNS as: `google._domainkey.macksportreport.com`

**SendGrid:**
1. Settings → Sender Authentication → Domain Authentication
2. Adds two CNAME records that automatically rotate keys

**Mailchimp:**
1. Audience → Settings → Domains
2. Verify domain, add DKIM and DMARC records shown

**Custom DKIM (self-managed):**
```bash
# Generate DKIM keypair
openssl genrsa -out dkim_private.pem 2048
openssl rsa -in dkim_private.pem -pubout -out dkim_public.pem

# Extract public key for DNS (remove headers, join lines)
openssl rsa -in dkim_private.pem -pubout -outform PEM 2>/dev/null \
  | tr -d '\n' | sed 's/-----BEGIN PUBLIC KEY-----//' | sed 's/-----END PUBLIC KEY-----//'
```

---

## Dashboard Walkthrough

**Navigation:** macksportreport.com → Email → DMARC Management

### Initial Setup View

The first screen shows your current DMARC status:
- Is a DMARC record configured?
- Current policy (none/quarantine/reject)
- Cloudflare's rua email address to add to your record

### Step 1: Add Cloudflare as a DMARC Report Recipient

Cloudflare provides an address like: `dmarc-reports@macksportreport.com` (mapped internally). Add it to your DMARC record:

```
_dmarc.macksportreport.com TXT "v=DMARC1; p=none; rua=mailto:dmarc@cloudflare.net"
```

Or through Cloudflare DNS directly (Dashboard will prompt you).

### Step 2: View the Reports Dashboard

After 24-48 hours, reports begin arriving:

**Summary Cards:**
- Total messages evaluated
- Pass rate (SPF + DKIM aligned)
- Fail rate
- Sending sources identified

**Source Table:**
- IP address / sending source
- Volume (emails sent)
- SPF result (pass/fail)
- DKIM result (pass/fail)
- DMARC disposition

**Timeline chart:** Pass/fail trend over 30 days

### Step 3: Policy Recommendation

Cloudflare's DMARC tool shows:
- Current policy
- Whether it's safe to advance
- Sources that would be affected by advancing to a stricter policy

### Step 4: Update Policy

When Cloudflare recommends, update your DMARC record:
```
DNS → Edit _dmarc TXT record → change p=none to p=quarantine
```

---

## Hands-On Lab

### Lab 1: Inspect Current DMARC Record

```bash
# Check existing DMARC record
dig TXT _dmarc.macksportreport.com +short

# Check SPF record
dig TXT macksportreport.com +short | grep spf

# Check for DKIM records (requires knowing selectors — common ones)
for selector in google default selector1 selector2 mail smtp; do
  result=$(dig TXT ${selector}._domainkey.macksportreport.com +short 2>/dev/null)
  if [ -n "$result" ]; then
    echo "Found DKIM at ${selector}._domainkey.macksportreport.com: $result"
  fi
done
```

### Lab 2: Validate DMARC Record Syntax

```bash
# Use dmarcian API (or similar) to validate
curl -s "https://dmarcian.com/api/dmarc/?domain=macksportreport.com" | jq '.'

# Or use Google's Toolbox (via API)
# Manual validation: check required fields
DMARC_RECORD=$(dig TXT _dmarc.macksportreport.com +short)
echo "DMARC record: $DMARC_RECORD"

# Check for required v=DMARC1
echo $DMARC_RECORD | grep -q "v=DMARC1" && echo "VERSION: OK" || echo "VERSION: MISSING"

# Check policy
echo $DMARC_RECORD | grep -oP "p=\w+" || echo "POLICY: NOT FOUND"
```

### Lab 3: Add DMARC Record via Cloudflare API

```bash
# Add initial DMARC record (p=none for observation phase)
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "TXT",
    "name": "_dmarc",
    "content": "v=DMARC1; p=none; rua=mailto:dmarc-agg@macksportreport.com; ruf=mailto:dmarc-forensic@macksportreport.com; fo=1",
    "ttl": 1
  }' | jq '.result | {id, name, content}'
```

### Lab 4: Parse a Sample DMARC Report

```bash
# DMARC reports arrive as XML (often gzipped) via email
# Save a sample report and parse it

cat > sample_dmarc_report.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>google.com</org_name>
    <email>noreply-dmarc-support@google.com</email>
    <report_id>123456789</report_id>
    <date_range>
      <begin>1700000000</begin>
      <end>1700086400</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>macksportreport.com</domain>
    <p>none</p>
    <sp>none</sp>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>209.85.220.41</source_ip>
      <count>145</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <row>
      <source_ip>198.2.133.52</source_ip>
      <count>3</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>fail</dkim>
        <spf>fail</spf>
      </policy_evaluated>
    </row>
  </record>
</feedback>
EOF

# Parse with Python
python3 << 'PYEOF'
import xml.etree.ElementTree as ET

tree = ET.parse('sample_dmarc_report.xml')
root = tree.getroot()

org = root.find('.//org_name').text
domain = root.find('.//domain').text
policy = root.find('.//p').text

print(f"Report from: {org}")
print(f"Domain: {domain}")
print(f"Policy: {policy}")
print()

for record in root.findall('.//record'):
    ip = record.find('.//source_ip').text
    count = record.find('.//count').text
    dkim = record.find('.//dkim').text
    spf = record.find('.//spf').text
    print(f"Source: {ip} | Count: {count} | DKIM: {dkim} | SPF: {spf}")
PYEOF
```

### Lab 5: Test Email Authentication Headers

```bash
# Send a test email and examine received headers
# Use mail-tester.com or similar

# Or check headers of a received email
# Look for:
# Authentication-Results: mx.google.com;
#   dkim=pass header.i=@macksportreport.com header.s=google;
#   spf=pass smtp.mailfrom=macksportreport.com;
#   dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=macksportreport.com

# Test from command line using swaks + check results
swaks \
  --to postmaster@gmail.com \
  --from test@macksportreport.com \
  --server smtp.google.com:587 \
  --tls \
  --auth LOGIN \
  --header "Subject: DMARC Test $(date)" \
  --body "Testing DMARC authentication"
```

---

## Demo Script (2 Minutes)

**Audience:** Security-conscious founder, IT Manager, compliance officer

**Opening:**
> "Every day, someone is probably sending phishing emails pretending to be macksportreport.com. With DMARC, you can see exactly who's doing it — and eventually, stop it completely."

**Show:**
1. Dashboard → Email → DMARC Management
2. Show the summary — total messages, pass/fail rates
3. Expand a failing source: "See this? This IP failed both SPF and DKIM. It's someone spoofing your domain."
4. Show the policy recommendation: "Cloudflare is telling you it's safe to advance from `p=none` to `p=quarantine`."
5. Show the DNS record you'd update

**Closer:**
> "In 30 days of monitoring, then one DNS change, you can make it so that any email failing authentication goes straight to spam. In 60 days, `p=reject` — spoofed emails get bounced outright. No special hardware, no email gateway — just DNS records."

---

## Competitive Context

| Feature | Cloudflare DMARC Mgmt | Dmarcian | Valimail | Proofpoint |
|---------|----------------------|----------|----------|------------|
| Price | Included (free) | From $19/mo | From $500/mo | Enterprise |
| Report parsing | Yes | Yes | Yes | Yes |
| Policy wizard | Yes | Yes | Yes | Yes |
| SPF flattening | No | Yes | Yes | Yes |
| Multi-domain | Zone-level | Yes | Yes | Yes |
| Forensic reports | No | Yes | Yes | Yes |
| Integrations | Cloudflare native | Many | Many | Full suite |
| BEC protection | Partial (visibility) | Partial | Yes | Yes |

**Cloudflare DMARC Management is free** — meaningful for SMBs who need visibility but can't justify $19-500/month for a dedicated tool. For enterprises with complex multi-domain setups, point them toward Valimail or Dmarcian alongside Cloudflare.

---

## Self-Check Questions

**Q1: What is the difference between `p=none`, `p=quarantine`, and `p=reject`? When would you start a new domain at `p=reject`?**

```
Your answer:




```

**Q2: DMARC can pass even if both SPF and DKIM fail. True or false, and explain.**

```
Your answer:




```

**Q3: A customer has Google Workspace and SendGrid sending email for macksportreport.com. What DNS records do they need to set up for full DMARC compliance? List them.**

```
Your answer:




```

**Q4: What is "alignment" in DMARC context? What's the difference between relaxed and strict alignment?**

```
Your answer:




```

**Q5: A customer says "I set DMARC to `p=reject` last week and now our marketing emails from Mailchimp are bouncing." What happened and how do you fix it?**

```
Your answer:




```

---

## Sources

- [Cloudflare DMARC Management](https://developers.cloudflare.com/dmarc-management/)
- [RFC 7489 — DMARC Specification](https://tools.ietf.org/html/rfc7489)
- [RFC 7208 — SPF Specification](https://tools.ietf.org/html/rfc7208)
- [RFC 6376 — DKIM Specification](https://tools.ietf.org/html/rfc6376)
- [Google DMARC Guide](https://support.google.com/a/answer/2466580)
- [Cloudflare Blog: DMARC Management Launch](https://blog.cloudflare.com/dmarc-management/)
- [DMARC.org Best Practices](https://dmarc.org/wiki/FAQ)
- [dmarcian DMARC Glossary](https://dmarcian.com/dmarc-glossary/)
