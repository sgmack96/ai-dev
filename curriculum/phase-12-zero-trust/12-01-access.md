# Module 12.1 — Cloudflare Access
> Dashboard Location: Zero Trust → Access → Applications | Estimated Time: 90 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare Access is an identity-aware reverse proxy. It sits in front of your internal applications and enforces authentication and authorization before any request reaches your server. It is the most common "VPN replacement" use case in the Zero Trust product line.

**The traditional model:** To access internal tools (Grafana, Jenkins, staging environment, internal wiki), employees connect via VPN first. The VPN gives network-level access — once connected, the employee can theoretically reach anything on the internal network. This is broad, hard to audit, and painful for contractors or third parties.

**The Access model:** No VPN. Every application gets its own access policy. A developer connects to `staging.macksportreport.com` in a browser. Cloudflare intercepts, checks: is there an Access policy? Yes → redirect to your identity provider (Google, Okta, Azure AD, GitHub). User authenticates. Access issues a short-lived JWT. The developer is in — only that application, only as long as the JWT is valid, audited every step.

**Key advantages over VPN:**
- No client software required (browser-based)
- Granular per-application policies (not network-wide access)
- Every access event logged (who, when, what, from where)
- Works for contractors and third parties (no corporate device required)
- Integrates with device posture checks (WARP)
- Short-lived credentials — JWT expires, can't be reused

---

## Deep Dive (Architect-Level)

### Complete Request Flow

```
1. User opens: https://staging.macksportreport.com

2. DNS: macksportreport.com is on Cloudflare → request goes to CF edge

3. CF Edge checks: is there a Cloudflare Access policy for staging.macksportreport.com?
   └─ YES → check for valid Access JWT cookie in request

4a. No JWT (first visit):
    └─ Redirect to: https://macksportreport.cloudflareaccess.com/cdn-cgi/access/login/staging.macksportreport.com
    └─ User selects identity provider (Google Workspace)
    └─ User authenticates with IdP
    └─ IdP returns identity claims to CF Access
    └─ CF Access evaluates policy: is this user allowed?
        ├─ ALLOW → issue JWT, redirect to original URL with cookie
        └─ DENY → show Access block page

4b. JWT present:
    └─ CF validates JWT signature (signed with CF keypair)
    └─ Check JWT expiry (default: 24 hours)
    └─ Check policy still satisfied (groups haven't changed)
    └─ JWT valid → add Cf-Access-* headers, forward to origin
    └─ JWT invalid → redirect to login

5. Origin receives request with:
   Cf-Access-Authenticated-User-Email: user@macksportreport.com
   Cf-Access-Jwt-Assertion: <JWT token>
   CF-Access-Jwt-Identity: <identity claims JSON>
```

### Policy Building

A policy has three components that work together:

**Include:** The user must match at least one of these conditions
- Email: `user@macksportreport.com`
- Email domain: `@macksportreport.com`
- IdP Group: `Engineering` (from Okta/Google groups)
- Country: `US` (geo-restrict)
- IP range: `203.0.113.0/24` (office IP range)
- Device posture: WARP enrolled, specific certificate present

**Require:** The user must ALSO match all of these (AND logic on top of Include)
- Example: Include = @macksportreport.com domain, Require = is_manager group
- Both conditions must be true

**Exclude:** Deny even if Include matches
- Example: Include = @macksportreport.com, Exclude = offboarded@macksportreport.com

**Policy actions:**
- **Allow:** Grant access
- **Block:** Deny with a block page
- **Bypass:** Let the request through without any Access check (use carefully)
- **Service Auth:** Machine-to-machine (no user login, service token required)

### Multi-IdP Support

Access supports multiple identity providers simultaneously:

```
Application: admin.macksportreport.com
├─ Identity Provider 1: Google Workspace (for full-time employees)
├─ Identity Provider 2: Okta (for contractors)
└─ Identity Provider 3: GitHub (for open source contributors)
```

Users select their IdP at login. All identities feed into the same policy evaluation.

### SSH and RDP via Access

Access can protect SSH and RDP without a VPN:

**SSH via cloudflared:**
```bash
# Install cloudflared on client machine
# In ~/.ssh/config:
Host ssh.macksportreport.com
  ProxyCommand /usr/local/bin/cloudflared access ssh --hostname %h
```

Cloudflared handles the Access authentication transparently before establishing the SSH connection. The user gets SSH-as-usual but the session is Access-authenticated and audited.

**Short-lived SSH certificates:** Instead of managing SSH keys, Access can issue short-lived certificates signed by a Cloudflare CA. No standing authorized_keys entries — certificates expire in hours.

### JWT Validation at Origin

For defense-in-depth, your origin can validate the JWT independently:

```typescript
// Workers or any backend — verify Access JWT
async function verifyAccessJWT(jwt: string, teamDomain: string): Promise<any> {
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
  const certsResponse = await fetch(certsUrl);
  const certs = await certsResponse.json();

  // Use a JWT library to verify against the public keys
  // The 'aud' claim should match your application AUD tag
  return verifyJWT(jwt, certs.public_cert);
}
```

