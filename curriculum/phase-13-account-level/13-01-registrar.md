# Module 13.1 — Cloudflare Registrar
> Dashboard Location: Account Home → Domain Registration (Registrar) | Estimated Time: 45 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare Registrar is a domain registrar that charges wholesale ICANN pricing with no markup. No upsells, no dark patterns, no parking pages — just domain registration at cost.

**The business model difference:** GoDaddy, Namecheap, Google Domains, and most registrars mark up wholesale pricing. GoDaddy marks up heavily and makes most of its money on add-ons (privacy, forwarding, hosting). Cloudflare's model: charge wholesale, build the relationship through the broader platform.

**Typical pricing comparison for `.com` (2024):**
- GoDaddy: $0.99 first year, $19.99 renewal
- Namecheap: $6.99 first year, $14.58 renewal
- Google Domains: $12/year
- Cloudflare Registrar: ~$9.15/year (wholesale ICANN price, every year)

The "first year trap" at GoDaddy/Namecheap is real — low intro price, high renewal. Cloudflare has the same price every year.

**What makes Cloudflare Registrar particularly useful:**
- **Automatic DNSSEC:** The biggest operational advantage. When a domain is on CF Registrar and uses CF DNS, DNSSEC is enabled automatically. DS records (the cryptographic delegation) are added to the parent zone automatically. At other registrars, DNSSEC requires manually copying DS records from your DNS provider to your registrar — a common source of DNSSEC failures.
- **No WHOIS privacy upsell:** WHOIS privacy is free and automatic. At GoDaddy it's $10+/year.
- **Same dashboard:** Domain registered and managed in the same dashboard as your DNS, WAF, and CDN. One less place to go.

---

## Deep Dive (Architect-Level)

### DNSSEC and the Registrar Role

DNSSEC creates a cryptographic chain of trust from the root zone (IANA) down to your domain:

```
Root Zone (IANA)
   │ Signs .com's DS records
.com TLD (Verisign)
   │ Signs macksportreport.com's DS records ← THIS requires registrar action
macksportreport.com (your zone)
   │ Signs your DNS records (A, AAAA, MX, etc.)
```

The DS record (Delegation Signer) is what links your zone's signing key to the parent TLD. To enable DNSSEC:
1. Your DNS provider (Cloudflare) generates a ZSK and KSK, creates DS record
2. You copy the DS record to your registrar's control panel
3. Your registrar submits the DS record to the TLD registry

**This is where most DNSSEC implementations break.** The DS record at the registrar must stay in sync with the keys at the DNS provider. When keys rotate (automatically), DS records must be updated. Many registrars make this a manual process.

With Cloudflare Registrar + Cloudflare DNS: the DS records are kept in sync automatically. Key rotation triggers DS record updates without any manual intervention.

### Domain Transfer Mechanics

**Transferring IN to Cloudflare Registrar:**
1. Unlock domain at current registrar (remove transfer lock/domain lock)
2. Get Auth/EPP code from current registrar (sometimes called Transfer Code or Auth Code)
3. Enter auth code in Cloudflare: Account Home → Domain Registration → Transfer
4. ICANN 60-day lock: domains can't transfer again for 60 days after a transfer (ICANN rule)
5. Transfer takes 5-7 days typically; registrar must accept/reject transfer request

**Transferring OUT to another registrar:**
1. Disable Privacy Guard temporarily (exposes real WHOIS data, needed for some registrar verifications)
2. Unlock domain in Cloudflare → Domain Registration → Manage → Transfer Out
3. Request auth code from Cloudflare
4. Enter auth code at receiving registrar
5. Approve transfer request sent to registrant email

**Domain eligibility for transfer:**
- Domain must be active (not expired or suspended)
- Domain must not have been registered or transferred in last 60 days
- TLD must be supported by Cloudflare Registrar (most common TLDs are)

### Supported TLDs

Cloudflare Registrar supports 200+ TLDs including:
- Generic: `.com`, `.net`, `.org`, `.io`, `.co`, `.app`, `.dev`, `.ai`, `.tech`
- Country code: `.us`, `.uk`, `.ca`, `.de`, `.fr`, `.jp`, `.au`, `.in`
- New gTLDs: `.cloud`, `.website`, `.online`, `.store`, `.shop`

