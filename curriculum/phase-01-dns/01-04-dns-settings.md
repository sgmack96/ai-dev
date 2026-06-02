# Module 1.4 — DNS Settings (DNSSEC, Secondary DNS, DNS Firewall)

> **Dashboard Location:** `macksportreport.com` → DNS → Settings  
> **Estimated Time:** 45 minutes  
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### DNS Settings Overview

The DNS > Settings page controls how your zone's DNS behaves at a foundational level. The key features:

1. **DNSSEC** — Cryptographic authentication of DNS responses
2. **CNAME Flattening** — How CNAMEs at non-apex positions are handled
3. **Secondary DNS** — Backup nameservers outside Cloudflare
4. **Custom Nameservers** — Vanity nameservers (e.g., `ns1.macksportreport.com`)
5. **DNS Firewall** — Enterprise rate limiting and caching for your nameservers

### DNSSEC — Why It Matters

Without DNSSEC, DNS is vulnerable to **cache poisoning attacks**. An attacker can inject false DNS records into a resolver's cache, redirecting users to a malicious server even though they typed the correct domain name.

DNSSEC adds a cryptographic signature to every DNS response:
1. Cloudflare signs your zone's records with a private key
2. The public key is published in the DNS (as DNSKEY records)
3. A hash of the public key (DS record) is registered at the parent zone (.com TLD)
4. Resolvers that support DNSSEC validation can verify signatures before trusting responses

**The chain of trust:**
```
Root zone (.) — signed with ICANN root key
    ↓ DS record
.com TLD (Verisign) — signed with TLD key
    ↓ DS record
macksportreport.com — signed with Cloudflare-managed key
    ↓ RRSIG on every record
A/MX/TXT records — cryptographically verified
```

**When DNSSEC breaks:**
- Wrong or expired DS record at registrar
- Registrar doesn't support DNSSEC
- Key rollover not handled properly

If DNSSEC is enabled but the DS record isn't at the registrar, DNSSEC-validating resolvers (1.1.1.1, 8.8.8.8) will return SERVFAIL for your domain. Your site goes down for users whose ISP uses validating resolvers.

### CNAME Flattening

As covered in Module 1.2, CNAME flattening solves the "CNAME at apex" problem. Settings options:
- **Flatten CNAME at root** (default) — Only flattens the apex domain CNAME
- **Flatten all CNAMEs** — Flattens all CNAMEs to A/AAAA records at query time

**Flatten all CNAMEs** is useful when:
- Your downstream clients don't support CNAME chasing properly
- You want to minimize DNS round-trips
- You're using Cloudflare for SaaS and need consistent resolution behavior

### Custom Nameservers

By default, Cloudflare assigns you nameservers like `elmo.ns.cloudflare.com`. Enterprise customers can configure **vanity nameservers** — branded nameservers using their own domain:
```
ns1.macksportreport.com  → points to elmo.ns.cloudflare.com
ns2.macksportreport.com  → points to wanda.ns.cloudflare.com
```

From the outside, it looks like you run your own DNS. But under the hood, Cloudflare is still handling everything.

**Why this matters for enterprise:**
- Brand consistency for SaaS platforms serving customers
- Some compliance requirements mandate DNS operated "by the company"
- Professional appearance for domain registrars you can't migrate away from

### Secondary DNS

Secondary DNS allows you to run a second authoritative nameserver outside Cloudflare. Useful for:
- **Redundancy** — If Cloudflare has an outage (rare, but possible), secondary NS answers
- **Compliance** — Some requirements mandate geo-redundant DNS from separate providers
- **Migration** — During a move, keep old provider as secondary while Cloudflare becomes primary

Cloudflare supports two modes:
- **Primary (outbound AXFR)** — Cloudflare is primary, pushes updates to your secondary
- **Secondary (inbound AXFR)** — Cloudflare is secondary, pulls updates from your primary

---

## Deep Dive (Architect-Level)

### DNSSEC Key Management

