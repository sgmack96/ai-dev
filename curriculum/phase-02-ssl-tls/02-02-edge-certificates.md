# Module 2.2 — Edge Certificates

> **Dashboard Location:** `macksportreport.com` → SSL/TLS → Edge Certificates  
> **Estimated Time:** 60 minutes  
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Are Edge Certificates?

Edge certificates are the TLS certificates that Cloudflare presents to users' browsers when they connect to your site. These are the certificates for **TLS connection #1** (Browser → Cloudflare). Your origin has its own separate cert.

Edge certificates are what:
- Enables the padlock icon in the browser
- Proves to the browser that it's talking to `macksportreport.com`
- Terminates TLS at the Cloudflare edge (nearest PoP to the user)

### Universal SSL (Free)

Every zone on every plan (including Free) gets **Universal SSL** — a certificate automatically provisioned and renewed by Cloudflare.

What Universal SSL covers:
- `macksportreport.com` (apex)
- `*.macksportreport.com` (one level of wildcard)

**Limitations:**
- Only covers one level of subdomain (`www.macksportreport.com` ✓, `api.www.macksportreport.com` ✗)
- Issued by Let's Encrypt or Google Trust Services (not a commercial CA)
- Certificate Authority Authorization (CAA) records must allow these CAs

### Advanced Certificates (Pro+)

Advanced Certificates give you more control:
- **Multi-level subdomains:** `api.v2.macksportreport.com`
- **Certificate Authorities:** Choose DigiCert, Let's Encrypt, or Sectigo
- **Shorter validity periods:** 14-day certificates for higher security
- **Custom SANs (Subject Alternative Names):** Multiple hostnames on one cert

Pricing: ~$10/month/certificate, or part of the Advanced Certificate Manager subscription.

### Custom/Uploaded Certificates (Business+)

