# Module 13.5 — Members & Roles
> Dashboard Location: Account Home → Manage Account → Members | Estimated Time: 45 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare account Members management controls who has access to your Cloudflare account and what they can do. Every employee, contractor, or service account that needs to interact with your Cloudflare account should have an appropriate role — not shared credentials.

**The fundamental problem with shared credentials:** If your entire team logs in with one shared email/password:
- No audit trail (every change shows the same actor)
- Can't remove access for a specific person when they leave
- Password rotation requires coordinating with everyone
- If credentials are compromised, you can't tell who shared them

**With individual accounts and roles:**
- Every action is attributed to a specific person in Audit Logs
- Revoke one person's access without affecting others
- Assign minimum permissions each person needs
- Compliance auditors see individual user actions

**Cloudflare's access model:**
- **Account-level roles:** Access to all zones in the account
- **Zone-specific roles:** Access to only specified zones (Enterprise feature for granular per-zone assignment)
- **Custom roles:** Create your own role with exact permissions (Enterprise)

---

## Deep Dive (Architect-Level)

### Built-In Role Reference

| Role | What They Can Do |
|---|---|
| **Super Administrator** | Full access to everything including billing, user management, all zones. Only assign to main account owners. |
| **Administrator** | Full access to all features across all zones. Cannot manage billing or delete the account. Use for senior engineers. |
| **Administrator Read Only** | Can view all configurations but make no changes. Ideal for auditors, consultants reviewing config. |
| **DNS Administrator** | Can only manage DNS records. Cannot touch WAF, CDN, Workers, billing. Good for DNS-focused ops. |
| **Firewall Administrator** | Can manage WAF rules, firewall rules, IP access rules, rate limiting. Cannot manage DNS, billing, or Workers. Security team role. |
| **Analytics** | Read-only access to analytics data. No configuration access. Good for data analysts, marketing team. |
| **Cache Purge** | Can only purge cache. No configuration changes. Good for CDN ops during deployments. |
| **Cloudflare Workers Admin** | Manages Workers scripts, KV, R2, and Durable Objects. Cannot change DNS or WAF. Engineering CI/CD role. |
| **Billing** | View and manage billing only. No technical configuration access. Finance team. |
| **Cloudflare Stream** | Manage Cloudflare Stream (video). Scoped to Stream product only. |
| **Cloudflare Access** | Manage Zero Trust Access policies. Security/IAM team. |
| **Cloudflare Gateway** | Manage Zero Trust Gateway policies. SecOps team. |
| **Log Share** | Configure Logpush only. Data engineering team. |
| **Audit Logs Viewer** | Read-only access to audit logs. Compliance/security audit role. |
| **HTTP Applications** | Manage rules, page rules, transform rules. Platform engineering role. |
| **Magic Network Monitoring** | Monitor Magic Transit/WAN traffic. Network ops team. |
| **Trust and Safety** | Cloudflare internal use. |

### Custom Roles (Enterprise)

Custom roles allow you to define exactly which product permissions are granted:
- Select: which products (DNS, WAF, Workers, Analytics, etc.)
- Select: which actions (read, edit — where edit includes create/update/delete)
- Assign to members

