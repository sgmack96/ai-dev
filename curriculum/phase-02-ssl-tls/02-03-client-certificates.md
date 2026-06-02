# Module 2.3 — Client Certificates (mTLS)

> **Dashboard Location:** `macksportreport.com` → SSL/TLS → Client Certificates  
> **Estimated Time:** 60 minutes  
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### Standard TLS vs mTLS

In standard TLS:
- **Server** presents a certificate → **Client** (browser) validates it
- One-way authentication: the user knows they're talking to the real server

In **mTLS (mutual TLS)**:
- **Server** presents a certificate → **Client** validates it ✓
- **Client** ALSO presents a certificate → **Server** validates it ✓
- Two-way authentication: the server ALSO knows exactly who the client is

```
Browser/Device                    Cloudflare Edge
    |── "Hello, I'm macksportreport.com user" ──→|
    |← "Here's my cert (edge cert)"              |
    |── "Here's MY cert (client cert)"            |
    |← "Your cert is valid. Connection open"     |
```

### When to Use mTLS

mTLS is for **machine-to-machine authentication** where you control both ends:

1. **IoT devices** — A fleet of sensors that should only talk to your API
2. **Mobile apps** — App is the only authorized client for your backend API
3. **Internal services** — Microservices that must authenticate to each other
4. **B2B API access** — A partner's system connecting to your API

**What mTLS is NOT for:** Regular browser users visiting your website. Browsers don't have client certificates installed by default.

### Cloudflare Client Certificates

Cloudflare's mTLS implementation uses:
1. **Cloudflare's CA (Certificate Authority)** — Cloudflare acts as the CA and issues client certificates
2. **Client certificate installation** — Install on devices, in apps, or in automation scripts
3. **API Shield policy** — Cloudflare blocks requests that don't present a valid client certificate

Cloudflare is the **private CA** — certificates it issues are trusted by Cloudflare's edge, but not by browsers as a public CA. This is the correct design for mTLS.

### API Shield

Client certificates integrate with **API Shield**, Cloudflare's API security product:
- **mTLS enforcement** — Reject requests without valid client certs
- **Schema validation** — Validate request body against OpenAPI schema
- **Sequence enforcement** — Detect API endpoint call sequences that indicate bots
- **Rate limiting** — Per-client or per-endpoint limits

For a startup, the immediate value is using client certs + mTLS to lock down your API so only your known clients (app, automation) can reach it.

---

## Deep Dive (Architect-Level)

### How Cloudflare CA Works for mTLS

```
Cloudflare CA (private)
    ↓  issues
Client Certificate (on your device/app)
    ↓  presented during TLS handshake
Cloudflare Edge validates against CA
    ↓  passes if valid, blocks if invalid/absent
Your Origin receives traffic
```

Cloudflare maintains the CA internally. You create client certificates via API or dashboard. Each certificate:
- Has a unique serial number
- Contains the hostname it's valid for
- Has an expiry (configurable: 1 week to 10 years)
- Can be revoked via API instantly

### Certificate Revocation

If a device is compromised:
1. Revoke the certificate via API: `DELETE /zones/{zone_id}/client_certificates/{client_cert_id}`
2. Cloudflare's edge stops accepting that certificate within seconds
3. The device/attacker can no longer authenticate

This is far faster than traditional CA revocation (CRL, OCSP) because Cloudflare controls the entire chain.

### The Mutual TLS Headers

When a valid client certificate is presented, Cloudflare adds headers to the forwarded request to your origin:
```
Cf-Client-Cert-Issuer: CN=Cloudflare...
Cf-Client-Cert-Subject: CN=your-device-name
Cf-Client-Cert-Serial: ABC123...
Cf-Client-Cert-Fingerprint: SHA256:...
Cf-Client-Cert-Verified: SUCCESS (or FAILED)
```

Your origin can use these headers for additional logic (e.g., different behavior based on which client cert is presented).

### mTLS in Practice (Python Example)

```python
import requests

# Client presents its certificate to the server
response = requests.get(
    "https://api.macksportreport.com/data",
    cert=("/path/to/client.crt", "/path/to/client.key"),
    verify=True  # Verify server cert (normal TLS validation)
)
print(response.json())
```

```bash
# curl with client cert
curl https://api.macksportreport.com/data \
  --cert client.crt \
  --key client.key
```

### Pinning to Cloudflare's CA

For maximum security, configure your clients to only trust Cloudflare's CA (not the global CA bundle):
```python
response = requests.get(
    "https://api.macksportreport.com/data",
    cert=("client.crt", "client.key"),
    verify="/path/to/cloudflare-ca.pem"  # Only trust CF's CA
)
```

---

## Dashboard Walkthrough

### Client Certificates Page

Navigate to: `macksportreport.com → SSL/TLS → Client Certificates`

**Existing certificates list:**
- Shows all client certificates you've issued
- Certificate ID, hostname, expiry, status (active/revoked)

**Create Certificate button:**
1. Click **Create Certificate**
2. Enter hostname: `macksportreport.com` or `api.macksportreport.com`
3. Set validity: 1 week to 10 years
4. Click **Create**
5. Download: Certificate (PEM) and Private Key (PEM)