You can upload your own certificate to Cloudflare:
- Required when you have a specific CA requirement (e.g., your EV certificate from DigiCert)
- Required when compliance mandates a commercial CA certificate
- You manage renewal (Cloudflare doesn't auto-renew uploaded certs)
- Supports: PEM format, RSA and ECDSA keys

### Certificate Packs

A "certificate pack" is a group of certificates covering the same hostnames but with different algorithms:
- **ECDSA certificate** — Smaller, faster, preferred for modern clients
- **RSA certificate** — Larger, more compatible, needed for older clients (IE on Windows XP)

Cloudflare automatically presents the right algorithm to each client. Both live in the same "pack."

### Certificate Status

| Status | Meaning |
|--------|---------|
| **Active** | Deployed and serving traffic |
| **Pending validation** | Waiting for domain ownership to be verified |
| **Pending issuance** | Verified, waiting for CA to issue |
| **Pending deployment** | Issued, deploying to edge globally |
| **Expired** | Needs renewal (should not happen for managed certs) |
| **Blocked** | CAA record conflict or rate limiting by CA |

### How Certificate Issuance Works (DCV)

For Cloudflare to get a certificate for your domain, it must prove to the CA that you control the domain. This is called Domain Control Validation (DCV):

1. **HTTP-01 validation:** CA checks for a specific token at `http://macksportreport.com/.well-known/acme-challenge/TOKEN`
   - Cloudflare handles this automatically for proxied zones
   
2. **DNS-01 validation:** CA checks for a specific TXT record at `_acme-challenge.macksportreport.com`
   - Cloudflare handles this automatically if it's the authoritative nameserver

3. **TXT record (for partial/CNAME setup):** Manual step required when Cloudflare isn't the nameserver

---

## Deep Dive (Architect-Level)

### Certificate Transparency (CT) Logs

All publicly-trusted certificates must be logged in CT logs (per Google Chrome policy). When Cloudflare issues a Universal SSL cert for `macksportreport.com`, it's logged in:
- Google's Argon/Xenon CT logs
- Cloudflare's Nimbus CT log

This is publicly visible. Attackers use CT log monitoring to:
- Discover new subdomains you've SSL-enabled
- Track when you add new hostnames

Defense: CAA records (restrict which CAs can issue for your domain), and monitor CT logs yourself via [crt.sh](https://crt.sh/).

### Certificate Pinning

HTTP Public Key Pinning (HPKP) was deprecated due to reliability risks. Modern approach is **expect-ct** header and CAA records. Cloudflare exposes cert pinning via:
- Workers — Check `cf.tls_client_auth` for client cert fingerprints
- Custom Hostnames — Certificate pinning for SaaS tenants

### ECDSA vs RSA Deep Dive

| | ECDSA P-256 | RSA-2048 |
|--|-------------|----------|
| **Key size** | 256 bits | 2048 bits |
| **TLS handshake bytes** | ~100 bytes | ~300 bytes |
| **Computation** | Faster | Slower |
| **Compatibility** | IE 8+, Android 4+, modern everything | Everything |
| **Certificate size** | ~1KB | ~2KB |

Cloudflare defaults to ECDSA with RSA fallback. The browser's `ClientHello` TLS handshake says which algorithms it supports, and Cloudflare picks the best match.

### Certificate Renewal Timing

Cloudflare renews managed certificates automatically:
- Let's Encrypt certs: 90-day validity, renewed at ~30 days remaining
- Google Trust Services: 90-day validity, same renewal window
- Advanced certs: configurable validity

If renewal fails (CAA conflict, DNS not propagated), you get a notification. Cert expiry is a common cause of major outages — Cloudflare eliminates this for its managed certs.

---

## Dashboard Walkthrough

### Edge Certificates Page

Navigate to: `macksportreport.com → SSL/TLS → Edge Certificates`

**Certificate list:**
- Shows all certificates active for your zone
- Type (Universal, Advanced, Custom)
- Hostnames covered
- Issuer (Let's Encrypt, DigiCert, etc.)
- Expiry date
- Status

**Universal SSL section:**
- Shows active Universal SSL cert
- Issuer: Let's Encrypt or Google Trust Services
- Hostnames: `macksportreport.com` and `*.macksportreport.com`
- Auto-renews ~30 days before expiry

**Additional Options (bottom of page):**
- **Certificate Revocation List (CRL):** Link to CRL URL
- **OCSP Stapling:** Cloudflare staples OCSP responses to TLS handshakes
- **Always Use HTTPS:** Toggle (same as SSL/TLS Overview)
- **HTTP Strict Transport Security (HSTS):** Configure HSTS policy
- **Minimum TLS Version:** TLS 1.0–1.3 selector
- **Opportunistic Encryption:** Toggle
- **TLS 1.3:** Toggle
- **Automatic HTTPS Rewrites:** Rewrites `http://` links in your HTML to `https://`

---

## Hands-On Lab

### Lab 2.2: Explore and Validate Your Edge Certificates

**Step 1: View your current edge certificates**
```
SSL/TLS → Edge Certificates
```
Record:
- Certificate type: ________________
- Issuer: ________________
- Hostnames covered: ________________
- Expiry date: ________________
- Status: ________________

**Step 2: Verify the certificate from the command line**
```bash
# View certificate presented by Cloudflare edge
echo | openssl s_client -connect macksportreport.com:443 -servername macksportreport.com 2>/dev/null \
  | openssl x509 -text -noout | grep -E "Subject:|Issuer:|Not After|DNS:"

# Output shows:
# Subject: CN=macksportreport.com
# Issuer: O=Let's Encrypt or Google Trust Services
# Not After: [expiry date]
# DNS: macksportreport.com, *.macksportreport.com
```

**Step 3: Check the certificate chain**
```bash
# Verify full chain
echo | openssl s_client -connect macksportreport.com:443 -showcerts 2>/dev/null \
  | grep -E "^(Certificate|subject|issuer|Server)"
```

**Step 4: Check CAA records (prevent unauthorized cert issuance)**
```bash
# Check existing CAA records
dig CAA macksportreport.com +short

# If empty, add CAA records for the CAs Cloudflare uses:
# In DNS → Records → Add record:
# Type: CAA, Name: @, Flags: 0, Tag: issue, Value: "letsencrypt.org"
# Type: CAA, Name: @, Flags: 0, Tag: issue, Value: "pki.goog"  (Google Trust Services)
# Type: CAA, Name: @, Flags: 0, Tag: issuewild, Value: "letsencrypt.org"
```

**Step 5: Enable OCSP Stapling**
```
SSL/TLS → Edge Certificates → OCSP Stapling → On
```

What OCSP stapling does: During the TLS handshake, Cloudflare provides pre-fetched proof that your certificate hasn't been revoked. Without stapling, the browser must make a separate request to the CA's OCSP server — adds latency. With stapling, it's included in the handshake.

**Step 6: Enable Automatic HTTPS Rewrites**
```
SSL/TLS → Edge Certificates → Automatic HTTPS Rewrites → On
```

This rewrites any `http://` links in your HTML body to `https://`. Fixes "mixed content" warnings without code changes.

Verify:
```bash
# Check if Cloudflare is rewriting HTTP references in your page
curl -s https://macksportreport.com | grep -i "http://" | head -20
# Should be empty or only external links that weren't rewritten
```

---

## Demo Script (2 Minutes)

> Use when showing a customer how easy HTTPS is with Cloudflare vs. the old way

"Setting up HTTPS used to be painful — buy a certificate, install it on your server, configure nginx, set up auto-renewal with certbot, hope it doesn't expire at 3am. With Cloudflare, there's nothing to do. We provision a certificate for your domain automatically within minutes of adding your site. We renew it. We deploy it to 330+ data centers globally. Zero ops work.

If you want more control — specific CA, multi-level subdomains, shorter cert validity — you can do that with Advanced Certificates. If you have a compliance requirement to use a specific CA or EV certificate, you can upload your own cert. But for 90% of sites, Universal SSL is all you need and it just works.

One thing that matters more than people realize is OCSP stapling — we handle that automatically too. Without it, every new visitor's browser makes a round-trip to Let's Encrypt to check if your cert is revoked. With stapling, we bundle that proof in the TLS handshake. Faster for users, less load on the CA."

---

## Competitive Context

| Feature | Cloudflare Universal SSL | AWS ACM | Let's Encrypt (DIY) |
|---------|-------------------------|---------|---------------------|
| **Cost** | Free | Free for AWS services | Free |
| **Auto-renewal** | Automatic | Automatic | Requires certbot setup |
| **Multi-SAN/wildcard** | *.domain.com | Yes | Limited (v2 API needed) |
| **ECDSA + RSA** | Both, automatic failover | Configurable | Manual setup |
| **DCV method** | Automatic (CF handles it) | DNS-01 or email | DNS-01 or HTTP-01 |
| **Global deployment** | 330+ PoPs, seconds | CDN edge, minutes | Your server only |
| **OCSP stapling** | Automatic | Automatic | Manual certbot config |
| **EV certificates** | Upload your own | Not supported | Not available |

---

## Self-Check Questions

1. A customer says "our SSL cert expires in 10 days and we're panicking." They're on Cloudflare Universal SSL. What do you tell them?

2. What is OCSP stapling and why does it improve user experience?

3. A customer has an old browser compatibility requirement — must support IE8 on Windows XP. How do you handle this with Cloudflare edge certificates?

4. What's the difference between Universal SSL and Advanced Certificate Manager? When do you need the upgrade?

5. A customer adds a second-level subdomain `api.v2.macksportreport.com`. Universal SSL covers `*.macksportreport.com`. Is this subdomain covered? Why or why not?

---

**Your Answers:**

1. 

2. 

3. 

4. 

5. 

---

**Sources:**
- [Edge Certificates](https://developers.cloudflare.com/ssl/edge-certificates/)
- [Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/)
- [Advanced Certificates](https://developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/)
- [Automatic HTTPS Rewrites](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/automatic-https-rewrites/)
- [OCSP Stapling](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/ssl-tls-recommender/)
- [Certificate Transparency](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/certificate-transparency-monitoring/)
