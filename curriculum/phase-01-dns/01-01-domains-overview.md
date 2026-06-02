# Module 1.1 — Domains Overview & Zone Setup

> **Dashboard Location:** `macksportreport.com` → Overview (first screen after clicking a domain)  
> **Estimated Time:** 45 minutes  
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Is a Zone?

In Cloudflare's terminology, a **zone** is a domain and all its subdomains. When you add `macksportreport.com` to Cloudflare, you create one zone. The zone includes:
- `macksportreport.com` (apex)
- `www.macksportreport.com`
- `api.macksportreport.com`
- `*.macksportreport.com` (wildcard)

Subdomains are NOT separate zones by default — they share the parent zone's configuration.

### Zone Setup: Full vs Partial (CNAME) Setup

There are two ways to onboard a domain to Cloudflare:

**Full Setup (recommended):**
- You delegate the entire domain's DNS to Cloudflare nameservers
- Cloudflare becomes your **authoritative nameserver**
- All DNS records managed in Cloudflare dashboard
- All Cloudflare features available (security, caching, performance)
- Requires changing nameservers at your registrar (GoDaddy, Namecheap, etc.)

**Partial Setup (CNAME setup — Enterprise only):**
- You keep your existing DNS provider
- You create CNAME records pointing specific hostnames to Cloudflare
- Your DNS still lives at your current provider
- Only specific hostnames benefit from Cloudflare (not the apex domain)
- Common for large enterprises that can't change nameservers easily
- Also used for Cloudflare for SaaS (custom hostnames)

**For 95% of customers:** Full setup is the right choice.

### Zone Activation Status

A zone goes through these states:
1. **Pending** — Nameservers changed at registrar but Cloudflare hasn't verified yet (can take minutes to 48 hours)
2. **Active** — Cloudflare confirmed it's the authoritative nameserver. All features enabled.
3. **Moved** — Nameservers pointed away from Cloudflare. Zone is deactivated.
4. **Deleted** — Zone removed from account.

During **Pending**, Cloudflare is not processing traffic. The domain is still served directly from wherever it was before.

### Recents & Navigation

The "Recents" section in the dashboard sidebar shows your recently visited zones. This is useful when managing multiple domains — you can jump between them quickly.

---

## Deep Dive (Architect-Level)

### How Nameserver Delegation Works

When you register `macksportreport.com`, the registrar (e.g., Namecheap) sets NS records at the **TLD level** (`.com` nameservers operated by Verisign). Those NS records point to your **authoritative nameserver**.

When you add the domain to Cloudflare:
1. Cloudflare assigns you two nameservers (e.g., `elmo.ns.cloudflare.com`, `wanda.ns.cloudflare.com`)
2. You go to your registrar and update the NS records for `macksportreport.com` to those two Cloudflare nameservers
3. Verisign's TLD nameservers now say: "for `macksportreport.com`, ask `elmo.ns.cloudflare.com`"
4. Cloudflare's nameservers respond to DNS queries with the records you configured in the dashboard

This is called "cut over" — the moment nameservers switch, all DNS queries for your domain go to Cloudflare.

### The TTL Consideration During Migration

DNS records have TTLs (time-to-live). Before cutting over nameservers, you should reduce TTLs at your old provider to 60 seconds or less. This minimizes how long cached DNS records persist after the cutover. If you forget and your TTL is 24 hours, some users will continue hitting your old DNS for up to 24 hours after the cutover.

After cutover is stable, you can increase TTLs again. For most zones, 300 seconds (5 minutes) is a good default. For very stable records (like MX records), 3600–86400 is fine.

### Zone Hold / Zone Override (Enterprise)

Enterprise customers with complex setups can use:
- **Zone Hold** — Prevents a zone from being deleted accidentally. Common in agencies that manage zones for clients.
- **Account Hold** — Prevents account-level changes without explicit unlock.

### Adding Zones via API

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "macksportreport.com",
    "account": { "id": "your-account-id" },
    "jump_start": true,
    "type": "full"
  }'