Not all TLDs are supported. Check the Cloudflare Registrar TLD list for current coverage.

### Auto-Renewal and Expiry Protection

Cloudflare enables auto-renewal by default. If a domain expires:
1. 0-30 days after expiry: domain in "Expired" status, can be renewed at standard price
2. 30-44 days: redemption period — much higher fee to recover
3. 44+ days: domain deleted, available for public registration

Configure renewal settings under Domain Registration → your domain → Auto-renew toggle.

---

## Dashboard Walkthrough

**Step 1: Register a New Domain**
1. Account Home → Domain Registration
2. Click "Register Domains"
3. Search for available domain
4. Select TLD, review price
5. Add to cart and complete registration
6. Domain automatically added to your Cloudflare account as a zone

**Step 2: Transfer an Existing Domain**
1. Account Home → Domain Registration → Transfer Domains
2. Enter domain name
3. Enter auth code from current registrar
4. Pay transfer fee (includes 1 year renewal)
5. Approve/confirm transfer email (sent to registrant email)

**Step 3: Enable DNSSEC for Transferred Domain**
1. Select transferred domain → DNS → DNSSEC
2. Click "Enable DNSSEC"
3. If domain is on Cloudflare Registrar: DS records updated automatically
4. If domain is at another registrar: copy DS record shown and add manually at registrar

**Step 4: Verify WHOIS Privacy**
1. Domain Registration → your domain → WHOIS
2. Confirm privacy is enabled (registrant details hidden)
3. You can view your actual registration data internally

**Step 5: Set Up Auto-Renewal**
1. Domain Registration → your domain → Registration
2. Auto-renew: toggle to enabled
3. Payment method: confirm billing card is on file

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"
```

### Lab 1: List Registered Domains
```bash
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/registrar/domains?per_page=50" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 2: Get Domain Registration Details
```bash
DOMAIN="macksportreport.com"

curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/registrar/domains/${DOMAIN}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 3: Enable Auto-Renewal
```bash
DOMAIN="macksportreport.com"

curl -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/registrar/domains/${DOMAIN}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "auto_renew": true
  }'
```

### Lab 4: Enable DNSSEC
```bash
# Enable DNSSEC for a zone
ZONE_ID="your-zone-id"

curl -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dnssec" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"status": "active"}'

# Verify DNSSEC status
curl "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dnssec" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 5: Verify DNSSEC is Working
```bash
DOMAIN="macksportreport.com"

# Check for DS record in parent zone
dig DS ${DOMAIN} +short

# Verify DNSSEC validation
dig ${DOMAIN} +dnssec +short

# Test with DNSSEC validator
curl "https://dnssec-analyzer.verisignlabs.com/${DOMAIN}" 2>/dev/null | head -20
# Or use: https://dnssec-debugger.verisignlabs.com/

# Check DNSSEC chain
dig +sigchase ${DOMAIN} A @8.8.8.8
```

### Lab 6: Check Domain Expiry
```bash
# List domains and check expiry dates
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/registrar/domains?per_page=50" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for domain in data.get('result', []):
    print(f\"{domain['name']}: expires {domain.get('expires_at', 'N/A')}, auto_renew: {domain.get('auto_renew', False)}\")"
```

---

## Demo Script (2 Minutes)

**Audience:** Any customer who mentions domain renewals, registrar costs, or DNSSEC complexity

**Opening (15 seconds):**
"Where are you registering your domains right now? GoDaddy? What's your renewal price for `.com` each year?"

**Act 1 — Show the pricing (30 seconds):**
"Cloudflare Registrar charges wholesale — the exact price we pay ICANN, with no markup. [Look up current .com price.] About $9.15 for `.com`, every year. Same price at renewal as at registration. No first-year promotional trap. WHOIS privacy is free and automatic — at GoDaddy that's $10/year extra."

