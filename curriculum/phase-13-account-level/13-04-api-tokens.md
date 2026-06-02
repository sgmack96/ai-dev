# Module 13.4 — API Tokens & Keys
> Dashboard Location: Account Home → My Profile → API Tokens | Estimated Time: 60 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare provides two ways to authenticate API calls: the legacy Global API Key and the modern API Tokens. For any new integration, you should always use API Tokens. Understanding the difference and following token best practices is foundational to secure Cloudflare automation.

**Global API Key (avoid):**
- Full account access, identical to being logged in as the user
- Never expires (unless you rotate it manually)
- Cannot be scoped to specific zones or permissions
- Associated with a user account, not a purpose
- If leaked: attacker has full access to everything in your account
- Legacy only — only use when an older tool explicitly requires it

**API Tokens (use always):**
- Scoped to specific resources (one zone, or specific zones, or account-level)
- Scoped to specific permissions (read-only, or only DNS editing, or only Worker deployment)
- Can have IP restrictions (only works from specific IPs)
- Can have TTL (expires on a date)
- If leaked: attacker can only do what the token is scoped to
- If you don't use it: it times out
- Multiple tokens per account, one per use case

**The principle of least privilege:** Each automation, script, or CI/CD pipeline should have its own token with only the permissions it needs. If your GitHub Actions workflow deploys Workers, give it a token that can only edit Workers scripts — not one that can delete your DNS records.

---

## Deep Dive (Architect-Level)

### Token Permission Structure

API Token permissions are defined as a combination of:

