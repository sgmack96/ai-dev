# Module 2.4 — Origin Server Certificates

> **Dashboard Location:** `macksportreport.com` → SSL/TLS → Origin Server  
> **Estimated Time:** 45 minutes  
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### The Problem This Solves

You're using Full (Strict) SSL mode (correct). Your origin server needs a valid, trusted certificate. You have two options:
1. Get a public certificate from Let's Encrypt — requires a running web server to complete the challenge
2. Use **Cloudflare's Origin CA Certificate** — issued by Cloudflare, works only with Cloudflare, free forever

The Origin CA Certificate is specifically designed for this use case. It's the recommended approach for any origin behind Cloudflare.

### Cloudflare Origin CA Certificate

**What it is:** A certificate issued by Cloudflare's private CA, installed on your origin web server.

**What it enables:** Cloudflare's edge trusts this certificate. When Cloudflare connects to your origin, it validates this cert and accepts it. No browser ever sees this cert — it's only for the Cloudflare-to-origin connection.

**Validity:** Up to 15 years (you choose). No annual renewal headaches.

**What it is NOT:** A publicly-trusted certificate. You cannot use it directly with users' browsers. If Cloudflare is turned off (grey cloud), and users connect directly to your origin, they'll get an "untrusted certificate" error.

**The security tradeoff:** If someone connects directly to your origin IP (bypassing Cloudflare), your certificate isn't public-trusted. But you should be blocking direct-to-origin access anyway via IP allowlisting (only Cloudflare's IPs can reach your origin).

### Authenticated Origin Pulls

Separate from Origin CA, **Authenticated Origin Pulls** (sometimes called "Origin Pull Certificates") ensures that your origin server only accepts connections from Cloudflare — not from random IP addresses pretending to be Cloudflare.

Without Authenticated Origin Pulls:
- Your origin accepts any HTTPS connection
- Attacker who discovers your origin IP can send traffic directly, bypassing Cloudflare's WAF

With Authenticated Origin Pulls:
- Your origin is configured to require the client to present a certificate (mTLS on the Cloudflare→Origin leg)
- Cloudflare presents its certificate when connecting to your origin
- Your origin rejects connections without Cloudflare's cert

Combined with Origin CA + Authenticated Origin Pulls + IP allowlisting = bulletproof origin protection.

---

## Deep Dive (Architect-Level)

### How Origin CA Certificates Work

```
Cloudflare's Origin CA (private, only trusted by CF)
    ↓  issues
Origin CA Certificate (installed on your nginx/Apache/etc.)
    ↓  presented to
Cloudflare Edge (when connecting to origin)
    ↓  validates against its trusted root
Connection established (only if cert is valid)
```

The origin CA certificate contains:
- Your hostname (`macksportreport.com` and/or wildcard `*.macksportreport.com`)
- Validity period (you choose: 7 days to 15 years)
- RSA 2048-bit or ECDSA 256-bit key

### Generating via API (with your own CSR)

For production, generate the private key locally and only send a CSR to Cloudflare:

```bash
# Generate private key locally (NEVER send this to anyone)
openssl genrsa -out origin.key 2048

# Generate Certificate Signing Request
openssl req -new -key origin.key -out origin.csr \
  -subj "/CN=macksportreport.com"

# Add SANs for the CSR
openssl req -new -key origin.key -out origin.csr \
  -config <(cat /etc/ssl/openssl.cnf \
    <(printf "[SAN]\nsubjectAltName=DNS:macksportreport.com,DNS:*.macksportreport.com"))

# Submit CSR to Cloudflare
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/origin_tls_client_auth" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{
    \"csr\": \"$(cat origin.csr | tr '\n' '|' | sed 's/|/\\n/g')\",
    \"hostnames\": [\"macksportreport.com\", \"*.macksportreport.com\"],
    \"request_type\": \"origin-rsa\",
    \"requested_validity\": 5475
  }"
```

Cloudflare signs the CSR and returns the certificate. You keep the private key.

### Configuring Origin Server

**nginx:**
```nginx
server {
    listen 443 ssl;
    server_name macksportreport.com;

    # Origin CA certificate from Cloudflare
    ssl_certificate /etc/ssl/cloudflare-origin.crt;
    ssl_certificate_key /etc/ssl/origin.key;

    # For Authenticated Origin Pulls:
    ssl_client_certificate /etc/ssl/cloudflare-authenticated-origin-pull-ca.pem;
    ssl_verify_client on;
    
    location / {
        # your app
    }
}
```

**Apache:**
```apache
<VirtualHost *:443>
    ServerName macksportreport.com
    
    SSLEngine on
    SSLCertificateFile /etc/ssl/cloudflare-origin.crt
    SSLCertificateKeyFile /etc/ssl/origin.key
    
    # Authenticated Origin Pulls
    SSLCACertificateFile /etc/ssl/cloudflare-authenticated-origin-pull-ca.pem
    SSLVerifyClient require
    SSLVerifyDepth 1
</VirtualHost>
```

### Cloudflare's Authenticated Origin Pull Certificate

Download Cloudflare's certificate that it presents to your origin:
```bash
curl -o cloudflare-authenticated-origin-pull-ca.pem \
  https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem
```

