# Module 2.5 — Custom Hostnames (Cloudflare for SaaS)

> **Dashboard Location:** `macksportreport.com` → SSL/TLS → Custom Hostnames  
> **Estimated Time:** 60 minutes  
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### The Problem Custom Hostnames Solve

You're building a SaaS product. Your customers want to use their own domain — `app.theircustomer.com` — instead of your subdomain `theircustomer.yourapp.com`. This is a white-label domain feature.

**Without Cloudflare for SaaS:**
- Customer points `app.theircustomer.com` CNAME to `yourapp.com`
- You need to issue an SSL certificate for `app.theircustomer.com`
- You repeat this for hundreds of customers
- You manage certificate issuance, renewal, and deployment for hundreds of certs
- This is operationally painful

**With Cloudflare for SaaS:**
- Customer points their DNS CNAME to your Cloudflare **fallback origin**
- Cloudflare automatically provisions and renews SSL for every custom hostname
- You manage one Cloudflare zone; Cloudflare handles thousands of certs
- Scales to millions of custom hostnames

### Key Concepts

**Fallback Origin:**
The hostname where all traffic for custom hostnames ultimately goes. You configure this on your zone. Example: `fallback.macksportreport.com` → your server at `203.0.113.1`.

**Custom Hostname:**
A hostname owned by your customer (e.g., `app.theircustomer.com`) that Cloudflare serves traffic for, pointing to your fallback origin.

**Custom Hostname Owner (your customer):**
They just need to CNAME `app.theircustomer.com` to your designated "callback target" (usually a subdomain of your domain).

**SSL for Custom Hostnames:**
Cloudflare issues a certificate for `app.theircustomer.com` automatically. Customer gets HTTPS on their custom domain with no SSL management on their end.

### The Validation Flow

1. Customer: "I want `app.theircustomer.com` to use your product"
2. You: Create a custom hostname record for `app.theircustomer.com` in Cloudflare API
3. Cloudflare: Creates DCV (domain control validation) challenge for `app.theircustomer.com`
4. You tell customer: "Add this TXT record (or CNAME) to validate your domain"
5. Customer: Adds the validation record at their DNS provider
6. Cloudflare: Issues SSL certificate for `app.theircustomer.com`
7. Customer: Creates CNAME `app.theircustomer.com → yourcallbacktarget.com`
8. Done: Traffic flows and is SSL-terminated at Cloudflare edge

### Hostname Routing

When a request hits Cloudflare for `app.theircustomer.com`, how does Cloudflare know to route it to your zone?

Answer: The customer's CNAME points to a **callback target** you designate under your domain. Cloudflare recognizes this as a custom hostname and applies your zone's rules to it.

Example:
```
Customer:    app.theircustomer.com  CNAME →  yourcb.macksportreport.com
Your zone:   yourcb.macksportreport.com  A  →  203.0.113.1 (your server)
```

---

## Deep Dive (Architect-Level)

### Custom Hostname Architecture Diagram

```
app.theircustomer.com 
    ↓ CNAME
yourcb.macksportreport.com 
    ↓ Cloudflare recognizes as custom hostname
Cloudflare Edge
    ├── Applies macksportreport.com zone rules (WAF, cache, Workers)
    ├── Uses Cloudflare-issued cert for app.theircustomer.com
    └── Forwards to fallback.macksportreport.com
         ↓
Your Origin Server
```

### Custom Hostname Lifecycle via API

**Create custom hostname:**
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/custom_hostnames" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "hostname": "app.theircustomer.com",
    "ssl": {
      "method": "txt",
      "type": "dv",
      "settings": {
        "http2": "on",
        "min_tls_version": "1.2"
      }
    }
  }'