### Access Groups

Reusable policy building blocks:
```
Group: "Engineering Team"
  Include: @macksportreport.com AND GitHub Team "engineering"

Group: "Senior Staff"
  Include: @macksportreport.com AND is_senior attribute from Okta

# Use in multiple policies:
Application "Admin Panel" → Policy: Allow group "Senior Staff"
Application "Build System" → Policy: Allow group "Engineering Team"
```

---

## Dashboard Walkthrough

**Step 1: Navigate to Access**
1. Cloudflare dashboard → Zero Trust (in left sidebar)
2. Zero Trust → Access → Applications

**Step 2: Create a Self-Hosted Application**
1. Click "Add an application"
2. Select "Self-hosted"
3. Configure:
   - **Name:** `Staging - macksportreport.com`
   - **Session Duration:** 24h
   - **Subdomain:** `staging` on domain `macksportreport.com`
4. Click "Next"

**Step 3: Add a Policy**
1. Policy name: `Engineers Only`
2. Action: Allow
3. Include → Email domain → `macksportreport.com`
4. (Optional) Add Require → Country → United States
5. Click "Next"

**Step 4: Configure Additional Settings**
1. CORS settings (if API calls cross-origin)
2. HTTP-only cookie (recommended)
3. Same-site cookie attribute
4. Service tokens: add for CI/CD pipelines

**Step 5: Review the Identity Provider**
1. Zero Trust → Settings → Authentication
2. Add your IdP (Google, Okta, etc.)
3. Configure OAuth credentials

**Step 6: Review Audit Logs**
1. Zero Trust → Logs → Access
2. Every login attempt: email, IP, time, decision (Allow/Block), rule matched

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token-with-zero-trust-write"
```

### Lab 1: Create an Access Application via API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Staging - Mack Sport Report",
    "domain": "staging.macksportreport.com",
    "type": "self_hosted",
    "session_duration": "24h",
    "auto_redirect_to_identity": false,
    "allowed_idps": [],
    "enable_binding_cookie": false,
    "http_only_cookie_attribute": true,
    "same_site_cookie_attribute": "none",
    "skip_interstitial": false
  }'
```

### Lab 2: Create a Policy for the Application
```bash
APP_ID="your-app-id-from-lab-1"

curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Engineers Only",
    "precedence": 1,
    "decision": "allow",
    "include": [
      {
        "email_domain": {
          "domain": "macksportreport.com"
        }
      }
    ],
    "require": [],
    "exclude": []
  }'
```

### Lab 3: Add an IP-Restricted Policy
```bash
# Require office IP + corporate email
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Office Only",
    "precedence": 2,
    "decision": "allow",
    "include": [
      {
        "email_domain": {
          "domain": "macksportreport.com"
        }
      }
    ],
    "require": [
      {
        "ip": {
          "ip": "203.0.113.0/24"
        }
      }
    ],
    "exclude": []
  }'
```

### Lab 4: Create a Service Token (for CI/CD)
```bash
# Create a service token for GitHub Actions
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/service_tokens" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "GitHub Actions Deploy Bot",
    "duration": "8760h"
  }'

# Response includes:
# client_id: <service-client-id>
# client_secret: <service-client-secret>  ← shown only ONCE, save it

# Use in CI/CD:
# curl -H "CF-Access-Client-Id: $SERVICE_CLIENT_ID" \
#      -H "CF-Access-Client-Secret: $SERVICE_CLIENT_SECRET" \
#      https://staging.macksportreport.com/health
```

### Lab 5: Query Access Audit Logs
```bash
# Get last 100 Access events
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/logs/access-requests?limit=100" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"

# Filter to blocked events only
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/logs/access-requests?action=BLOCK&limit=50" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 6: Validate Access JWT in a Worker
```typescript
// Verify Cloudflare Access JWT in a Worker
interface Env {
  CF_ACCESS_TEAM_DOMAIN: string; // e.g., "macksportreport.cloudflareaccess.com"
  CF_ACCESS_AUD: string;          // Application AUD tag from Access app settings
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const jwtToken = request.headers.get('Cf-Access-Jwt-Assertion');

    if (!jwtToken) {
      return new Response('Unauthorized: No Access JWT', { status: 401 });
    }

    try {
      // Fetch CF Access public keys
      const certsRes = await fetch(
        `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`
      );
      const certs = await certsRes.json() as { public_certs: Array<{ kid: string; cert: string }> };

      // Decode JWT header to get kid
      const [headerB64] = jwtToken.split('.');
      const header = JSON.parse(atob(headerB64));

      // Find matching cert
      const cert = certs.public_certs.find(c => c.kid === header.kid);
      if (!cert) {
        return new Response('Unauthorized: Unknown signing key', { status: 401 });
      }

      // In production, use jose or similar to cryptographically verify
      // For demo, decode payload
      const [, payloadB64] = jwtToken.split('.');
      const payload = JSON.parse(atob(payloadB64));

      // Check expiry
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        return new Response('Unauthorized: Token expired', { status: 401 });
      }