Install this on your origin as the trusted CA for client authentication. Your origin will only accept connections where the client presents a cert signed by this CA (i.e., Cloudflare's edge).

---

## Dashboard Walkthrough

### Origin Server Page

Navigate to: `macksportreport.com → SSL/TLS → Origin Server`

**Create Certificate section:**
- Private key type: RSA (2048) or ECDSA (256) — ECDSA is faster
- Hostnames: pre-filled with your zone hostnames
- Certificate validity: 1 week, 1 month, 3 months, 1 year, 2 years, 15 years
- Click **Create Certificate**
- Download: Certificate (PEM) and Private Key (PEM)

> Download the private key immediately — not stored by Cloudflare.

**Authenticated Origin Pulls section:**
- Toggle to enable/disable
- When enabled, Cloudflare presents its cert to your origin during connection
- Your origin must be configured to require this cert (nginx ssl_verify_client)

**Existing Certificates list:**
- Shows all origin CA certs you've created
- Certificate ID, expiry, status
- Revoke button

---

## Hands-On Lab

### Lab 2.4: Issue and Install an Origin CA Certificate

**Step 1: Create an Origin CA certificate via dashboard**
```
SSL/TLS → Origin Server → Create Certificate
→ Key type: RSA 2048
→ Hostnames: macksportreport.com, *.macksportreport.com
→ Validity: 15 years (maximum — avoids renewal)
→ Create
```

Download:
- `cert.pem` (the certificate)
- `key.pem` (private key)

**Step 2: Verify the certificate you received**
```bash
openssl x509 -in cert.pem -text -noout | grep -E "Issuer:|Subject:|Not After:|DNS:"
# Issuer should say: Cloudflare
# Subject should say your domain
# Not After: 15 years from now
```

**Step 3: Install on your origin server**

For a Cloudflare Worker-based origin, this isn't needed.
For a VPS/cloud server:
```bash
# Copy to your server
scp cert.pem user@your-origin:/etc/ssl/cloudflare-origin.crt
scp key.pem user@your-origin:/etc/ssl/cloudflare-origin.key

# On the server, configure nginx
sudo nano /etc/nginx/sites-available/macksportreport.com
# Add ssl_certificate and ssl_certificate_key directives
sudo nginx -t && sudo systemctl reload nginx
```

**Step 4: Enable Full (Strict) SSL mode and verify**
```
SSL/TLS → Overview → Full (Strict)
```

Test immediately:
```bash
curl -I https://macksportreport.com
# Should return 200 (or 301) with cf-ray header
# If you get 521/525 errors, origin cert is not installed correctly
```

**Step 5: Enable Authenticated Origin Pulls**
```
SSL/TLS → Origin Server → Authenticated Origin Pulls → On
```

Download Cloudflare's pull cert:
```bash
curl -O https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem

# Install on nginx (add to server block):
# ssl_client_certificate /path/to/authenticated_origin_pull_ca.pem;
# ssl_verify_client on;
```

**Step 6: Block direct-to-origin requests (IP allowlist)**
```bash
# On your origin server's firewall, only allow Cloudflare's IP ranges
# Get current Cloudflare IPs
curl -s https://api.cloudflare.com/client/v4/ips | jq '.result'

# Set firewall rules to ONLY allow these ranges on port 443
# All other source IPs: DROP
```

---

## Demo Script (2 Minutes)

> Use when explaining origin security to a developer or security-conscious customer

"There's a common vulnerability I see all the time: a customer puts Cloudflare in front of their site, gets the WAF protecting them, and thinks they're secure. But their origin IP leaked via CT logs or a misconfigured subdomain. An attacker queries that IP directly and bypasses Cloudflare entirely — all that WAF protection is useless.

Here's how to properly lock this down in three steps. First, use an Origin CA certificate — free, valid for 15 years, Cloudflare trusts it. Enables Full Strict mode which means the Cloudflare-to-origin connection is properly encrypted and validated. Second, enable Authenticated Origin Pulls — Cloudflare presents its own certificate to your origin, so your origin only accepts connections from Cloudflare. Third, IP allowlist your firewall — only Cloudflare's published IP ranges can hit port 443.

Now an attacker who knows your origin IP still can't bypass you. They'd need Cloudflare's private key, which they don't have. Your origin is truly protected."

---

## Competitive Context

| Feature | Cloudflare Origin CA | Let's Encrypt on Origin | Commercial CA on Origin |
|---------|---------------------|------------------------|------------------------|
| **Cost** | Free | Free | $50-$3000/year |
| **Validity** | Up to 15 years | 90 days | 1-2 years |
| **Auto-renewal** | N/A (long-lived) | Certbot required | Manual |
| **Publicly trusted** | No (CF only) | Yes | Yes |
| **Authenticated pulls** | Yes | No | No |
| **Operations burden** | None | certbot + cron | Annual renewal ops |
| **Security model** | Cloudflare-only trust | Public trust (risk if CF disabled) | Public trust |

---

## Self-Check Questions

1. Can you use a Cloudflare Origin CA certificate directly in a user's browser if Cloudflare is disabled? Why or why not?

2. What is "Authenticated Origin Pulls" and how does it work differently from just having an HTTPS origin?

3. A customer is on Full (non-strict) SSL mode and asks why they should upgrade to Full Strict. What's the specific attack vector you're protecting against?

4. The Origin CA certificate is valid for 15 years. What happens to it if you remove the domain from Cloudflare?

5. Walk through all three layers of origin protection in the correct order of implementation.

---

**Your Answers:**

1. 

2. 

3. 

4. 

5. 

---

**Sources:**
- [Origin CA Certificates](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)
- [Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)
- [Cloudflare IP Ranges](https://www.cloudflare.com/ips/)
- [SSL Error Codes](https://developers.cloudflare.com/support/troubleshooting/cloudflare-errors/troubleshooting-cloudflare-5xx-errors/)
- [Cloudflare Authenticated Origin Pull CA PEM](https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem)