```

**Get validation details:**
```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/custom_hostnames?hostname=app.theircustomer.com" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '.result[0].ssl.validation_records'
# Returns the TXT record the customer must add for DCV
```

**Check status:**
```bash
# Poll until status is "active"
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/custom_hostnames?hostname=app.theircustomer.com" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '.result[0].status'
# "active" = SSL provisioned and active
# "pending_validation" = waiting for customer DCV
# "pending_issuance" = validated, cert being issued
```

**Delete custom hostname:**
```bash
# Get hostname ID first
HOSTNAME_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/custom_hostnames?hostname=app.theircustomer.com" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[0].id')

curl -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/custom_hostnames/$HOSTNAME_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN"
```

### Per-Hostname Configuration

Custom hostnames can have per-hostname SSL settings:
- **Minimum TLS version** per hostname
- **TLS 1.3** per hostname
- **HTTP/2** per hostname
- **Certificate type** (DV, custom cert)
- **Custom metadata** — Attach JSON metadata to each hostname for use in Workers

### Custom Hostname Metadata + Workers

This is powerful for multi-tenant routing in Workers:

```javascript
// workers/src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const hostname = request.headers.get("host");
    
    // CF attaches custom hostname metadata to the request
    const cfMeta = request.cf as any;
    const customHostnameMeta = cfMeta?.customHostnameMetadata;
    
    // customHostnameMeta might contain: {tenantId: "abc123", plan: "premium"}
    // Route the request based on tenant
    if (customHostnameMeta?.tenantId) {
      return routeToTenant(request, customHostnameMeta.tenantId);
    }
    
    return new Response("Unknown tenant", { status: 404 });
  }
}
```

You attach metadata when creating the custom hostname:
```json
{
  "hostname": "app.theircustomer.com",
  "custom_metadata": {
    "tenantId": "cust_abc123",
    "plan": "premium",
    "region": "us-east-1"
  }
}
```

### Wildcard Custom Hostnames

For `*.theircustomer.com` (all subdomains):
- Requires customer to validate the wildcard
- Cloudflare issues a wildcard cert for `*.theircustomer.com`
- Any subdomain of `theircustomer.com` routes to your zone

### Pricing

Custom Hostnames is an **Enterprise feature** or a paid add-on:
- First 100 hostnames: included in Enterprise
- Additional hostnames: ~$0.10/hostname/month
- Can scale to millions of hostnames

---

## Dashboard Walkthrough

### Custom Hostnames Page

Navigate to: `macksportreport.com → SSL/TLS → Custom Hostnames`

**Fallback Origin setup (first time):**
1. Click **Configure Custom Hostnames**
2. Enter fallback origin: `fallback.macksportreport.com` (must be a hostname in your zone)
3. Save

**Custom Hostnames list:**
- All active custom hostnames
- Status column: active, pending_validation, pending_issuance, blocked
- Certificate status: issued, pending
- Edit/Delete buttons

**Adding a custom hostname:**
1. Click **+ Add Custom Hostname**
2. Enter the customer's hostname: `app.theircustomer.com`
3. Choose SSL validation method: TXT record or CNAME
4. Save
5. Cloudflare shows the validation record(s) customer must add
6. Give these to your customer

**Monitoring status:**
Check the Status column:
- **Active** — Working perfectly
- **Pending validation** — Customer hasn't added the DCV record yet
- **Pending issuance** — DCV passed, cert being issued (can take up to 15 min)
- **Blocked** — CAA conflict or rate-limited by CA

---

## Hands-On Lab

### Lab 2.5: Set Up a Custom Hostname

Since you may not have a second domain to test with, this lab uses the API and simulates the workflow.

**Step 1: Set up a fallback origin for your zone**

First create the fallback origin DNS record:
```
DNS → Records → Add:
Type: A
Name: fallback
Content: [your origin IP or 127.0.0.1 for testing]
Proxy: ON
```

Then configure fallback origin:
```bash
curl -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/custom_hostnames/fallback_origin" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"origin": "fallback.macksportreport.com"}'
```

**Step 2: Create a test custom hostname using a subdomain you control**

If you have a second domain, use that. Otherwise use a subdomain:
```bash
# Use a subdomain of macksportreport.com that isn't already proxied
# Or use a test subdomain you own

curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/custom_hostnames" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "hostname": "test-custom.yourtestdomain.com",
    "ssl": {
      "method": "txt",
      "type": "dv"
    },
    "custom_metadata": {
      "tenantId": "test_001",
      "plan": "pro"
    }
  }' | jq '.'
```

**Step 3: Get the validation records**
```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/custom_hostnames?hostname=test-custom.yourtestdomain.com" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '.result[0] | {
    status: .status,
    ssl_status: .ssl.status,
    validation_records: .ssl.validation_records
  }'
```

Note the TXT record you'd need to add at the customer's DNS provider.

**Step 4: List all custom hostnames and their statuses**
```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/custom_hostnames" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '.result[] | {hostname, status, ssl_status: .ssl.status}'
```

**Step 5: Explore custom hostname metadata in a Worker**

Review the metadata pattern from the Deep Dive section above. Understand how a multi-tenant SaaS platform would use this to route requests to different tenant configs.

---

## Demo Script (2 Minutes)

> Use when talking to a SaaS company or platform product team

"If you're building a SaaS product and you want to offer custom domains to your customers — so they see `app.their-company.com` instead of `their-company.yourproduct.com` — this is how you do it at scale.

Normally, handling custom domains is a nightmare: certificate issuance per customer, managing renewals, deploying certs across your infra. With Cloudflare for SaaS, we turn that into an API call. You create a custom hostname record for each customer via API, we handle the DCV, the cert issuance, the renewal, the global deployment. Your customer just adds a CNAME record.

The part I find really clever is the metadata field. You can attach a JSON object to each custom hostname — tenant ID, plan tier, routing config — and that metadata rides along with every request. Your Worker reads it and can route the tenant's traffic differently based on their plan, region, or account setup. It's a complete multi-tenant routing system built into the edge."

---

## Competitive Context

| Feature | Cloudflare for SaaS | AWS ACM + CloudFront | Netlify |
|---------|---------------------|----------------------|---------|
| **Custom domain SSL** | Automatic, API-driven | Manual ACM issuance per cert | Automatic |
| **Scale** | Millions of hostnames | Hundreds (CloudFront limit) | Thousands |
| **DCV automation** | API + webhook support | Manual | Automatic |
| **Metadata/routing** | Custom metadata + Workers | Lambda@Edge | Plugin system |
| **Time to provision** | Minutes | 30-45 minutes | Minutes |
| **Cost** | ~$0.10/hostname/month | ACM free + CF per-distro | $0/site on Pro+ |
| **WAF on custom hostnames** | Yes (zone rules apply) | Per-distribution WAF | Limited |

---

## Self-Check Questions

1. A SaaS company has 5,000 customers who want custom domains. What is the operational challenge without Cloudflare for SaaS? How does Cloudflare solve it?

2. What is a "fallback origin" in the context of Custom Hostnames? Why is it required?

3. A customer's custom hostname is stuck in "pending_validation" for 48 hours. What do you tell them to check?

4. How would you use custom hostname metadata in a Worker to route traffic differently for paid vs. free tier customers?

5. What's the difference between a regular wildcard DNS record (`*.macksportreport.com`) and a wildcard custom hostname?

---

**Your Answers:**

1. 

2. 

3. 

4. 

5. 

---

**Sources:**
- [Cloudflare for SaaS (Custom Hostnames)](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/)
- [Custom Hostnames API](https://developers.cloudflare.com/api/operations/custom-hostname-for-a-zone-create-custom-hostname)
- [Custom Hostname Metadata](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/hostname-specific-behavior/custom-metadata/)
- [Fallback Origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/#step-3--have-customer-create-cname-record)
- [Workers + Custom Hostnames](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/)
