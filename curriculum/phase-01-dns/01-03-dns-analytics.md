# Module 1.3 — DNS Analytics

> **Dashboard Location:** `macksportreport.com` → DNS → Analytics  
> **Estimated Time:** 30 minutes  
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What DNS Analytics Shows You

DNS Analytics provides visibility into every DNS query made for your domain. This is data most DNS providers don't expose at all — Cloudflare makes it part of the standard dashboard.

You can see:
- **Query volume** — How many DNS lookups per time period
- **Query type breakdown** — A, AAAA, MX, TXT, etc.
- **Response codes** — NOERROR, NXDOMAIN, SERVFAIL, etc.
- **Geographic distribution** — Where queries are coming from
- **Trends** — Spikes that might indicate bot scanning, migration issues, or misconfiguration

### The Key Response Codes

| Code | Meaning | What It Tells You |
|------|---------|-------------------|
| **NOERROR** | Query answered successfully | Normal traffic |
| **NXDOMAIN** | Domain/record does not exist | Misconfigured apps querying non-existent subdomains, or bots probing |
| **SERVFAIL** | DNS server failed to answer | DNSSEC validation failure, upstream resolver issue |
| **REFUSED** | Server refused to answer | Access control, not your zone |
| **NODATA** | Record exists but no matching type | Querying for AAAA when only A exists |

### Why DNS Analytics Matters for Security

**NXDOMAIN spike = signal of probing.** If you see thousands of NXDOMAIN responses for subdomains you've never configured (e.g., `admin.macksportreport.com`, `stage.macksportreport.com`), that's likely automated subdomain brute-forcing. Attackers probe for exposed subdomains to find forgotten servers.

**SERVFAIL spike = misconfiguration.** If SERVFAIL suddenly spikes after you enabled DNSSEC, your DS record at the registrar is probably wrong.

**Query volume spike = traffic event.** If queries triple overnight, something is driving users to your domain (viral content, a DDoS using DNS queries, or someone misconfigured your domain somewhere).

### DNS Queries vs HTTP Requests

These are different metrics:
- **DNS query** = Someone looked up your domain's IP. This happens once and is cached.
- **HTTP request** = Someone actually connected and made a request. This is what your Analytics > HTTP Traffic shows.

A single user visiting your site might generate 1 DNS query and 50 HTTP requests (for the page, images, JS, CSS, etc.). DNS queries will always be much lower than HTTP requests.

---

## Deep Dive (Architect-Level)

### DNS Anycast and Query Distribution

Cloudflare's DNS uses the same anycast network as its HTTP proxy. A DNS query from Tokyo hits a Cloudflare data center in Tokyo, not one in San Francisco. This is why Cloudflare DNS is so fast — there's no geographic round-trip.

The analytics reflect this: you can see queries distributed globally, each being answered by the nearest PoP.

### The DNS Firewall (Enterprise Add-On)

Cloudflare DNS Firewall is a separate product from zone DNS. It's a **DNS proxy/resolver** for enterprise customers who want to:
- Shield their authoritative nameservers from direct DNS DDoS
- Apply rate limiting on DNS queries
- Cache DNS responses at the edge

Architecture:
```
User → Cloudflare DNS Firewall → Your Authoritative Nameserver
                ↓
        (caches responses, absorbs DDoS)
```

Not visible in the standard DNS > Analytics — it has its own dashboard under the account level.

### GraphQL API for DNS Analytics

For custom dashboards or deeper analysis:
```graphql
{
  viewer {
    zones(filter: {zoneTag: "your-zone-id"}) {
      dnsAnalyticsAdaptiveGroups(
        filter: {date_geq: "2024-01-01", date_leq: "2024-01-07"}
        limit: 10
        orderBy: [count_DESC]
      ) {
        count
        dimensions {
          queryType
          responseCode
          coloName
        }
      }
    }
  }
}
```

This same data can be pushed via Logpush (Module 9.11) to Datadog, Splunk, or your SIEM.

---

## Dashboard Walkthrough

### The DNS Analytics Page

Navigate to: `macksportreport.com → DNS → Analytics`

**Time range selector** (top right):
- Last 24 hours (default)
- Last 7 days
- Last 30 days
- Custom range (Enterprise)

**Query Volume chart:**
- X-axis: time
- Y-axis: query count
- Hover to see specific counts per time bucket

**Response Code distribution:**
- Pie chart or bar chart showing NOERROR vs NXDOMAIN vs SERVFAIL percentages

**Query Type breakdown:**
- How many A queries vs AAAA vs MX vs TXT
- Useful for understanding what clients are asking for

