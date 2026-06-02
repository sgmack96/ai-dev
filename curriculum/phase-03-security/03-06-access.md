# Module 3.6 — Access (Zero Trust at Zone Level)
> Dashboard Location: macksportreport.com → Security → Access | Estimated Time: 2 hours | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is Cloudflare Access?

Cloudflare Access is an identity-aware reverse proxy — it sits between users and your web applications, enforcing authentication and authorization before any request reaches your application.

**The core value proposition:**
Traditional VPN model:
1. User connects to VPN
2. User now has network-level access to everything on the corporate network
3. If user is compromised (phishing, malware), attacker has network access too

Cloudflare Access model:
1. User requests access to a specific application (e.g., staging.macksportreport.com)
2. Access checks: Who is this user? (Identity)
3. Access checks: Is this user allowed to access THIS application? (Policy)
4. If yes: user gets access to that specific application only
5. If compromised: attacker can only access what that user was allowed to access — not the whole network

This is **Zero Trust Network Access (ZTNA)** — the principle that no user or device is trusted by default, even if they're inside your network perimeter.

### How Access Appears at the Zone Level

When you navigate to macksportreport.com → Security → Access in the Cloudflare dashboard, you see a simplified view of Access that lets you:
- Create and manage Access Applications for that specific zone
- View access logs for the zone's protected applications
- Quick-configure protection for subdomains

The **full** Cloudflare Access/Zero Trust configuration lives at:
- one.dash.cloudflare.com → Zero Trust → Access

The zone-level view is a focused entry point for zone administrators. Full Zero Trust configuration (identity providers, device posture rules, network connectors, tunnel configuration) requires the Zero Trust dashboard.

### Application Types

**Self-Hosted Applications**
Web applications running on your own infrastructure (servers, containers, VMs).

How it works:
1. User navigates to `staging.macksportreport.com`
2. Cloudflare Access intercepts the request (via Cloudflare proxying)
3. Access checks authentication (is there a valid Access JWT cookie?)
4. If not authenticated: redirects to your configured identity provider login
5. After successful authentication: Access issues a JWT, user is redirected back
6. Access validates JWT on every subsequent request
7. Application receives the user's identity via injected HTTP headers

**SaaS Applications**
Third-party SaaS applications that support SAML 2.0 or OIDC for SSO.

How it works:
- Cloudflare Access acts as an Identity Provider (IdP)
- Your SaaS app (Salesforce, GitHub, Jira) sends SAML/OIDC authentication requests to Access
- Access handles authentication via your upstream IdP (Google Workspace, Okta, etc.)
- SaaS app receives authenticated SAML assertion from Access

**SSH/RDP Applications (Short-Lived Certificates)**
Server access without exposing SSH/RDP ports to the internet.

How it works:
1. User authenticates to Cloudflare Access
2. Access issues a short-lived SSH/RDP certificate signed by Access's CA
3. User's SSH client uses this certificate to authenticate to the server
4. Server (running cloudflared) validates the certificate
5. No permanent SSH keys needed; no open ports to the internet
6. Certificate expires (default: 5 minutes) — attacker with stolen session can't pivot to servers

**Browser-Rendered Applications**
Used for RDP, VNC, or any other protocol — rendered in the browser via Cloudflare's browser isolation technology.

### Access Policies

An Access Policy is a set of rules that determine who can access an application. Policies have three components:

**Policy Action:**
- **Allow** — Grant access if the user matches the rules
- **Block** — Deny access even if other criteria match
- **Bypass** — Skip Access authentication entirely for matching users (use with caution)
- **Service Auth** — Authenticate machine-to-machine requests via service tokens

**Policy Rules:**
Rules define who the policy applies to. Each rule contains:
- **Selector** (what type of identity attribute to check)
- **Value** (the specific value to match)

**Selectors available:**

| Selector | Example Values | Description |
|----------|---------------|-------------|
| Emails | bob@company.com | Specific email addresses |
| Email domain | @macksportreport.com | Entire email domain |
| Everyone | — | Any authenticated user |
| Country | US, UK, CA | GeoIP-based country |
| IP ranges | 10.0.0.0/8 | Source IP CIDR |
| Identity provider group | Admins, Engineering | Group from IdP |
| Certificate | (thumbprint) | Client certificate |
| Device posture | Device meets requirements | MDM/posture check |
| Access group | (group name) | Reusable group defined in Access |
| Common name | CN from cert | Certificate common name |
| Service token | (token name) | Machine-to-machine token |
| Warp | — | User connected via Cloudflare WARP client |