```

The `jump_start: true` flag automatically imports existing DNS records from the current nameservers. Cloudflare does a DNS lookup and imports what it finds. Very useful for migrations.

---

## Dashboard Walkthrough

### The Zone Overview Page

After clicking `macksportreport.com`:

**Top section:**
- Zone name + domain
- Plan badge (Free/Pro/Business/Enterprise)
- Status indicator (Active/Pending)

**Quick Actions panel:**
- Add a site
- Enable HTTPS
- Set up email
- Speed test link
- Common shortcuts to frequently changed settings

**Domain Summary card:**
- Nameservers assigned (copy these for your registrar)
- Auto-renewal status
- Registrar (if registered through Cloudflare Registrar)
- Last zone settings change

**Security Overview card:**
- Active threats blocked (last 24h)
- WAF events
- Bot traffic percentage

**Performance Overview card:**
- Cache hit rate (% of requests served from cache)
- Bandwidth saved
- Request volume

**Activity Feed:**
- Recent configuration changes (who changed what, when)
- Useful for auditing or debugging "what changed?"

### The "Back to Domains" Link

Top of the left sidebar. Takes you back to the account home where all your zones are listed. This is how you switch between domains without going back to the full account URL.

---

## Hands-On Lab

### Lab 1.1: Explore Your Zone Setup

**Step 1: Verify your zone is active and correctly configured**
```bash
# Check nameservers
dig NS macksportreport.com +short
# Should return Cloudflare nameservers

# Check that Cloudflare IPs are returned for the apex
dig A macksportreport.com +short
# Should return 104.x.x.x or 172.x.x.x

# Check with Google's DNS to confirm global propagation
dig A macksportreport.com @8.8.8.8 +short
```

**Step 2: Explore the Zone Overview in the dashboard**
```
dash.cloudflare.com → macksportreport.com → Overview
```
Answer these questions:
- What's your current plan? ________________
- What's your cache hit rate over the last 24 hours? ________________
- How many security events (threats blocked) in the last 24 hours? ________________
- When was the last configuration change made? ________________

**Step 3: Test a Zone API call**
```bash
export CF_API_TOKEN="your-token"
export ZONE_ID="your-zone-id"

curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '{name: .result.name, status: .result.status, plan: .result.plan.name, nameservers: .result.name_servers}'
```

Record the output: ________________

**Step 4: Check zone settings via API**
```bash
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '.result[] | select(.id == "ssl" or .id == "http3" or .id == "min_tls_version") | {id, value}'
```

This shows you current SSL mode, HTTP/3 status, and TLS version settings — the core zone settings you'll use frequently.

---

## Demo Script (2 Minutes)

> Use this when a customer is considering migrating to Cloudflare or asks about onboarding

"Onboarding a domain to Cloudflare takes about 5 minutes. You add the domain, and we automatically scan your existing DNS records so nothing breaks. Then we give you two nameservers to set at your registrar. Once that propagates — usually within minutes, though it can take up to 24 hours — your traffic starts flowing through Cloudflare.

From that moment, every feature in the dashboard is available. WAF, CDN, DNS management, SSL — it all just works. You don't have to install anything, there's no agent, no code changes. That's the beauty of being a reverse proxy — we're in the path of every request, so we can add any capability without touching your origin.

For large enterprises who can't change nameservers — legacy setups, compliance reasons, massive DNS complexity — we have a CNAME setup option where you proxy specific hostnames through us while keeping your existing DNS provider. Less capability, but zero disruption to the rest of the domain."

---

## Competitive Context

| Feature | Cloudflare Full Setup | AWS Route53 + CloudFront | GoDaddy (Registrar only) |
|---------|----------------------|--------------------------|--------------------------|
| **DNS management** | Full dashboard + API | Route53 (separate service) | Basic only |
| **Auto-import existing records** | Yes (jump_start) | Manual import | No |
| **WAF on proxy** | Instant, same dashboard | CloudFront + WAF (separate services) | No |
| **Time to first protection** | Minutes after NS change | Hours of configuration | No protection |
| **Cost** | Free plan includes everything | $0.50/zone/month DNS + CloudFront + WAF costs | Free DNS, no security |

---

## Self-Check Questions

1. A customer asks "what happens to my website during the nameserver cutover?" Give a clear, accurate answer.

2. What is the difference between Full Setup and CNAME/Partial setup? When would you recommend each?

3. A customer says "we've been Pending for 3 days — what's wrong?" What are the top 3 things to check?

4. Why would you lower DNS TTLs BEFORE migrating to Cloudflare? What happens if you don't?

5. You need to add 50 domains to Cloudflare at once for a customer migration. What's the most efficient approach?

---

**Your Answers:**

1. 

2. 

3. 

4. 

5. 

---

**Sources:**
- [Get Started with Cloudflare](https://developers.cloudflare.com/fundamentals/get-started/)
- [Zone Setups](https://developers.cloudflare.com/dns/zone-setups/)
- [Add a Site](https://developers.cloudflare.com/fundamentals/setup/account-setup/add-site/)
- [Cloudflare DNS Overview](https://developers.cloudflare.com/dns/)
- [API: Create Zone](https://developers.cloudflare.com/api/operations/zones-post)