      // Check audience
      if (!payload.aud.includes(env.CF_ACCESS_AUD)) {
        return new Response('Unauthorized: Wrong audience', { status: 401 });
      }

      return Response.json({
        user: payload.email,
        exp: new Date(payload.exp * 1000).toISOString(),
        authenticated: true,
      });

    } catch (e) {
      return new Response('Unauthorized: JWT validation failed', { status: 401 });
    }
  }
} satisfies ExportedHandler<Env>;
```

---

## Demo Script (2 Minutes)

**Audience:** IT/Security leader considering VPN replacement

**Opening (20 seconds):**
"How many VPN licenses are you paying for? And when a contractor needs access to your staging environment for two weeks, what's the process — VPN account creation, network access, then manual removal when they're done?"

**Act 1 — Show Access in action (40 seconds):**
"[Open browser to staging.macksportreport.com.] No VPN. I just go to the URL. [Redirected to Google login.] I authenticate with my Google account. [Back to staging site.] I'm in. That's it. My session expires in 24 hours. When their contract ends, you remove them from the Google group — access is revoked instantly, everywhere, for every application they had access to."

**Act 2 — Show the audit logs (30 seconds):**
"[Zero Trust → Logs → Access.] Every access attempt, logged. Who logged in, from what IP, what country, what time, which application, whether they were allowed or blocked. This is your SOC 2 audit trail. Every auditor loves this."

**Act 3 — Show policy granularity (20 seconds):**
"[Policy editor.] The staging environment requires corporate email. The admin panel requires corporate email AND a US IP. The Jenkins CI server is blocked to everyone except a service token. Each application has its own policy. Network-wide VPN access doesn't exist here."

**Close (10 seconds):**
"50 users free. After that, $3 per user per month. What does your current VPN solution cost — per user, per year?"

---

## Competitive Context

| Feature | Cloudflare Access | Okta Advanced Server Access | Zscaler Private Access | Palo Alto Prisma Access | HashiCorp Boundary |
|---|---|---|---|---|---|
| **VPN required** | No | No | No | No | No |
| **Client agent required** | Optional (WARP) | Yes (ASA client) | Yes (ZPA client) | Yes (Prisma client) | Yes (Boundary client) |
| **SSH/RDP protection** | Yes (cloudflared) | Yes (primary focus) | Yes | Yes | Yes |
| **Web app protection** | Yes (primary focus) | Limited | Yes | Yes | Limited |
| **JWT-based auth** | Yes | No | No | No | No |
| **Multi-IdP** | Yes (all IdPs) | Okta-centric | SAML/OIDC | SAML/OIDC | OIDC |
| **Device posture** | Yes (WARP) | Yes | Yes | Yes | Limited |
| **Free tier** | 50 users free | No | No | No | No |
| **Pricing** | $3/user/month | ~$10+/user/month | ~$12+/user/month | Enterprise pricing | Open source + enterprise |
| **Audit logs** | Yes (built-in) | Yes | Yes | Yes | Yes |
| **Integration with CF WAF** | Native | No | No | No | No |

---

## Self-Check Questions

**Question 1:** Explain what happens step-by-step when a new employee visits `staging.macksportreport.com` for the first time with Access protecting it. What happens on subsequent visits within the 24-hour session window?

```
Your answer:




```

**Question 2:** A contractor needs access to three internal applications for 30 days. Describe how to provision and de-provision their access using Cloudflare Access. What are the exact steps?

```
Your answer:




```

**Question 3:** What is a service token and when do you need one? Give a concrete example scenario.

```
Your answer:




```

**Question 4:** A customer asks: "If Cloudflare has an outage, can our employees still access internal apps protected by Access?" What is the honest answer and what mitigation would you suggest?

```
Your answer:




```

**Question 5:** What is the difference between Include, Require, and Exclude rules in an Access policy? Write a policy in plain English that uses all three: "Allow engineers from the @macksportreport.com domain, but only if they're connecting from the US, and never allow bob@macksportreport.com."

```
Your answer:




```

---

## Sources

- [Cloudflare Access Documentation](https://developers.cloudflare.com/cloudflare-one/policies/access/)
- [Access Applications](https://developers.cloudflare.com/cloudflare-one/applications/)
- [Access Service Tokens](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)
- [SSH Access via cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/use-cases/ssh/)
- [JWT Validation at Origin](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/)
- [Access Audit Logs](https://developers.cloudflare.com/cloudflare-one/insights/logs/access-logs/)
- [Zero Trust: Replace Your VPN](https://developers.cloudflare.com/cloudflare-one/replace-vpn/)
- [NIST Zero Trust Architecture (SP 800-207)](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf)