Example custom role: "Frontend Deploy"
- Workers Scripts: Edit
- Workers Routes: Edit
- Cache Purge: Edit
- Analytics: Read
(Nothing else — front-end engineers don't need DNS or WAF access)

### Zone-Specific Role Assignment (Enterprise)

By default, roles apply across all zones in the account. Enterprise customers can assign roles per-zone:

```
User: alice@macksportreport.com
  - Zone A (macksportreport.com): Administrator
  - Zone B (staging-macksportreport.com): DNS Administrator only
  - Zone C (macksportreport.net): No access
```

This enables: give contractors access to staging but not production, or give a partner company access to their specific zone only.

### Invitation Flow

1. Admin invites `newuser@macksportreport.com` with role `DNS Administrator`
2. Invitee receives email: "You've been invited to manage [Account Name]"
3. If they already have a Cloudflare account: accept invitation to link accounts
4. If not: create account with that email, then accept invitation
5. Invitation expires in 14 days if not accepted

### Service Accounts

For CI/CD automation, Cloudflare does not have a dedicated "service account" concept for human-style login. Use API tokens for automation. For anything that requires dashboard-level access (rare for automation), create a dedicated email account (e.g., `cloudflare-bot@macksportreport.com`) and assign minimum roles.

### Multi-Account Management (Enterprise)

Large organizations may have multiple Cloudflare accounts (e.g., one per business unit, or separate prod/staging accounts). Cloudflare Enterprise offers:
- Single login to manage multiple accounts (account switching)
- Parent-child account structure for MSPs
- Centralized user management across accounts

---

## Dashboard Walkthrough

**Step 1: View Current Members**
1. Account Home → Manage Account → Members
2. See: all members, their role, status (active/pending), last login

**Step 2: Invite a New Member**
1. Click "Invite"
2. Email: `newengineer@macksportreport.com`
3. Role: select from dropdown (e.g., "Cloudflare Workers Admin")
4. Zone scope: All zones (or specific zones for Enterprise)
5. Click "Continue" → "Invite"
6. Invitee receives email

**Step 3: View Pending Invitations**
1. Members page → "Pending" tab
2. See invites not yet accepted
3. Option to resend or revoke invitation

**Step 4: Change a Member's Role**
1. Click on a member
2. Edit role: change from Administrator to DNS Administrator
3. Save — takes effect immediately

**Step 5: Remove a Member**
1. Click on member
2. "Remove" button
3. Confirm — access revoked immediately
4. Their actions remain in Audit Logs (attribution preserved)

**Step 6: View Role Permissions Detail**
1. When inviting/editing, click on a role name
2. See the full permission list for that role
3. Compare roles before assignment

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token-with-account-membership-write"
```

### Lab 1: List Account Members
```bash
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/members?per_page=50" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for member in data.get('result', []):
    user = member.get('user', {})
    roles = [r.get('name') for r in member.get('roles', [])]
    print(f\"{user.get('email', 'N/A')}: {', '.join(roles)} | Status: {member.get('status')}\")
"
```

### Lab 2: List Available Roles
```bash
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/roles" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for role in data.get('result', []):
    print(f\"{role['id']}: {role['name']}\")
"
```

### Lab 3: Invite a New Member via API
```bash
DNS_ADMIN_ROLE_ID="get-from-lab-2"

curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/members" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "email": "newdeveloper@macksportreport.com",
    "roles": ["'"${DNS_ADMIN_ROLE_ID}"'"],
    "status": "pending"
  }'
```

### Lab 4: Get a Specific Member's Details
```bash
MEMBER_ID="member-id-from-lab-1"

curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/members/${MEMBER_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -m json.tool
```

### Lab 5: Update a Member's Role
```bash
MEMBER_ID="member-id"
NEW_ROLE_ID="administrator-read-only-role-id"

curl -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/members/${MEMBER_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "roles": ["'"${NEW_ROLE_ID}"'"]
  }'
```

### Lab 6: Remove a Member
```bash
MEMBER_ID="member-id-to-remove"

curl -X DELETE "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/members/${MEMBER_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
# Returns: {"success":true}
# Access revoked immediately
```

### Lab 7: Audit Member List for Hygiene
```bash
# Find members with Super Administrator role (should be minimal)
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/members?per_page=50" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print('=== Super Administrators (should be minimal) ===')
for member in data.get('result', []):
    roles = [r.get('name') for r in member.get('roles', [])]
    if 'Super Administrator' in roles or 'Administrator' in roles:
        user = member.get('user', {})
        print(f\"  {user.get('email')}: {', '.join(roles)}\")

print()
print('=== Members with Never-Used Accounts ===')
for member in data.get('result', []):
    user = member.get('user', {})
    if not user.get('last_login_on'):
        print(f\"  {user.get('email')}: Never logged in\")
"
```

---

## Demo Script (2 Minutes)

**Audience:** IT manager or operations lead at a company sharing Cloudflare credentials

**Opening (20 seconds):**
"How many people on your team have your Cloudflare login? When someone leaves, do you rotate the password and tell everyone the new one? And when something changes in Cloudflare, can you tell from the audit log which person made it?"

**Act 1 — Show the role system (30 seconds):**
"[Members page.] Every person gets their own account with their own role. Your DNS team gets DNS Administrator — they can change records, nothing else. Your security team gets Firewall Administrator — WAF rules only. Your front-end engineers get Workers Admin. Finance gets Billing. Everyone has exactly what they need."

**Act 2 — Show removal (20 seconds):**
"Developer leaves the company. [Remove member.] Done. Their access is gone immediately. Not just password-rotated — actually gone. And their actions for the past 6 months are still in audit logs attributed to their email. Perfect for the exit interview or post-mortem."

**Act 3 — Show the audit trail benefit (30 seconds):**
"[Open Audit Logs.] Every change — who, when. If DNS broke on Tuesday and someone changed a record, you know who. If a WAF rule disappeared, you know who deleted it. Shared credentials make this impossible. Individual accounts make compliance auditors happy."

**Close (20 seconds):**
"Take 20 minutes after this and audit your member list. Who has Super Administrator that doesn't need it? Who hasn't logged in for 6 months? Any pending invitations to old consultants? This is a quarterly hygiene task for a healthy security posture."

---

## Competitive Context

| Feature | Cloudflare Members | Fastly ACL | Akamai Identity Management | AWS IAM | Azure RBAC |
|---|---|---|---|---|---|
| **Granular roles** | Yes (15+ built-in) | Limited | Yes | Yes (unlimited) | Yes (unlimited) |
| **Custom roles** | Enterprise only | Limited | Enterprise | Yes (full) | Yes (full) |
| **Per-zone roles** | Enterprise only | No | Yes | N/A | N/A |
| **Email invitation** | Yes | Yes | Yes | No (IAM-based) | Yes |
| **Audit trail** | Yes (CF Audit Logs) | Limited | Yes | CloudTrail | Activity Log |
| **SSO/SAML** | Yes (via Access) | Yes | Yes | Yes | Yes |
| **MFA enforcement** | Via Cloudflare Access | Manual | Yes | Yes | Yes |
| **API token scoping** | Independent of roles | Limited | Yes | IAM roles | Service principals |
| **Price** | Included | Included | Included | Included | Included |
| **Multi-account** | Enterprise | Yes | Yes | AWS Organizations | Management Group |

---

## Self-Check Questions

**Question 1:** A company has 5 engineers who all currently log in with one shared Cloudflare email/password. What are the three biggest security and operational risks of this setup, and how does individual member accounts solve each?

```
Your answer:




```

**Question 2:** A contractor needs to help set up Cloudflare Workers for a two-week engagement. What role would you assign, and would you assign it at the account level or zone level? Why?

```
Your answer:




```

**Question 3:** Describe the difference between the "Administrator" role and the "Super Administrator" role. In what situation would you grant Super Administrator access?

```
Your answer:




```

**Question 4:** An engineer just had their laptop stolen. They had access to the Cloudflare dashboard and several API tokens. Describe the complete response using Cloudflare's account management tools.

```
Your answer:




```

**Question 5:** Your security team needs read-only visibility into all Cloudflare configurations for compliance monitoring but should not be able to make any changes. What role do you assign them? Can they see audit logs?

```
Your answer:




```

---

## Sources

- [Cloudflare Members and Roles Documentation](https://developers.cloudflare.com/fundamentals/setup/manage-members/)
- [Roles and Permissions Reference](https://developers.cloudflare.com/fundamentals/setup/manage-members/roles/)
- [Manage Account API](https://developers.cloudflare.com/api/operations/account-members-list-members)
- [Custom Roles (Enterprise)](https://developers.cloudflare.com/fundamentals/setup/manage-members/roles/#custom-roles)
- [Cloudflare Access for SSO](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/saas-apps/)
- [Zero Trust Best Practices](https://developers.cloudflare.com/cloudflare-one/best-practices/)
- [NIST 800-53 AC-6: Least Privilege](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final)
- [Cloudflare Blog: Account Security Best Practices](https://blog.cloudflare.com/cloudflare-account-security-best-practices/)