**Act 2 — Show DNSSEC automation (40 seconds):**
"Here's the operational advantage that doesn't get talked about enough. [DNS → DNSSEC.] You click Enable. The DS record is added to `.com` automatically — because Cloudflare controls both the DNS and the registrar. At other registrars, you have to manually copy a hash into their control panel, and if Cloudflare rotates the signing key, you have to do it again. Automatic DNSSEC is the feature that saves an incident at 3am."

**Act 3 — One dashboard (20 seconds):**
"And it's the same dashboard. Your domain registration, your DNS records, your WAF, your CDN. One place to look. One support team."

**Close (15 seconds):**
"Transfer is easy — you unlock at your current registrar, give me the auth code, and we handle the rest. It includes one year of renewal. How many domains does your organization manage?"

---

## Competitive Context

| Feature | Cloudflare Registrar | GoDaddy | Namecheap | Google Domains | Porkbun |
|---|---|---|---|---|---|
| **Pricing model** | Wholesale (no markup) | Markup + upsells | Discount but markup | Transparent markup | Low markup |
| **.com renewal price** | ~$9.15/year | ~$19.99/year | ~$14.58/year | Discontinued (→ Squarespace) | ~$9.73/year |
| **WHOIS privacy** | Free, automatic | $10/year add-on | Free | Free | Free |
| **DNSSEC automation** | Yes (with CF DNS) | Manual | Manual | Partially automated | Manual |
| **Platform integration** | Full (DNS, CDN, WAF, etc.) | Add-ons only | Limited | Google services only | None |
| **API availability** | Yes (full REST API) | Yes | Yes | N/A (deprecated) | Yes |
| **UI quality** | Clean, minimal | Complex, upsell-heavy | OK | Clean | Clean |
| **Supported TLDs** | 200+ | 500+ | 400+ | N/A | 400+ |
| **Dark patterns** | None | Many | Some | Few | None |
| **Transfer fee** | 1-year renewal (standard) | $3.99+ add-on | Standard | N/A | Standard |
| **2FA enforcement** | Yes | Optional | Optional | Yes (Google account) | Optional |

**Key positioning:** Cloudflare Registrar is not competing on TLD breadth or the lowest promotional price. It wins on: predictable annual cost (no renewal surprises), DNSSEC automation (critical for security-conscious customers), WHOIS privacy included, and consolidation into one platform. For customers already on Cloudflare, it's the obvious choice for domains.

---

## Self-Check Questions

**Question 1:** Why is Cloudflare Registrar's DNSSEC automation significant compared to other registrars? Describe the manual process at a typical registrar and explain what can go wrong.

```
Your answer:




```

**Question 2:** A customer is paying $19.99/year to renew 50 `.com` domains at GoDaddy. Calculate the annual savings if they transferred all domains to Cloudflare Registrar.

```
Your answer:




```

**Question 3:** Explain the ICANN 60-day transfer lock rule. How does this affect a customer who recently registered a domain and wants to transfer it to Cloudflare immediately?

```
Your answer:




```

**Question 4:** A domain at Cloudflare Registrar expires and the customer doesn't notice for 35 days. What is the status of the domain and what options do they have?

```
Your answer:




```

**Question 5:** What is a WHOIS privacy (privacy guard) service and why do most registrars charge for it? Is there any legal or business reason a customer might need to disable it?

```
Your answer:




```

---

## Sources

- [Cloudflare Registrar Documentation](https://developers.cloudflare.com/registrar/)
- [Cloudflare Registrar Pricing](https://developers.cloudflare.com/registrar/account-options/tld-policies/)
- [DNSSEC with Cloudflare Registrar](https://developers.cloudflare.com/dns/dnssec/)
- [Transferring a Domain to Cloudflare](https://developers.cloudflare.com/registrar/transfer-instructions/)
- [Transferring a Domain Away from Cloudflare](https://developers.cloudflare.com/registrar/transfer-instructions/move-to-another-registrar/)
- [ICANN Domain Transfer Policy](https://www.icann.org/resources/pages/transfer-policy-2016-06-01-en)
- [DNSSEC Chain of Trust (Cloudflare Learning)](https://www.cloudflare.com/learning/dns/dnssec/how-dnssec-works/)
- [Cloudflare Blog: Cloudflare Registrar](https://blog.cloudflare.com/using-cloudflare-registrar/)
