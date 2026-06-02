# Module 0.3 — Account vs Zone Architecture

> **Dashboard Location:** The account home (`dash.cloudflare.com`) vs the zone dashboard (inside a domain)  
> **Estimated Time:** 30 minutes  
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### The Two Levels of Cloudflare

Every Cloudflare configuration lives at one of two levels:

**Account level:** Settings, products, and billing that apply across all your domains. Think of this as your "company-wide" layer. You log into the account, then pick a domain.

**Zone level:** Settings that apply to a specific domain (zone). A "zone" is Cloudflare's term for a domain and all its subdomains. When you add `macksportreport.com` to Cloudflare, you create a zone.

```
Account: stephenmack96 (or your account name)
├── Zone: macksportreport.com
│   ├── DNS records
│   ├── WAF rules
│   ├── Caching config
│   └── SSL/TLS settings
├── Zone: anotherdomain.com
│   └── (completely separate config)
│
├── Workers (ACCOUNT-LEVEL — shared across all zones)
├── R2 Buckets (ACCOUNT-LEVEL)
├── D1 Databases (ACCOUNT-LEVEL)
├── KV Namespaces (ACCOUNT-LEVEL)
├── Vectorize Indexes (ACCOUNT-LEVEL)
├── AI Gateway (ACCOUNT-LEVEL)
├── Workers AI (ACCOUNT-LEVEL)
├── Zero Trust (ACCOUNT-LEVEL)
├── Members & API Tokens (ACCOUNT-LEVEL)
└── Billing (ACCOUNT-LEVEL)
```

### Zone-Level Products (Per Domain)
These settings only affect `macksportreport.com` and do not touch other domains:
- DNS records
- SSL/TLS mode and certificates
- WAF rules, rate limiting, firewall rules
- Caching configuration
- Speed settings (minification, compression, image optimization)
- Security settings
- Rules (transform, redirect, origin, configuration)
- Email routing
- Load balancing (though pools can be shared)
- Analytics for that specific zone

### Account-Level Products (Shared)
These exist once per account and can be used by any Worker or service:
- **Workers** — Your Worker code is account-level, but Worker routes are per-zone
- **KV namespaces** — One namespace, accessed from any Worker in the account
- **R2 buckets** — Object storage shared across account
- **D1 databases** — SQLite DBs accessible from any Worker
- **Vectorize indexes** — Shared across Workers
- **Durable Objects** — Account-level classes
- **Pages projects** — Account-level deployments
- **Queues** — Account-level message queues
- **AI Gateway** — Account-level LLM proxy config
- **Workers AI** — Account-level inference
- **Zero Trust (Access, Gateway, WARP)** — Account-level identity and security
- **Billing and subscriptions** — One invoice per account
- **API tokens** — Scoped to account or specific zones
- **Audit logs** — Account-wide activity log
- **Members** — Account-level user access

### Why This Matters Architecturally

When you build a Workers app, the Worker runs at the **account level** but you attach it to a zone via **routes** (e.g., `macksportreport.com/api/*`). The Worker can then access account-level resources (KV, D1, R2) while responding to requests on the zone.

This means:
- One Worker can serve multiple domains
- One D1 database can back multiple Workers
- Your R2 bucket can be a backend for Workers serving traffic from 10 different zones
- Zero Trust policies apply to all applications in the account

---

## Deep Dive (Architect-Level)

### Account IDs and Zone IDs

Every account and zone has a unique identifier used in API calls, Terraform configs, and Wrangler:

```bash
# Account ID (32-character hex) — found at:
# dash.cloudflare.com → right sidebar on account home

# Zone ID (32-character hex) — found at:
# zone dashboard → Overview → right sidebar
# OR via API:
curl -X GET "https://api.cloudflare.com/client/v4/zones?name=macksportreport.com" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[0].id'
```

In `wrangler.toml`, you reference these explicitly:
```toml
name = "my-worker"
account_id = "your-account-id-here"

# Zone-level route binding
[[routes]]
pattern = "macksportreport.com/api/*"
zone_id = "your-zone-id-here"
```

### The Namespace Isolation Model

Workers running in the same account can access the same KV namespaces, D1 databases, and R2 buckets — but only if you explicitly **bind** them in `wrangler.toml`. There's no automatic sharing. This is a security feature: a Worker serving `evilsite.com` (if somehow in your account) can't read your `macksportreport.com` KV unless you bound it.

### Multi-Zone Management (Enterprise Pattern)

Enterprise customers often manage hundreds of zones. Cloudflare provides:
- **Bulk operations via API** — Apply rules to all zones programmatically
- **Account-level rulesets** — Deploy one WAF ruleset across all zones
- **Terraform provider** — Infrastructure-as-code for all zone and account settings
- **Cloudflare Gateway** (Zero Trust) — Policies that span all zones and users

Account-level API access is via the `accounts/{account_id}` endpoint prefix vs. zone-level which uses `zones/{zone_id}`.

### Members, Roles, and Permissions

The account owner can invite team members with specific roles:
- **Super Administrator** — Full access to everything
- **Administrator** — Full access except billing and member management
- **Administrator Read Only** — Can view but not change anything
- **DNS Administrator** — DNS only, no security/caching/rules access
- **Firewall Administrator** — WAF and security rules only
- **Analytics** — Read-only access to analytics
- **Cache Purge** — Can purge cache, nothing else
- **Custom roles (Enterprise)** — Granular per-zone, per-product scoping

This maps directly to how enterprise SEs think about customer org structures: "who owns DNS?" is often a different team than "who owns security rules?"

### Terraform Resource Naming Convention