Cloudflare manages DNSSEC keys automatically:
- **ZSK (Zone Signing Key)** — Signs individual DNS records, rotated regularly
- **KSK (Key Signing Key)** — Signs the ZSK, longer-lived, only the hash (DS) needs registrar update

Cloudflare handles ZSK rotation transparently. If the KSK ever needs rotation, you'd need to update the DS record at your registrar.

The DS record format:
```
macksportreport.com.  3600  IN  DS  2371 13 2 1F987B...hash...
                             ↑key tag  ↑algo  ↑hash type  ↑hash
```
Algorithm 13 = ECDSA P-256 with SHA-256 (modern, recommended)
Algorithm 8 = RSA/SHA-256 (older, still widely supported)

### DNSSEC and Email

When DNSSEC is enabled, your email records (MX, DKIM, SPF) are also signed. This provides additional protection against email spoofing — an attacker can't poison DNS to redirect your MX records.

### Secondary DNS Protocol: AXFR and NOTIFY

Zone transfers use the AXFR (full zone transfer) or IXFR (incremental) protocols:
- **AXFR:** "Give me all records in this zone" — used for initial sync
- **IXFR:** "Give me changes since serial X" — used for ongoing sync
- **NOTIFY:** Primary tells secondary "zone has changed, please fetch updates"

Cloudflare supports both as primary and secondary.

### DNS Firewall Architecture

```
External DNS query
        |
[Cloudflare DNS Firewall edge] ← rate limiting, anomaly detection
        |
  Cache hit? ─YES─→ Return cached response
        |
        NO
        |
Your origin nameserver ← protected, not directly exposed
```

Key capabilities:
- Rate limiting: max queries per second from a source IP
- Ratelimit by QTYPE (query type)
- Cluster cache: share cached responses across edge nodes
- Origin protection: hide your real nameserver IPs

---

## Dashboard Walkthrough

### DNS Settings Page (`macksportreport.com → DNS → Settings`)

**DNSSEC section:**
- Status: Enabled/Disabled toggle
- When enabled: shows DS record details (key tag, algorithm, digest type, digest)
- Copy button for the DS record — you paste this at your registrar
- Status indicator showing if registrar has the correct DS record

**To enable DNSSEC:**
1. Click "Enable DNSSEC"
2. Cloudflare generates keys and shows you the DS record
3. Copy the DS record
4. Go to your domain registrar (e.g., Namecheap → Domain List → Manage → Advanced DNS → DNSSEC)
5. Paste the DS record details
6. Wait 10-15 minutes for propagation

**Verification:**
```bash
# Check if DNSSEC is validating
dig A macksportreport.com +dnssec +short
# Should show RRSIG record alongside the A record

# Full DNSSEC chain validation
delv macksportreport.com A +rtrace
# Shows full chain of trust validation

# Online checker
# https://dnssec-analyzer.verisignlabs.com/macksportreport.com
```

**CNAME Flattening section:**
- Toggle: Flatten at root / Flatten all
- Default: Flatten at root (recommended for most zones)

**Custom Nameservers section:**
- Only visible on Enterprise
- Enter hostname pairs for your vanity nameservers
- Cloudflare provides glue records to configure

**Secondary DNS section:**
- Add secondary nameserver IP
- Choose primary (push) or secondary (pull) mode
- TSIG key for authentication between primary and secondary

---

## Hands-On Lab

### Lab 1.4: Enable and Verify DNSSEC

**Step 1: Check current DNSSEC status**
```bash
# Check if DNSSEC is already enabled
dig A macksportreport.com +dnssec @1.1.1.1
# If RRSIG appears in the answer, DNSSEC is active
# If no RRSIG, it's not enabled or not validating

# Check DS record existence
dig DS macksportreport.com @1.1.1.1
# Empty = no DS record at TLD level
```

**Step 2: Enable DNSSEC in dashboard**
```
DNS → Settings → DNSSEC → Enable
```
Record the DS record details shown:
- Key tag: ________________
- Algorithm: ________________
- Digest type: ________________
- Digest: ________________

**Step 3: Add DS record at your registrar**