**Stale Record indicator:**
- If you have records that haven't received queries in a long time, they appear here
- Helps identify unused/legacy records to clean up

---

## Hands-On Lab

### Lab 1.3: Explore Your DNS Analytics

**Step 1: Open DNS Analytics**
```
dash.cloudflare.com → macksportreport.com → DNS → Analytics
```

Answer:
- What's the query volume over the last 7 days? ________________
- What percentage of queries are NOERROR? ________________
- Any NXDOMAIN queries? If yes, for what subdomains? ________________
- What query types are most common? ________________

**Step 2: Generate test queries to see them in analytics**
```bash
# Query your domain several times across different record types
for i in {1..10}; do
  dig A macksportreport.com @1.1.1.1 +short
  dig AAAA macksportreport.com @1.1.1.1 +short
  dig MX macksportreport.com @1.1.1.1 +short
  sleep 1
done

# Generate some NXDOMAIN entries
dig A thisdoesnotexist.macksportreport.com @1.1.1.1 +short
dig A anothernonexistent.macksportreport.com @1.1.1.1 +short
```

Wait 2–5 minutes and refresh DNS Analytics. You should see your test queries appear.

**Step 3: Query DNS analytics via GraphQL API**
```bash
# Get DNS query stats for the last 24 hours
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{
      viewer {
        zones(filter: {zoneTag: \"'"$ZONE_ID"'\"}) {
          httpRequests1dGroups(limit: 1, filter: {date_geq: \"2024-01-01\"}) {
            sum { requests }
          }
        }
      }
    }"
  }' | jq '.'
```

**Step 4: Set up an alert for NXDOMAIN spike**
```
Account Home → Notifications → Create Notification
→ Type: DNS Query (requires paid plan for some alerts)
```

Note: Full DNS alerting is more available on Enterprise. On free/pro you can set up health check alerts.

---

## Demo Script (2 Minutes)

> Use when showing observability capabilities to a security-conscious customer

"One thing customers are always surprised by is that we give you visibility into your DNS traffic, not just your web traffic. This is important for security because DNS is often the first signal of reconnaissance.

If I see a spike in NXDOMAIN responses — queries for subdomains that don't exist — that's usually automated subdomain enumeration. Someone is probing your attack surface. Same data that a threat intel team would pay serious money for on a separate platform, it's just here in the dashboard as part of the service.

And for troubleshooting, DNS analytics is incredibly useful. Before a customer calls us saying 'our site was down,' I can usually pull this data and see the SERVFAIL rate — if it spiked at 2am, I know exactly when something broke. That kind of root cause analysis shortens incident resolution from hours to minutes."

---

## Competitive Context

| Feature | Cloudflare DNS Analytics | Route53 | NS1 | Dyn |
|---------|-------------------------|---------|-----|-----|
| **Query volume data** | Included free | CloudWatch (extra cost) | Included | Dashboard included |
| **Response code breakdown** | Yes | Yes (via CloudWatch) | Yes | Yes |
| **NXDOMAIN detail** | Yes | No (aggregate only) | Yes | Limited |
| **Geographic distribution** | Yes | Limited | Yes | Yes |
| **Data retention** | 7-30 days | 14 days (CloudWatch) | 7 days free | 30 days |
| **GraphQL API** | Yes | No | REST API | REST API |
| **Cost** | Free | $0.01/1,000 CloudWatch metrics | Included | Included |

---

## Self-Check Questions

1. A customer's site is "down" but you can see in HTTP Analytics that requests are still coming through. You check DNS Analytics and see a SERVFAIL spike. What's the most likely root cause?

2. You see 10,000 NXDOMAIN queries in 1 hour for random subdomains like `stage-old`, `dev2`, `jenkins`. What's happening and what should the customer do?

3. Why does a single page load generate multiple DNS queries? Can you estimate how many for a typical modern web page?

4. A customer asks "can I see which countries my users are coming from at the DNS level?" What do you tell them?

5. What's the difference between a DNS query and an HTTP request in the context of Cloudflare analytics?

---

**Your Answers:**

1. 

2. 

3. 

4. 

5. 

---

**Sources:**
- [DNS Analytics](https://developers.cloudflare.com/dns/additional-options/analytics/)
- [Cloudflare GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/)
- [DNS Response Codes](https://www.iana.org/assignments/dns-parameters/dns-parameters.xhtml#dns-parameters-6)
- [DNS Firewall](https://developers.cloudflare.com/dns/dns-firewall/)