```hcl
# Account-level resource
resource "cloudflare_workers_kv_namespace" "example" {
  account_id = var.account_id
  title      = "MY_KV_NAMESPACE"
}

# Zone-level resource
resource "cloudflare_record" "www" {
  zone_id = var.zone_id
  name    = "www"
  value   = "203.0.113.1"
  type    = "A"
  proxied = true
}
```

The pattern is consistent: zone-scoped resources take `zone_id`, account-scoped resources take `account_id`.

---

## Dashboard Walkthrough

### The Account Home

1. Go to `dash.cloudflare.com` (no domain selected)
2. This is the **account home** — you see:
   - Your domains (zones) listed as cards
   - Left sidebar: account-level products (Workers, Pages, R2, D1, Zero Trust, etc.)
   - Account analytics (aggregate across all zones)
   - Billing link
   - Profile/settings

### The Zone Dashboard

1. Click on `macksportreport.com` from the account home
2. Left sidebar now shows zone-level products (DNS, SSL/TLS, Security, Speed, etc.)
3. The top breadcrumb shows: `Account Home > macksportreport.com`
4. Zone ID is visible in the URL: `dash.cloudflare.com/<account-id>/macksportreport.com/...`

### Navigating Between Levels

The breadcrumb at the top of the dashboard always shows your current context:
- `Account Home` = account-level
- `macksportreport.com > DNS > Records` = zone-level

Click "Back to Domains" (top of left sidebar) to return to account level.

---

## Hands-On Lab

### Lab 0.3: Map Your Account Architecture

**Step 1: Find your Account ID and Zone ID**
```bash
# Install Wrangler if not already
npm install -g wrangler

# Login and get account info
wrangler whoami

# List zones
wrangler zones list

# From the output, record:
Account ID: ____________________
Zone ID for macksportreport.com: ____________________
```

**Step 2: Audit account-level resources you already have**

Go to Account Home and click through each left-sidebar section. For each one, note:
```
Workers: _____ scripts deployed
Pages: _____ projects
KV Namespaces: _____ namespaces
R2 Buckets: _____ buckets
D1 Databases: _____ databases
Queues: _____ queues
AI Gateway: _____ gateways
Vectorize: _____ indexes
```

**Step 3: Check your team members**
```
Account Home → Members
```
List all members and their roles: ________________

**Step 4: Pull your zones via API**
```bash
export CF_API_TOKEN="your-api-token-here"

curl -s "https://api.cloudflare.com/client/v4/zones" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '.result[] | {name: .name, id: .id, plan: .plan.name, status: .status}'
```

This is what the Terraform provider, Wrangler CLI, and any automation tool uses to interact with your account.

**Step 5: Create an API token with correct scoping**
```
Account Home → Manage Account → API Tokens → Create Token
```
Create a token that can only manage DNS for `macksportreport.com`:
- Permissions: `Zone:DNS:Edit`
- Zone Resources: Include Specific Zone → `macksportreport.com`

Test it:
```bash
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone-id}/dns_records" \
  -H "Authorization: Bearer YOUR_NEW_TOKEN"
```

Verify it CANNOT access other zones or account-level resources.

---

## Demo Script (2 Minutes)

> Use this when a customer asks about multi-domain management or enterprise-scale configuration

"Cloudflare's architecture is two-tiered: you have an account, and under it you have zones — one per domain. Everything security and performance related (WAF rules, DNS, SSL, caching) lives at the zone level so each domain is fully isolated. But your developer platform — Workers, KV, R2, D1, AI — lives at the account level and is shared across all domains. 

So if you're building a platform that serves 50 customer domains, you write your Worker once at the account level and route traffic from all 50 zones through it. One KV namespace, one D1 database, one codebase. That's a completely different model than AWS where you'd be wiring together Route53, CloudFront, Lambda, and API Gateway per domain.

For enterprise customers with large teams, the permission model maps nicely to org structure. Your DNS team gets DNS admin access. Security gets firewall access. Finance gets billing only. All zone-level. Your platform engineers get Workers and R2 access. All account-level. Nobody steps on each other."

---

## Competitive Context

| Concept | Cloudflare | AWS | GCP |
|---------|-----------|-----|-----|
| **Domain configuration unit** | Zone | CloudFront Distribution | Load Balancer rule |
| **Shared compute** | Workers (account-level, route to any zone) | Lambda (region-level, must configure per API Gateway) | Cloud Functions (project-level) |
| **Shared storage** | KV / R2 / D1 (account-level) | S3 (account-level) ✓ | Cloud Storage (project-level) ✓ |
| **Multi-domain WAF** | Account-level rulesets + per-zone override | WAF per CloudFront distro or ALB | Cloud Armor per load balancer |
| **Permission model** | Zone-scoped + account-scoped roles | IAM per resource | IAM per project |
| **API surface** | One API (`api.cloudflare.com`) | 300+ service endpoints | 300+ service endpoints |

---

## Self-Check Questions

1. You're building a Workers app that needs to access the same KV namespace from two different domains. Is this possible? How?

2. A customer asks: "If I add a second domain to my Cloudflare account, does it inherit my WAF rules from the first domain?" What's the correct answer?

3. What's the difference between a Zone ID and an Account ID? When do you need each one?

4. A customer's security team wants WAF access but no access to billing. What role do you assign them?

5. You want to write a script that deploys the same WAF rule to 50 zones simultaneously. What API endpoint pattern do you use?

---

**Your Answers:**

1. 

2. 

3. 

4. 

5. 

---

**Sources:**
- [Cloudflare Accounts and Zones](https://developers.cloudflare.com/fundamentals/concepts/accounts-and-zones/)
- [Cloudflare API Authentication](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [Cloudflare Roles](https://developers.cloudflare.com/fundamentals/setup/manage-members/roles/)
- [Wrangler Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Terraform Provider](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs)