### Policy Rule Logic: Include, Exclude, Require

Each policy has three rule sections:

**Include:** At least one of these rules must match (OR logic)
```
Include: Email domain = @macksportreport.com
         OR Email = contractor@external.com
```
(Any internal email OR this one specific external contractor)

**Exclude:** None of these rules can match (AND NOT logic)
```
Exclude: Country = North Korea
```
(Even if you have a valid email, you can't access from NK)

**Require:** ALL of these rules must match (AND logic)
```
Require: Country = US
         AND Device posture = MDM enrolled
```
(Must be in the US AND must be on an MDM-enrolled device)

**Combining all three:**
```
Allow access IF:
  Include: (Email domain = @macksportreport.com) AND
  Not Exclude: (Country = CN) AND
  Require: (WARP connected = true) AND (Device posture = OS updated)
```

This creates fine-grained access control: only macksportreport.com emails, not from China, and only if the WARP client is connected and device is up to date.

### Identity Providers Supported

Cloudflare Access supports connecting to virtually any modern identity provider:

| Provider | Protocol | Notes |
|----------|----------|-------|
| **Google Workspace** | OIDC | Most common; uses Google OAuth |
| **Microsoft Azure AD** | OIDC / SAML | Enterprise staple; supports MFA |
| **Okta** | OIDC / SAML | Common in mid-market/enterprise |
| **GitHub** | OAuth | Developer-focused; great for internal tools |
| **GitLab** | OIDC | Developer-focused |
| **LinkedIn** | OAuth | Less common but supported |
| **Facebook** | OAuth | Consumer use cases |
| **SAML 2.0 (generic)** | SAML | Any IdP that speaks SAML |
| **OIDC (generic)** | OIDC | Any IdP that speaks OIDC |
| **Cloudflare One (WARP)** | Device-based | Authenticate by device posture |
| **OTP (One-Time PIN)** | Email OTP | No external IdP — email-based OTP |
| **Certificate** | mTLS | Client certificates |

**Configuring an IdP:**
1. Zero Trust Dashboard → Settings → Authentication → Add new provider
2. Select provider type
3. Configure client ID + client secret from the IdP
4. Add the Cloudflare callback URL to the IdP's allowed redirect URIs

### Access Tokens and JWT Validation

When a user successfully authenticates through Access, Cloudflare:
1. Issues a **CF_Authorization** JWT cookie (short expiry — default 24 hours)
2. Issues a **CF_Authorization_refresh** cookie for token refresh
3. Injects headers into every request reaching your origin:
   - `Cf-Access-Authenticated-User-Email: user@company.com`
   - `Cf-Access-Jwt-Assertion: <jwt_token>`

**Your application can:**
- Trust the injected headers without doing its own authentication (Cloudflare already validated identity)
- Validate the JWT itself for extra assurance (verify signature using Cloudflare's public key)

**JWT validation (for applications that need it):**
```bash
# Get the public key for JWT validation
curl -s "https://macksportreport.cloudflareaccess.com/cdn-cgi/access/certs" | python3 -m json.tool

# The JWT payload contains:
# {
#   "aud": ["<application_audience_tag>"],
#   "email": "user@macksportreport.com",
#   "iat": 1685000000,
#   "nbf": 1685000000,
#   "exp": 1685086400,
#   "sub": "<user_identifier>",
#   "iss": "https://macksportreport.cloudflareaccess.com",
#   "type": "app",
#   "identity_nonce": "...",
#   "custom": {"groups": ["admin", "engineering"]}
# }
```

**Python JWT validation example:**
```python
import jwt
import requests

def validate_access_token(token: str, audience: str, team_domain: str) -> dict:
    """Validate a Cloudflare Access JWT token."""
    # Fetch public keys from Cloudflare
    certs_url = f"https://{team_domain}.cloudflareaccess.com/cdn-cgi/access/certs"
    keys_response = requests.get(certs_url)
    public_keys = keys_response.json().get("public_cert", {}).get("cert", "")
    
    # Decode and validate the token
    try:
        payload = jwt.decode(
            token,
            public_keys,
            algorithms=["RS256"],
            audience=audience
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise Exception("Token has expired")
    except jwt.InvalidAudienceError:
        raise Exception("Token audience does not match")
    except jwt.DecodeError:
        raise Exception("Token is invalid")
```

### Service Tokens (Machine-to-Machine)

Service tokens allow automated systems (CI/CD pipelines, monitoring, internal services) to authenticate to Access-protected applications without a human login flow.

**How service tokens work:**
1. Create a service token in Zero Trust → Access → Service Auth → Service Tokens
2. Receive a `CF-Access-Client-Id` and `CF-Access-Client-Secret`
3. Include both headers in automated requests:
   ```
   CF-Access-Client-Id: your_client_id
   CF-Access-Client-Secret: your_client_secret
   ```
4. Access validates the token and grants access without redirecting to an IdP

**Use cases:**
- CI/CD pipeline accessing a staging environment protected by Access
- Monitoring service checking an internal health endpoint
- Microservice-to-microservice authentication
- API clients that can't do browser-based OAuth flows

### Audit Logs

Cloudflare Access logs every authentication event:
- Who (email, identity provider)
- What (which application they accessed)
- When (timestamp)
- Where (IP address, country)
- Whether access was allowed or denied

**Accessing audit logs:**
- Zero Trust → Logs → Access
- Filter by user email, application, action, date range

**Logpush for Access logs:**
Enterprise customers can stream Access audit logs to:
- S3/R2/GCS for long-term retention
- Splunk/Datadog for SIEM integration
- Sumo Logic / New Relic

### Access vs WAF IP Rules: When to Use Each

This is a critical SE conversation — customers often try to solve the wrong problem with the wrong tool.

| Scenario | Right Tool | Why |
|----------|-----------|-----|
| Protect admin panel from unauthorized users | **Access** | Identity-based control; auditable; no IP guessing |
| Block a known attack IP | **WAF Custom Rule** | IP-based, no auth needed, happens before Access |
| Allow only company employees to access staging | **Access** | Employee email domain policy; IdP-integrated |
| Block all traffic from a specific country | **WAF Custom Rule** | Network-level, no identity context needed |
| Give a contractor temporary access to an internal tool | **Access** | Time-limited policy, auditable, revokable |
| Block a known vulnerability scanner | **WAF Custom Rule** | Pattern-based, not identity-based |
| Enforce MFA for admin access | **Access** | Only Access can enforce IdP-level MFA |
| Rate limit an API endpoint | **WAF Rate Limiting** | Threshold-based, not identity-based |

**Rule of thumb:**
- **Identity matters** → Use Access
- **Network/traffic pattern matters** → Use WAF

---

## Deep Dive (Architect-Level)

### Zero Trust Architecture — How Access Works Under the Hood

```
User → Browser → Cloudflare Edge
                      ↓
            Access Check:
            1. Does request have valid CF_Authorization cookie?
            2. If yes: validate JWT, check audience tag
            3. If no: redirect to <team>.cloudflareaccess.com/cdn-cgi/access/login
                          ↓
              Identity Provider (Google/Okta/Azure)
              User authenticates with IdP
              IdP returns OIDC/SAML assertion to Access
              Access issues CF_Authorization JWT cookie
              Redirect back to original URL
                          ↓
            4. Policy evaluation:
               - Does user email match Include rules?
               - Does user NOT match Exclude rules?
               - Does user meet all Require conditions?
            5. If policy passes: forward request to origin
               - Inject Cf-Access-Authenticated-User-Email header
               - Inject Cf-Access-Jwt-Assertion header
            6. If policy fails: return 403
```

### Access and Cloudflare Tunnel (formerly Argo Tunnel)

Access is most powerful when combined with **Cloudflare Tunnel** (cloudflared). Tunnel creates an outbound-only connection from your server to Cloudflare — no inbound firewall rules needed.

**Architecture:**
```
Origin Server (cloudflared running)
      ↓
Outbound QUIC/HTTP2 connection to Cloudflare edge
      ↓
Cloudflare Edge (reverse proxies through this tunnel)
      ↓
Access (authentication enforcement)
      ↓
Public Internet (users access via Cloudflare DNS)
```

**Why this matters:**
- No open inbound ports — firewall can block ALL inbound traffic
- Origin server IP is never exposed to the internet
- Even if attackers know the origin IP, they can't reach it directly
- Access authentication is enforced BEFORE traffic reaches origin

**Setting up Cloudflare Tunnel:**
```bash
# Install cloudflared on your server
brew install cloudflared  # macOS
# OR
curl -L --output cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared.deb  # Ubuntu/Debian

# Authenticate with your Cloudflare account
cloudflared tunnel login

# Create a tunnel
cloudflared tunnel create macksportreport-origin

# Configure the tunnel (config.yml)
cat > ~/.cloudflared/config.yml << EOF
tunnel: <tunnel-uuid>
credentials-file: /root/.cloudflared/<tunnel-uuid>.json

ingress:
  - hostname: staging.macksportreport.com
    service: http://localhost:3000
  - hostname: admin.macksportreport.com
    service: http://localhost:8080
  - service: http_status:404
EOF

# Create DNS route for the tunnel
cloudflared tunnel route dns macksportreport-origin staging.macksportreport.com
cloudflared tunnel route dns macksportreport-origin admin.macksportreport.com

# Run the tunnel
cloudflared tunnel run macksportreport-origin
```

### SSH Over Access

Access for SSH creates a zero-trust SSH access pattern — no open port 22 needed.

```bash
# On the server: run cloudflared to expose SSH
cloudflared tunnel create ssh-access-tunnel
cloudflared access ssh --hostname ssh.macksportreport.com

# On the developer machine: configure SSH to go through Access
# Add to ~/.ssh/config:
cat >> ~/.ssh/config << EOF
Host ssh.macksportreport.com
  ProxyCommand /usr/local/bin/cloudflared access ssh --hostname %h
EOF

# Developer connects — Access authenticates them first
ssh user@ssh.macksportreport.com
# This opens a browser window to authenticate with your IdP
# After authentication, SSH session is established through the Access-validated tunnel
```

### JWT Audience Tag and Application Security

Each Access application has a unique **Audience (AUD) tag** — a 64-character hex string. This is used in JWT validation.

**Why it matters:**
Without audience validation, a JWT issued for Application A could be replayed against Application B. The AUD tag ensures JWTs are only valid for the application they were issued for.

**Finding the audience tag:**
1. Zero Trust → Access → Applications → click the application
2. Under "Settings" → find "Application Audience (AUD) Tag"
3. Or via API: `GET /accounts/{account_id}/access/apps` → `aud` field

### Access Policies via API

```bash
# List all Access applications for a zone
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/access/apps" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -m json.tool

# Create an Access application protecting /admin path
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/access/apps" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin Panel",
    "domain": "macksportreport.com/admin",
    "type": "self_hosted",
    "session_duration": "24h",
    "auto_redirect_to_identity": true,
    "allow_authenticate_via_warp": false,
    "enable_binding_cookie": true,
    "http_only_cookie_attribute": true,
    "same_site_cookie_attribute": "lax",
    "logo_url": "https://macksportreport.com/logo.png",
    "app_launcher_visible": true
  }'

# Create a policy for the application (replace APP_ID with returned ID)
APP_ID="your_app_id"
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/access/apps/${APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Allow macksportreport.com staff",
    "decision": "allow",
    "precedence": 1,
    "include": [
      {
        "email_domain": {"domain": "macksportreport.com"}
      }
    ],
    "exclude": [
      {
        "country": {"country_code": "CN"}
      }
    ],
    "require": []
  }'
```

### Device Posture Integration

Access can require that devices meet specific security posture requirements before granting access:

**Posture checks available:**
- **OS version** — require Windows 11+, macOS 14+
- **Disk encryption** — FileVault, BitLocker must be enabled
- **Firewall** — OS firewall must be active
- **Carbon Black / CrowdStrike / SentinelOne** — EDR agent must be present and running
- **WARP client** — Cloudflare WARP must be connected (verifies the device is managed)
- **Serial number** — Specific device serial numbers (allowlist)
- **Domain joined** — Device must be domain-joined (Active Directory)
- **Certificate** — Device must have a specific client certificate

**How posture checks work:**
1. User installs Cloudflare WARP client on their device
2. WARP collects device health signals and reports to Cloudflare
3. When user authenticates with Access, posture data is included
4. Policy with posture requirement evaluates the current device state
5. If device fails posture check, access is denied regardless of identity

### Zero Trust vs VPN — The Core Argument

This is the most important competitive conversation for Access deals:

| Dimension | VPN | Cloudflare Access (ZTNA) |
|-----------|-----|--------------------------|
| **Access model** | Network access | Application access |
| **Attack surface** | Entire internal network | Only the specific app |
| **Lateral movement risk** | High (once in VPN, can access anything) | Minimal (can only access allowed apps) |
| **Authentication** | VPN credentials + optional MFA | IdP (Google/Okta/Azure) + MFA |
| **Auditability** | Limited (IP logs only) | Full audit: who accessed what, when |
| **User experience** | Slow (tunnel overhead), friction | Fast (edge-delivered), low friction |
| **Device requirements** | VPN client required | Browser (WARP optional) |
| **Global performance** | VPN server is a bottleneck | Cloudflare's 330+ PoP network |
| **Scaling** | VPN concentrator scaling cost | Cloudflare scales automatically |
| **Remote work** | Works but poor UX | Designed for remote-first |
| **Third-party access** | Must provision VPN credentials | Email-based policy; no VPN account needed |
| **Setup complexity** | Weeks for enterprise VPN | Hours for Access |
| **Cost** | VPN hardware/software/maintenance | SaaS — no infrastructure |

**The killer argument for startups:**
"Your contractors and partners don't need a VPN account. You just add their email to an Access policy. They go to the URL, Google authenticates them, and they're in. When the engagement ends, remove them from the policy. Done. No VPN credential management."

---

## Dashboard Walkthrough

### Navigating to Access at Zone Level

1. dash.cloudflare.com → macksportreport.com → Security → **Access**
2. You see a summary of Access applications protecting this zone
3. "Open in Zero Trust" button takes you to one.dash.cloudflare.com for full configuration

### Full Zero Trust Dashboard

For complete Access configuration:
1. Navigate to **one.dash.cloudflare.com**
2. Select your account → Zero Trust
3. Access section in the left nav

### Creating an Application (Zone Level)

1. Security → Access → **Add an application**
2. **Select application type:**
   - Self-hosted
   - SaaS
3. **Configure application:**
   - Application name: "Admin Panel"
   - Application domain: `macksportreport.com/admin` (or `admin.macksportreport.com`)
   - Application path (optional, to restrict to a path)
4. **Configure policies:**
   - Click **Add a policy**
   - Policy name: "Staff Only"
   - Action: Allow
   - Click **Add include rule** → Email Domain → `macksportreport.com`
   - Optionally add Require or Exclude rules
5. **Review and create**

### Viewing Access Audit Logs (Zone Level)

1. Security → Access → click an application
2. Click **Activity** tab
3. See: User email, Auth state (success/fail), Timestamp, IP, Country
4. Filter by user, date range, result

### Managing Service Tokens

1. one.dash.cloudflare.com → Zero Trust → Access → Service Auth → **Service Tokens**
2. **Create service token:**
   - Name: "CI/CD Pipeline"
   - Duration: 1 year (or non-expiring)
   - **Copy** `CF-Access-Client-Id` and `CF-Access-Client-Secret` immediately — secret shown once
3. **Associate with an application:**
   - Edit the application policy
   - Add Include rule → Service Token → select the token
4. **Test:**
   ```bash
   curl -H "CF-Access-Client-Id: your_id" \
        -H "CF-Access-Client-Secret: your_secret" \
        "https://staging.macksportreport.com/api/health"
   ```

### Identity Provider Setup (Full ZT Dashboard)

1. one.dash.cloudflare.com → Zero Trust → Settings → **Authentication**
2. Click **Add new** under Login methods
3. Select Google Workspace:
   - Enter Google OAuth Client ID
   - Enter Google OAuth Client Secret
   - Add `{team}.cloudflareaccess.com/cdn-cgi/access/callback` to Google's allowed redirect URIs
4. Click **Save**
5. Back in Application policies, you can now use **Google Groups** as selectors

---

## Hands-On Lab

### Lab 6.1 — View the Access Section for macksportreport.com

```bash
# List existing Access applications via API
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/access/apps" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -m json.tool
```

Also navigate in the dashboard:
1. macksportreport.com → Security → Access
2. Note whether any applications exist
3. Click "Open in Zero Trust" to see full Zero Trust dashboard

### Lab 6.2 — Create an Access Application for a Staging Path

```bash
# Create Access application protecting /staging-preview path
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/access/apps" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Staging Preview (Lab 6.2)",
    "domain": "macksportreport.com/staging-preview",
    "type": "self_hosted",
    "session_duration": "1h",
    "auto_redirect_to_identity": false,
    "allow_authenticate_via_warp": false
  }' | python3 -m json.tool
```

### Lab 6.3 — Create a Policy for the Application

```bash
# Save the app ID from the previous response
APP_ID="your_app_id_here"

# Create a policy allowing only a specific email
curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/access/apps/${APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Allow specific email",
    "decision": "allow",
    "precedence": 1,
    "include": [
      {
        "email": {"email": "your-email@example.com"}
      }
    ]
  }' | python3 -m json.tool
```

### Lab 6.4 — Create a Service Token

```bash
# Create a service token for CI/CD access
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/{account_id}/access/service_tokens" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Lab 6.4 - Test Service Token",
    "duration": "8760h"
  }' | python3 -m json.tool

# IMPORTANT: The client_secret is only shown once. Copy it now.
# Save the client_id and client_secret securely
```

### Lab 6.5 — Test JWT Validation

```bash
# Get your team's Access public keys
TEAM_DOMAIN="your-team-domain"  # Found in Zero Trust → Settings → Custom Pages
curl -s "https://${TEAM_DOMAIN}.cloudflareaccess.com/cdn-cgi/access/certs" | python3 -m json.tool

# Create a simple Python JWT validation test
python3 << 'EOF'
# Install: pip3 install PyJWT cryptography requests

import json
import requests

team_domain = "your-team-domain"

# Fetch public keys
certs_url = f"https://{team_domain}.cloudflareaccess.com/cdn-cgi/access/certs"
response = requests.get(certs_url)
if response.status_code == 200:
    print("Successfully fetched Access public keys:")
    print(json.dumps(response.json(), indent=2))
else:
    print(f"Failed: {response.status_code}")
EOF
```

### Lab 6.6 — Clean Up Lab Applications

```bash
# List all Access applications
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/access/apps" \
  -H "Authorization: Bearer ${CF_TOKEN}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for app in data.get('result', []):
    print(f\"ID: {app['id']} | Name: {app['name']} | Domain: {app['domain']}\")
"

# Delete the lab application
APP_ID="your_app_id_from_lab_6_2"
curl -X DELETE \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/access/apps/${APP_ID}" \
  -H "Authorization: Bearer ${CF_TOKEN}"

echo "Lab cleanup complete"
```

---

## Demo Script (2 Minutes)

**Opening (20 seconds):**
"Let me show you how we protect your internal tools without a VPN. This is Cloudflare Access — Zero Trust access control for your applications. The idea is simple: instead of trusting everyone on the network, we verify every user's identity every time they access every application."

**Application Setup Demo (30 seconds):**
"We've protected staging.macksportreport.com with an Access policy. Anyone who tries to access it gets redirected to your company's identity provider — in this case, Google Workspace. They log in with their Google account. If their email is in the macksportreport.com domain, they get in. If not, they get a 403. No VPN credentials. No IP allowlisting. Just: is this person who they say they are, and are they allowed in?"

**Policy Demo (25 seconds):**
"The policy is extremely flexible. We can require users to be in specific groups from Okta or Azure AD. We can require them to be on a corporate device — verified by Cloudflare WARP. We can block access from certain countries. We can add time-based restrictions. We can give contractors temporary access with one email address. And when they leave, we remove them from the policy — no account to deprovision."

**Audit Logs (20 seconds):**
"Every single access attempt is logged: who accessed what, when, from where, and whether they were allowed or denied. Your compliance team gets a complete audit trail without any additional tooling. Compare that to VPN logs which just show 'user connected to the network' — Access tells you exactly what they actually accessed."

**Close (25 seconds):**
"The key difference from a VPN: with VPN, if an employee's laptop is compromised, the attacker has your entire internal network. With Access, they only have access to what that one user was permitted to access — which is the HR portal and the design review tool, not your production database. That's Zero Trust: never trust, always verify, least privilege."

---

## Competitive Context

| Feature | Cloudflare Access | Zscaler Private Access | Palo Alto Prisma Access | AWS Verified Access |
|---------|------------------|----------------------|------------------------|---------------------|
| **Architecture** | Edge proxy, no agent required | Requires Zscaler Client Connector agent | Requires agent | AWS-native, limited |
| **Identity providers** | 20+ (Google, Okta, Azure, SAML, OIDC) | Okta, Azure, Ping, etc. | Okta, Azure, etc. | AWS IAM Identity Center |
| **SSH/RDP access** | Yes (short-lived certs + browser-rendered) | Yes (ZPA for SSH) | Yes | Limited |
| **Browser-based access** | Yes (BRA) | Yes | Yes | No |
| **Device posture** | Yes (via WARP + MDM) | Yes (deep posture) | Yes (deep posture) | Limited |
| **Service tokens (M2M)** | Yes, simple | Complex service accounts | Complex | IAM-based |
| **Audit logs** | Yes, stream to SIEM | Yes | Yes | CloudTrail |
| **Tunnel (origin protection)** | cloudflared (free) | ZPA connector (complex) | Prisma connector | Not available |
| **Global PoP network** | 330+ (Cloudflare edge) | Zscaler data centers | Palo Alto data centers | AWS regions only |
| **Setup time** | Hours | Days/weeks | Days/weeks | Days |
| **Free tier** | Yes (50 users free with Teams) | No | No | AWS-account-dependent |
| **Per-user cost** | $7/user/month (Teams Standard) | ~$10–20/user/month | ~$15–25/user/month | AWS pricing |
| **OSS VPN comparison** | No client required | Client required | Client required | Client required |

---

## Self-Check Questions

**Question 1:** A customer wants to protect their staging environment so only employees can access it, but contractors (who use Gmail accounts) also need access during their engagements. Design an Access policy that handles both cases without giving contractors more access than they need.

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 2:** Explain the difference between the `Include`, `Require`, and `Exclude` rule sections in an Access policy. Give an example where using the wrong section could create a security vulnerability.

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 3:** A CI/CD pipeline needs to deploy to a staging environment that's protected by Access. The pipeline can't complete a browser-based OAuth flow. What is the correct solution and how do you implement it?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 4:** What is Cloudflare Tunnel (cloudflared), and how does it enhance the security of Access-protected applications beyond just requiring authentication?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

**Question 5:** A security-conscious customer asks: "If I use Access to protect my admin panel, what happens if a legitimate admin's laptop is stolen and the attacker has their Google login credentials?" What is your honest answer, and what additional Access features would you recommend to mitigate this risk?

```
Your Answer:
______________________________________________________________
______________________________________________________________
______________________________________________________________
```

---

## Sources

- [Cloudflare Access Documentation](https://developers.cloudflare.com/cloudflare-one/policies/access/)
- [Access Application Types](https://developers.cloudflare.com/cloudflare-one/applications/)
- [Access Policies](https://developers.cloudflare.com/cloudflare-one/policies/access/policy-management/)
- [Identity Providers](https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/)
- [Service Tokens](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)
- [JWT Validation](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/)
- [Cloudflare Tunnel (cloudflared)](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [SSH Access via Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/use-cases/ssh/)
- [Device Posture](https://developers.cloudflare.com/cloudflare-one/identity/devices/)
- [Access Audit Logs](https://developers.cloudflare.com/cloudflare-one/analytics/logs/audit-logs/)
- [Zero Trust Access API](https://developers.cloudflare.com/api/operations/zone-level-access-applications-list-access-applications)
- [Logpush for Access Logs](https://developers.cloudflare.com/logs/reference/log-fields/account/access_requests/)
- [Zero Trust Architecture Guide](https://developers.cloudflare.com/cloudflare-one/)
- [NIST SP 800-207 Zero Trust Architecture](https://csrc.nist.gov/publications/detail/sp/800-207/final)
