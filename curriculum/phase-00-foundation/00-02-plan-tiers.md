# Module 0.2 — Plan Tiers & Feature Matrix

> **Dashboard Location:** Account Home → Billing, or zone sidebar (plan indicator at bottom)  
> **Estimated Time:** 30 minutes  
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### Why Plans Matter

Understanding Cloudflare's plan structure is critical for two reasons:
1. **For yourself:** You need to know which features you can demo on your free/pro zone vs. what requires Enterprise
2. **For customers:** Every customer conversation eventually hits "what plan do I need for X?" — you need the answer instantly

Cloudflare has 4 zone-level plans plus an Enterprise package:

| Plan | Monthly Price | Target Customer |
|------|--------------|-----------------|
| **Free** | $0 | Hobby sites, developers, small blogs |
| **Pro** | $20/month | Small businesses, personal professional sites |
| **Business** | $200/month | E-commerce, SaaS, SMBs with compliance needs |
| **Enterprise** | Custom (typically $3K-$30K+/month) | Large companies, high traffic, advanced security, SLAs |

> Note: Some products have separate add-on pricing (Load Balancing, Argo, Workers, etc.) that layered on top of the base plan.

### The Core Free Tier Philosophy

Cloudflare's free tier is the most generous in the industry on purpose — it creates developer adoption and brand loyalty. The free tier includes:
- Full WAF (with managed rules)
- Global CDN and caching
- DDoS mitigation (unmetered)
- Authoritative DNS (fastest globally)
- SSL/TLS (Universal SSL with Let's Encrypt)
- Workers (100K requests/day)
- Zero Trust (50 users free)

This is deliberately more capable than most competitors' paid tiers.

### Key Upgrade Triggers (Pro)

When a customer needs to go from Free to Pro ($20/month):
- **Bot fight mode** — Advanced bot blocking
- **Automatic Platform Optimization (APO)** — For WordPress
- **Image Optimization (Polish, Mirage)** — Automatic image resizing and WebP
- **Better WAF analytics** — Sampled logs on Free, full logs on Pro+
- **Priority support** — Chat support included
- **Advanced cache analytics**

### Key Upgrade Triggers (Business)

When a customer needs Pro → Business ($200/month):
- **Custom WAF rules** — 100 custom firewall rules (vs 5 on Pro)
- **Custom SSL certificates** — Upload your own cert
- **Custom caching rules** — More granular control
- **100% SLA** — Business has a formal uptime guarantee
- **Bypass Cache on Cookie** — Advanced cache rules
- **Advanced rate limiting** — More complex rules
- **Argo Smart Routing** — Available as add-on
- **3-day log retention** (vs 24h on Free/Pro)

### Key Upgrade Triggers (Enterprise)

Enterprise is a fundamentally different product:
- **Dedicated Customer Success Manager and Solutions Engineer**
- **Custom rate limits** — No hard caps on rules
- **Advanced DDoS protection** — Magic Transit, full L3/L4 mitigation
- **Advanced Certificate Manager** — Multi-SAN, wildcard, custom CAs
- **Cloudflare for SaaS** — Custom hostnames at scale
- **30-day log retention and Logpush**
- **Workers Unbound** — No CPU time limits
- **Durable Objects GA access**
- **Priority routing** — Service-level agreements on response
- **Custom error pages** — With full HTML/CSS branding
- **Custom analytics integrations**
- **Private deployment options** (Cloudflare One/Zero Trust)
- **FIPS compliance** — For government/financial customers
- **Custom contracts** — Volume discounts, custom terms

---

## Deep Dive (Architect-Level)

### The Add-On Economy

Many of Cloudflare's most valuable features are **add-ons** that sit on top of any base plan. This is important to understand because it affects how you scope a customer's bill:

| Add-On | Base Price | What It Unlocks |
|--------|-----------|-----------------|
| **Argo Smart Routing** | ~$5/month + $0.10/GB | Tiered caching + optimized backbone routing |
| **Load Balancing** | $5/month + per-check pricing | L7 load balancing, health checks |
| **Rate Limiting** | $0.05/10K requests checked | Advanced rate limiting rules |
| **Workers Paid** | $5/month + $0.50/million requests | Removes daily limit, adds CPU time limits |
| **Workers KV** | $5/month + reads/writes/storage | Key-value storage at edge |
| **R2** | $0.015/GB stored + operations | S3-compatible object storage |
| **D1** | $0.001/million reads + writes/storage | SQLite at the edge |
| **Queues** | $0.40/million operations | Message queuing |
| **Vectorize** | Pay per dimension + queries | Vector database |
| **AI Gateway** | Free up to limits | LLM proxy, caching, logging |
| **Waiting Room** | Add-on, Enterprise typically | Virtual queue for traffic spikes |
| **Magic Transit** | Custom (BGP-level) | Network-layer DDoS for IP ranges |
| **Access (Zero Trust)** | 50 users free, then $3-7/user | Identity-aware application access |
| **Gateway (Zero Trust)** | 50 users free, then $3-7/user | Secure web gateway, DNS filtering |
| **Browser Isolation** | Add-on | Remote browser for Zero Trust |
| **DLP** | Add-on | Data loss prevention |
| **Email Security (Area 1)** | Add-on | Phishing/BEC protection |
| **Advanced DDoS** | Included in Enterprise | L3/L4 mitigation for custom IP ranges |

### Zones vs. Accounts

- The plan price applies per **zone** (domain)
- Workers, R2, D1, KV, Vectorize, etc. are **account-level** — one bill covers all zones
- Zero Trust (Access, Gateway, WARP) is **account-level** with user-based pricing
- If you have 3 domains, you pay 3x the zone plan price but only once for account-level products

### Enterprise Contract Structure

Enterprise deals are typically structured as:
- **Annual contract** with committed spend
- **Overage clauses** for bandwidth above committed tiers
- **Add-ons negotiated separately** — DDoS, Magic Transit, SASE, etc.
- **Professional Services** — Implementation, migration, configuration
- **Support tiers** — Standard, Critical (P1 escalation, <1hr response)

For your SE role: enterprise deals are usually sourced by knowing exactly what the customer's current pain is (attack costs, latency, compliance), building a TCO comparison, and showing Cloudflare's unmetered DDoS + unified platform eliminates line-item costs they pay AWS/Akamai/Imperva separately.

---

## Dashboard Walkthrough

### Finding Your Plan

1. Go to `dash.cloudflare.com` → select `macksportreport.com`
2. Scroll to the **bottom of the left sidebar** — your current plan is shown
3. Click **Upgrade** to see the plan comparison matrix

### Reading the Plan Comparison Table

The Cloudflare plan comparison page shows features in three categories:
- **Security** — WAF rules, bot management, DDoS, rate limiting
- **Performance** — Caching, image optimization, Argo, speed features
- **Reliability** — Load balancing, health checks, SLA percentage

### Billing & Invoices

- **Account Home → Billing** — Subscription details, invoices, payment methods
- Add-ons appear as line items separate from the base zone plan
- Workers, R2, D1 are metered — billed monthly based on actual usage

---

## Hands-On Lab

### Lab 0.2: Audit What You Have and What's Missing

**Step 1: Check your current plan**
```
Cloudflare Dashboard → macksportreport.com → (bottom of sidebar) → Plan: Free/Pro/Business
```
Record it: ______________

**Step 2: Open the plan comparison**
```
Dashboard → Upgrade → Compare Plans
```
Read through every row. For each feature you don't recognize, write it down to study later.

**Step 3: Check which add-ons are enabled**
```
Account Home → Billing → Subscriptions
```
List what's active: ______________

**Step 4: Find the feature flag differences in real config**

Go to Security > Security Rules:
- How many custom WAF rules can you create on your current plan?
- Can you enable the full OWASP managed ruleset?
- Note any "Upgrade to X to enable" banners you see

**Step 5: Workers pricing exercise**

Calculate what it would cost to run the `ai-sales-copilot` Workers project if it received:
- 500K requests/day
- Average 5ms CPU time per request

Use the [Workers pricing calculator](https://developers.cloudflare.com/workers/platform/pricing/):
- Requests cost: ________________
- CPU time cost: ________________
- Total estimated monthly cost: ________________

---

## Demo Script (2 Minutes)

> Use this when a customer asks about pricing or "what plan do I need?"

"Cloudflare's pricing is built on a philosophy I really like: you shouldn't have to pay for protection. The free tier includes real WAF protection, unmetered DDoS mitigation, and global CDN — things that would cost you thousands of dollars elsewhere. We do this intentionally because the more of the internet that's protected, the better it is for everyone.

Now, as you grow, the upgrade path is pretty clear. Pro at $20/month gets you better bot management and image optimization. Business at $200/month gets you serious custom rule capacity and compliance features. Enterprise is where the big levers are: no hard caps, dedicated support, advanced DDoS for your own IP ranges, and Zero Trust at scale.

The thing that usually surprises customers is how much is account-level, not zone-level. Workers, R2, D1, Vectorize — you pay once and all your domains share it. That's a huge cost advantage if you're running multi-domain architectures."

---

## Competitive Context

| Capability | Cloudflare Free | AWS WAF + CloudFront | Akamai Kona SWG |
|-----------|----------------|---------------------|-----------------|
| **WAF** | Included, managed rules | $5/month + $0.60/million requests | Enterprise only |
| **DDoS mitigation** | Unmetered, free | Shield Standard free, Shield Advanced $3K+/month | Enterprise add-on |
| **CDN** | Included | Pay per GB egress | Enterprise add-on |
| **DNS** | Included, fastest globally | Route53 $0.50/hosted zone + queries | Separate product |
| **Edge compute** | 100K requests/day free | Lambda@Edge $0.60/million + compute | EdgeWorkers, limited |
| **Zero Trust** | 50 users free | Multiple products (Cognito, VPN) | Separate product |
| **Bottom line** | **One bill, one login, one API** | **6+ products, 6+ billing lines** | **Enterprise contracts for everything** |

---

## Self-Check Questions

1. A startup founder asks "Can I use Cloudflare's WAF for free?" What's the correct answer?

2. A customer is on Pro and wants to push 500K custom WAF rules. Is that possible? What plan do they need?

3. What's the difference between zone-level pricing and account-level pricing? Give an example of each.

4. A company has 10 domains and needs Workers for all of them. How many Workers paid subscriptions do they need?

5. When does the Cloudflare Enterprise conversation make financial sense vs. Pro/Business?

---

**Your Answers:**

1. 

2. 

3. 

4. 

5. 

---

**Sources:**
- [Cloudflare Plans Comparison](https://www.cloudflare.com/plans/)
- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Zero Trust Pricing](https://www.cloudflare.com/plans/zero-trust-services/)
- [Cloudflare for SaaS Pricing](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/)