This step depends on your registrar. Common registrars:
- **Namecheap:** Domain List → Manage → Advanced DNS → DNSSEC tab
- **GoDaddy:** My Domains → Manage → DNS → DS Records
- **Cloudflare Registrar:** It does this automatically (see Module 13.1)
- **Google Domains:** DNS → DNSSEC → Add DS record

**Step 4: Verify DNSSEC is working**
```bash
# Wait 15-30 minutes after adding DS record, then:

# Check for RRSIG record
dig A macksportreport.com +dnssec @8.8.8.8
# ANSWER SECTION should now include RRSIG

# Full chain validation
dig A macksportreport.com +dnssec @1.1.1.1 | grep -E "RRSIG|DNSKEY|DS"

# Online validator
open https://dnssec-analyzer.verisignlabs.com/macksportreport.com
```

**Step 5: Simulate DNSSEC failure (DO NOT DO ON PRODUCTION)**
Understanding failure modes:
```bash
# If DS record is wrong at registrar, validating resolvers return SERVFAIL
# You can test this in a staging zone by:
# 1. Enabling DNSSEC in CF
# 2. NOT adding DS record at registrar
# 3. dig A staging.example.com @1.1.1.1
# → Should return SERVFAIL (DNSSEC validation failed)
```

---

## Demo Script (2 Minutes)

> Use when discussing security posture with a compliance-focused customer

"DNSSEC is one of those security controls that most companies skip until they get hit with a DNS cache poisoning attack. The problem it solves is straightforward: without DNSSEC, an attacker who compromises a DNS resolver can inject false records, redirecting your users to a phishing site even though your DNS configuration is correct. They typed the right domain, they got the wrong server.

Enabling DNSSEC in Cloudflare takes literally 30 seconds — we generate the keys, we handle the rotation, you just copy a single DS record to your registrar. That's it. The hardest part is usually finding the right page on your registrar's dashboard, not the Cloudflare side.

One important note: you have to do both steps — enable it here AND add the DS record at your registrar. If you only do one, DNSSEC-validating resolvers will return SERVFAIL and your site goes down. We make it very clear in the UI, but it's the most common DNSSEC mistake we see."

---

## Competitive Context

| Feature | Cloudflare DNSSEC | Route53 DNSSEC | GoDaddy DNS |
|---------|------------------|----------------|-------------|
| **DNSSEC support** | Yes, free | Yes ($5/zone/month on Route53) | Basic support |
| **Key management** | Fully automatic | Partially managed | Manual |
| **Key algorithm** | ECDSA P-256 (Algorithm 13) | RSA-2048 (Algorithm 8) | Varies |
| **ZSK rotation** | Automatic | Manual | Manual |
| **DS record display** | One-click copy | Shown in console | Varies |
| **Failure diagnosis** | Built-in status + SERVFAIL logs | CloudWatch | None |

---

## Self-Check Questions

1. A customer enabled DNSSEC in Cloudflare but didn't add the DS record at their registrar. What happens? Who is affected?

2. What is the difference between a ZSK and a KSK in DNSSEC? Which one requires a registrar update?

3. A customer asks "should I enable DNSSEC if we're already using Cloudflare's WAF?" How do you frame the answer?

4. What is AXFR and when would a customer need Secondary DNS configured?

5. What are vanity/custom nameservers and what business case justifies using them?

---

**Your Answers:**

1. 

2. 

3. 

4. 

5. 

---

**Sources:**
- [DNSSEC on Cloudflare](https://developers.cloudflare.com/dns/dnssec/)
- [Secondary DNS](https://developers.cloudflare.com/dns/zone-setups/zone-transfers/)
- [Custom Nameservers](https://developers.cloudflare.com/dns/additional-options/custom-nameservers/)
- [CNAME Flattening](https://developers.cloudflare.com/dns/cname-flattening/)
- [DNSSEC Analyzer Tool](https://dnssec-analyzer.verisignlabs.com/)
- [DNS Firewall](https://developers.cloudflare.com/dns/dns-firewall/)