1. **Resource type:** What kind of thing does this token affect?
   - Zone (specific zones you select)
   - Account (account-level resources)
   - User (the current user's profile)

2. **Resource scope:** Which specific resources?
   - All zones in account
   - Specific zones (select by name)
   - Specific account

3. **Permission level:** What can the token do?
   - Read (GET requests only)
   - Edit (GET, POST, PUT, PATCH, DELETE)

**How permissions are structured in the API:**
```json
{
  "name": "Workers Deploy",
  "policies": [
    {
      "effect": "allow",
      "resources": {
        "com.cloudflare.api.account.*": "*"  // Account-level resources
      },
      "permission_groups": [
        {"id": "workers-scripts-write-permission-id"}
      ]
    },
    {
      "effect": "allow",
      "resources": {
        "com.cloudflare.api.account.zone.*": "*"  // All zones
      },
      "permission_groups": [
        {"id": "workers-routes-write-permission-id"}
      ]
    }
  ]
}
```

### Token Templates

Cloudflare provides pre-built templates for common use cases:

| Template | Permissions | Use Case |
|---|---|---|
| **Edit zone DNS** | Zone: DNS Edit | DNS management automation |
| **Read all resources** | Zone: Read, Account: Read | Auditing, monitoring tools |
| **Worker Scripts Edit** | Account: Workers Edit | CI/CD deployment |
| **Cloudflare Pages** | Zone: Pages Edit | Pages deployment |
| **Cache Purge** | Zone: Cache Purge | CDN cache automation |
| **Firewall Services** | Zone: Firewall Services Edit | WAF rule automation |

### Common Token Permission Sets

**Terraform (full management):**
```
Zone Resources: All zones
  - Zone: Read
  - Zone Settings: Edit
  - DNS: Edit
  - Firewall Services: Edit
  - Page Rules: Edit
  - Cache Rules: Edit

Account Resources: All accounts
  - Workers Scripts: Edit
  - Account Settings: Read
```

**Workers CI/CD deploy only:**
```
Account Resources: Specific account
  - Workers Scripts: Edit
  - Workers Routes: Edit (if you manage routes)

Zone Resources: Specific zones
  - Workers Routes: Edit
```

**Read-only monitoring:**
```
Zone Resources: All zones
  - Zone: Read
  - Analytics: Read
  - Logs: Read

Account Resources:
  - Account Analytics: Read
```

**Logpush setup:**
```
Zone Resources:
  - Logs: Edit

Account Resources:
  - Account Logs: Edit
```

### IP Restrictions

Tokens can be restricted to specific IP addresses or CIDR ranges. If a request comes from an IP not in the allowlist, the token returns 403 even if the token itself is valid.

**Best practice:** Add IP restrictions to tokens used by:
- CI/CD systems (restrict to GitHub Actions IP ranges, or your runner IP)
- Server-side automation (restrict to your server's IP)
- Terraform (restrict to your ops engineer workstations)

Not practical for tokens used by distributed applications that run from many IPs.

### TTL (Token Expiry)

Set an expiry date for tokens. This creates a natural forcing function to rotate credentials:
- Terraform tokens: 1 year, calendar reminder to rotate
- Short-lived CI/CD: OIDC is better (see OIDC below)
- User-created tokens: 90 days

**Even better than TTL: OIDC (for GitHub Actions):**
Cloudflare supports OIDC token exchange for GitHub Actions — instead of a long-lived token, GitHub Actions gets a short-lived (15-minute) token automatically. Zero credential management.

```yaml
# .github/workflows/deploy.yml
jobs:
  deploy:
    permissions:
      id-token: write  # Required for OIDC
    steps:
      - name: Deploy Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}  # Or OIDC
```

### Wrangler Authentication

Wrangler (the CF CLI) can authenticate two ways:

1. **OAuth (browser-based):** `wrangler login` opens a browser, you approve access, token is stored in `~/.wrangler/config`. Best for local development.

2. **API Token (environment variable):** `CLOUDFLARE_API_TOKEN=your-token wrangler deploy`. Best for CI/CD — set the env var in your CI system secrets.

---

## Dashboard Walkthrough

**Step 1: Access API Tokens**
1. Click user avatar → My Profile → API Tokens
2. Or: `https://dash.cloudflare.com/profile/api-tokens`
3. View existing tokens (never see actual token value again after creation)

**Step 2: Create a Token from Template**
1. Click "Create Token"
2. Select "Edit zone DNS" template
3. Zone Resources: Include → Specific zone → `macksportreport.com`
4. IP Address Filtering: Add your IP
5. TTL: Set expiry 90 days from today
6. Click "Continue to summary"
7. Review and "Create Token"
8. **COPY THE TOKEN** — shown only once

**Step 3: Create a Custom Token (Workers Deploy)**
1. Click "Create Token" → "Get started" (custom)
2. Token name: `Workers Deploy - GitHub Actions`
3. Add permission:
   - Account → Workers Scripts → Edit
4. Add permission:
   - Zone → Workers Routes → Edit
5. Zone resources: `macksportreport.com`
6. Set IP restriction if using fixed runners
7. Create

**Step 4: Verify a Token Works**
```bash
CF_TOKEN="your-new-token"
curl -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer ${CF_TOKEN}"
# {"success":true,"result":{"id":"...","status":"active"}}
```

**Step 5: Delete an Old Token**
1. API Tokens page → Click token → "Roll" (to rotate) or "Delete"
2. Deleting is permanent and immediate — any automation using it will fail

---

## Hands-On Lab

### Prerequisites
```bash
export CF_API_TOKEN="your-existing-token-with-api-token-edit-permission"
export CF_ACCOUNT_ID="your-account-id"
```

### Lab 1: List All API Tokens
```bash
curl "https://api.cloudflare.com/client/v4/user/tokens" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for token in data.get('result', []):
    print(f\"{token['name']}: status={token['status']}, expires={token.get('expires_on', 'never')}, last_used={token.get('last_used_on', 'never')}\")
"
```

### Lab 2: Create a DNS Edit Token via API
```bash
# First get the DNS edit permission group ID
curl "https://api.cloudflare.com/client/v4/user/tokens/permission_groups" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
dns_perms = [p for p in data.get('result', []) if 'DNS' in p.get('name', '')]
for p in dns_perms:
    print(f\"{p['id']}: {p['name']}\")
"

DNS_EDIT_PERM_ID="dns-edit-permission-id-from-above"

# Create the token
curl -X POST "https://api.cloudflare.com/client/v4/user/tokens" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "macksportreport DNS Edit",
    "policies": [
      {
        "effect": "allow",
        "resources": {
          "com.cloudflare.api.account.zone.your-zone-id": "*"
        },
        "permission_groups": [
          {"id": "'"${DNS_EDIT_PERM_ID}"'"}
        ]
      }
    ],
    "not_before": "2024-01-01T00:00:00Z",
    "expires_on": "2025-01-01T00:00:00Z"
  }'
# COPY THE TOKEN VALUE FROM RESPONSE - shown only once
```

### Lab 3: Verify a Token
```bash
NEW_TOKEN="token-from-lab-2"

curl -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer ${NEW_TOKEN}"
# Expected: {"result":{"id":"...","status":"active"},"success":true}
```

### Lab 4: Test Scope Restriction
```bash
# This token only has DNS edit permission
# Trying to list Workers should fail

NEW_TOKEN="token-from-lab-2"

# DNS operation - should succeed
curl "https://api.cloudflare.com/client/v4/zones/YOUR_ZONE_ID/dns_records" \
  -H "Authorization: Bearer ${NEW_TOKEN}"

# Workers operation - should fail with permission denied
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts" \
  -H "Authorization: Bearer ${NEW_TOKEN}"
# Expected: {"errors":[{"code":10000,"message":"Authentication error"}]...}
```

### Lab 5: Rotate a Token
```bash
TOKEN_ID="your-token-id"

# Roll the token (generates new value, invalidates old value)
curl -X PUT "https://api.cloudflare.com/client/v4/user/tokens/${TOKEN_ID}/value" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{}'
# Response contains new token value - copy it and update all systems using old token
```

### Lab 6: Create Wrangler Token for GitHub Actions
```bash
# Create Workers deploy token for CI/CD
ZONE_ID="your-zone-id"

# Get Workers Scripts Edit permission ID
curl "https://api.cloudflare.com/client/v4/user/tokens/permission_groups" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for p in data.get('result', []):
    if 'Workers' in p.get('name', '') or 'Worker' in p.get('name', ''):
        print(f\"{p['id']}: {p['name']}\")
"

# Then create the token in dashboard (easier UI) or via API
# Add to GitHub Actions as repository secret: CF_API_TOKEN
echo "Go to GitHub → Repository → Settings → Secrets → New secret: CF_API_TOKEN"
```

---

## Demo Script (2 Minutes)

**Audience:** Developer or DevOps engineer setting up automation or Terraform

**Opening (15 seconds):**
"Are you using the Global API Key for your Terraform or CI/CD pipelines? That's full account access in a variable. One leaked .env file and your entire Cloudflare account is compromised. API Tokens fix this."

**Act 1 — Explain the scoping (40 seconds):**
"[Create Token screen.] You define exactly what this token can do. My Terraform token: edit DNS, edit zone settings, edit WAF rules — nothing else. If this token leaks, an attacker can mess with my DNS, but they can't delete my Workers, can't access Zero Trust, can't change my billing. The blast radius is scoped."

**Act 2 — Show IP restriction (20 seconds):**
"And I can say: this token only works from this IP range. [Add IP filter.] My office network. If the token leaks and someone tries to use it from their laptop in another country — 403. Token is useless without being on our network."

**Act 3 — Show verification (20 seconds):**
"Verify any token: `curl .../user/tokens/verify`. If the token is active and valid, you see `status: active`. If expired or deleted, you know immediately. Build this into your startup checks."

**Close (25 seconds):**
"Best practice: one token per use case. Terraform gets one token. GitHub Actions gets another. Your local dev gets another. Name them clearly. Set expiry dates. Rotate every 90 days or when a team member with access leaves. This is the foundation of your Cloudflare security posture."

---

## Competitive Context

| Feature | CF API Tokens | CF Global API Key | AWS IAM Roles | GitHub PATs | Vault Dynamic Secrets |
|---|---|---|---|---|---|
| **Scope granularity** | Per-zone, per-permission | Full account | Per-resource/action | Per-repo/org | Per-service |
| **Expiry/TTL** | Yes (optional) | Manual rotation only | Yes (session tokens) | Yes | Yes (short-lived) |
| **IP restrictions** | Yes | No | Conditions | No | No |
| **Multiple tokens** | Yes (unlimited) | One per account | Unlimited | Unlimited | Dynamic |
| **Rotation** | Manual (roll API) | Manual | Automatic (OIDC) | Manual | Automatic |
| **If leaked** | Scoped damage | Full account exposure | Scoped damage | Scoped damage | Expired quickly |
| **OIDC support** | Yes (GitHub Actions) | No | Yes (native) | N/A | Yes |
| **Audit trail** | Via Audit Logs | Via Audit Logs | CloudTrail | GitHub audit log | Vault audit log |
| **Templates** | Yes (10+ pre-built) | No | Yes (managed policies) | No | No |

---

## Self-Check Questions

**Question 1:** A developer asks: "Why not just use the Global API Key? It's simpler." Provide the security argument and a specific scenario where the scoped token limits damage from a credential leak.

```
Your answer:




```

**Question 2:** You need to give GitHub Actions the ability to deploy Workers to `macksportreport.com` but NOT to modify any DNS records. List the exact permissions and resource scopes you would configure in the API token.

```
Your answer:




```

**Question 3:** What is the purpose of the `wrangler login` command, and what is the alternative for CI/CD environments? When should you use each?

```
Your answer:




```

**Question 4:** A developer who had access to your Cloudflare API token leaves the company. They had access to a `CLOUDFLARE_API_TOKEN` secret in GitHub Actions. What are the three immediate actions you take?

```
Your answer:




```

**Question 5:** What happens to existing API requests if a token is deleted vs. if a token expires? Is there a difference in behavior?

```
Your answer:




```

---

## Sources

- [Cloudflare API Tokens Documentation](https://developers.cloudflare.com/fundamentals/api/reference/create-token/)
- [API Token Permissions Reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [Wrangler Authentication](https://developers.cloudflare.com/workers/wrangler/authentication/)
- [GitHub Actions OIDC with Cloudflare](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare API Token Verify Endpoint](https://developers.cloudflare.com/api/operations/user-api-tokens-verify-token)
- [Terraform Cloudflare Provider Authentication](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs#authentication)
- [Cloudflare Blog: Scoped API Tokens](https://blog.cloudflare.com/api-tokens-general-availability/)
- [OWASP: Secrets Management](https://owasp.org/www-project-cheat-sheets/cheatsheets/Secrets_Management_Cheat_Sheet.html)