> **Important:** Download the private key immediately — Cloudflare does NOT store it. If you lose it, you must revoke and re-issue.

**Revoking a certificate:**
- Click the kebab menu (⋮) next to a certificate
- Select **Revoke**
- Confirm
- Takes effect globally within seconds

### Enabling mTLS Enforcement

After creating client certs, enforce them via API Shield or WAF rules:

**Via API Shield:**
```
Security → API Shield → mTLS → Enable → Select hostnames to enforce
```

**Via WAF Custom Rule:**
```
Security → Security Rules → Create Rule
IF: (http.host eq "api.macksportreport.com") AND (not cf.tls_client_auth.cert_verified)
THEN: Block
```

---

## Hands-On Lab

### Lab 2.3: Issue and Test a Client Certificate

**Step 1: Create a client certificate via the API**
```bash
# Create a client certificate valid for 365 days
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/client_certificates" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "csr": null,
    "validity_days": 365,
    "requested_validity": 365
  }' | tee client-cert-response.json | jq '{
    id: .result.id,
    status: .result.status,
    expires: .result.expires_on
  }'
```

**Step 2: Extract and save the certificate and key**
```bash
# Extract the certificate
cat client-cert-response.json | jq -r '.result.certificate' > client.crt
# Extract the private key
cat client-cert-response.json | jq -r '.result.private_key' > client.key

# Verify the cert
openssl x509 -in client.crt -text -noout | grep -E "Subject:|Issuer:|Not After"
```

**Step 3: Test connection WITH the client certificate**
```bash
curl -v https://macksportreport.com \
  --cert client.crt \
  --key client.key \
  2>&1 | grep -E "subject|issuer|SSL|TLS|Connected"
```

**Step 4: Create a WAF rule to block requests without client certs on a specific path**
```
Security → Security Rules → Create Rule:

Name: "Require mTLS for /api"
When: (http.request.uri.path matches "^/api/") AND (not cf.tls_client_auth.cert_verified)
Then: Block (403)
```

**Step 5: Test enforcement**
```bash
# Without client cert (should be blocked if rule is active)
curl -I https://macksportreport.com/api/test
# Expected: 403 Forbidden

# With client cert (should pass)
curl -I https://macksportreport.com/api/test \
  --cert client.crt \
  --key client.key
# Expected: 200 or whatever your origin returns
```

**Step 6: List and revoke the test certificate**
```bash
# List client certificates
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/client_certificates" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '.result[] | {id, status, expires_on}'

# Revoke the test cert (replace CERT_ID)
CERT_ID=$(cat client-cert-response.json | jq -r '.result.id')
curl -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/client_certificates/$CERT_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"status": "revoked"}'
```

---

## Demo Script (2 Minutes)

> Use when talking to a customer with an API or IoT use case

"Most API security is 'API keys in a header' — if an attacker steals the key, they have full access. mTLS is fundamentally different. It's not about what you *know* (a key), it's about what you *have* (a cryptographic certificate). 

Here's how it works: I issue a certificate to your mobile app or IoT device. That certificate is the identity of that specific device or app instance. When it connects to your API, Cloudflare validates the certificate before the request ever reaches your backend. No certificate? Blocked at the edge — doesn't even touch your infrastructure.

If a device is compromised, I revoke the certificate via one API call and it stops working within seconds globally. No key rotation, no redeployment. That's the operational advantage over API keys."

---

## Competitive Context

| Feature | Cloudflare mTLS | AWS API Gateway mTLS | nginx mTLS |
|---------|----------------|----------------------|------------|
| **CA management** | Cloudflare is CA, managed for you | You bring your own CA | You are the CA |
| **Certificate issuance** | API or dashboard | Manual CA operations | Manual |
| **Revocation speed** | Seconds (global) | Minutes (deploy) | Requires restart |
| **Edge enforcement** | Yes (before origin) | At API Gateway | At origin only |
| **Header forwarding** | Automatic CF headers | Custom authorizer needed | Manual |
| **WAF integration** | Native | Separate WAF service | Separate |
| **Cost** | Free | Included in API Gateway | Free (ops cost) |

---

## Self-Check Questions

1. What's the fundamental security difference between API key authentication and mTLS?

2. A customer has 10,000 IoT sensors. One sensor is compromised. Walk through the steps to cut off that sensor's access immediately.

3. What happens to the private key when you create a client certificate in the Cloudflare dashboard? What should you do immediately?

4. How do you enforce mTLS on only specific paths (e.g., `/api/*`) but not on the main website?

5. A developer asks "why can't my browser use the client certificate to access the API during testing?" What do you tell them?

---

**Your Answers:**

1. 

2. 

3. 

4. 

5. 

---

**Sources:**
- [Client Certificates](https://developers.cloudflare.com/ssl/client-certificates/)
- [mTLS Setup](https://developers.cloudflare.com/api-shield/security/mtls/)
- [API Shield](https://developers.cloudflare.com/api-shield/)
- [WAF Rules for mTLS](https://developers.cloudflare.com/ssl/client-certificates/configure-your-mobile-app-or-iot-device/)
- [Cloudflare CA](https://developers.cloudflare.com/ssl/client-certificates/create-a-client-certificate/)
