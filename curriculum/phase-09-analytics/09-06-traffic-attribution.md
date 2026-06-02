# Module 9.6 — Traffic Attribution
> Dashboard Location: macksportreport.com → Analytics → Traffic Attribution
> Estimated Time: 30 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Traffic Attribution in Cloudflare Analytics breaks down incoming traffic by its originating source. While HTTP Traffic Analytics answers "how much traffic?", Traffic Attribution answers "where did it come from?" — categorizing traffic into direct visits, search engines, social media, and referrer domains.

### Attribution Categories

Cloudflare's Traffic Attribution classifies requests into source buckets based on the HTTP `Referer` header present in the request:

| Source Category | Definition | Examples |
|----------------|-----------|---------|
| **Direct** | No Referer header present | Typed URL, bookmarks, some mobile apps |
| **Search** | Referer matches known search engine domains | google.com, bing.com, duckduckgo.com, yahoo.com |
| **Social** | Referer matches known social media domains | facebook.com, twitter.com, linkedin.com, reddit.com |
| **Referral** | Referer present but not search/social | Links from other websites, blog posts |
| **Unknown** | Referer present but unclassified | Less common domains, internal tracking |

### What the Referer Header Actually Contains

The Referer header is set by the browser when a user clicks a link on one page to go to another:

```
GET /article/sports-scores HTTP/1.1
Host: macksportreport.com
Referer: https://www.google.com/search?q=sports+scores+today
```

Cloudflare reads the `Referer` header at the edge and categorizes it. This is simpler than UTM parameter tracking but requires no JavaScript and no user consent — it's pure HTTP header inspection.

### How This Differs from Web Analytics Referrers

**Web Analytics (JavaScript RUM):**
- Reads `document.referrer` in the browser
- Only fires if JavaScript loads successfully
- Captures session-level referrers (first page in a session)
- Subject to same-origin policy nuances

**Traffic Attribution (Edge header inspection):**
- Reads the raw HTTP `Referer` header at Cloudflare's edge
- Fires for every request including API calls, asset loads
- Works even if JavaScript is blocked
- Captures referrers for all resources, not just HTML pages

For pageview-level attribution, the two should be roughly correlated. Discrepancies occur when:
- JavaScript is blocked by extensions or privacy settings
- The site uses a SPA where `document.referrer` doesn't update on route change
- Crawler traffic inflates edge-level referrers

### Privacy and the Referrer Policy

Modern browsers respect the `Referrer-Policy` header set by web pages. If a page sets `Referrer-Policy: no-referrer`, outbound links from that page will not include a Referer header, causing the destination to see those requests as "direct" traffic.

This is important for attributing traffic from HTTPS-to-HTTP redirects (older behavior) and from privacy-focused environments (Brave browser, Firefox Strict Mode).

**Common Referrer-Policy values and their effect on attribution:**

| Policy | Effect on Attribution at Destination |
|--------|--------------------------------------|
| `no-referrer` | All traffic appears as Direct |
| `same-origin` | Only same-domain links include Referer; cross-domain = Direct |
| `strict-origin-when-cross-origin` | Cross-origin requests show only the origin (no path), still classifiable |
| `unsafe-url` | Full URL always sent (legacy behavior) |

---

## Deep Dive (Architect-Level)

### UTM Parameter Tracking vs Header-Based Attribution

Cloudflare's Traffic Attribution does not read UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`). UTM parameters are query string values that marketers add to links for tracking purposes:

```
https://macksportreport.com/?utm_source=newsletter&utm_medium=email&utm_campaign=june2026
```

UTM tracking requires JavaScript to read and process these parameters. Cloudflare Traffic Attribution is purely based on the `Referer` header.

**For SE context:** When customers ask about marketing analytics and campaign attribution, the answer depends on what they need:

- **Traffic source category (organic vs social)** → Cloudflare Traffic Attribution works
- **Specific campaign performance (which email blast drove signups)** → Requires UTM tracking + either Google Analytics or a custom implementation
- **Attribution at the Cloudflare edge without JS** → Only header-based approaches work

### Building UTM Attribution at the Cloudflare Edge

For customers who want UTM attribution without Google Analytics, you can build it with a Worker:

```javascript
// Worker to capture UTM parameters and log them
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Extract UTM parameters if present
    const utmData = {
      source: url.searchParams.get('utm_source'),
      medium: url.searchParams.get('utm_medium'),
      campaign: url.searchParams.get('utm_campaign'),
      content: url.searchParams.get('utm_content'),
      term: url.searchParams.get('utm_term')
    };
    
    // Only process if UTM params are present
    if (utmData.source || utmData.medium || utmData.campaign) {
      // Write to Analytics Engine for custom reporting
      env.ANALYTICS.writeDataPoint({
        blobs: [
          utmData.source || 'unknown',
          utmData.medium || 'unknown',
          utmData.campaign || 'unknown',
          url.pathname
        ],
        doubles: [1],  // event count
        indexes: [utmData.campaign || 'unknown']
      });
      
      // Optionally store in KV for session tracking
      const sessionKey = `utm:${request.headers.get('cf-ray')}`;
      await env.KV.put(sessionKey, JSON.stringify(utmData), { expirationTtl: 1800 });
    }
    
    // Pass through to origin unchanged
    return fetch(request);
  }
};
```

### Traffic Attribution for API Endpoints

API traffic (requests to `/api/*` paths) typically shows as "Direct" because:
- API calls from server-side code don't include `Referer` headers
- Mobile app API calls don't include `Referer` headers
- AJAX requests may or may not include `Referer` depending on the request context

For API traffic attribution, you need custom request metadata headers (`X-Source: mobile-app`) rather than relying on `Referer`.

### Comparing Traffic Attribution Across Time Periods

Useful analytical questions:

1. **Campaign impact:** Did a social media post this week increase social traffic by more than the previous week's baseline?
2. **SEO progress:** Is search traffic growing month-over-month as you publish new content?
3. **Referral quality:** Which referral domains drive the most traffic? Are there unexpected referrers?
4. **Direct traffic baseline:** Direct traffic is typically loyal, returning users. Growth here indicates brand recognition.

---

## Dashboard Walkthrough

### Step 1: Navigate to Traffic Attribution

1. macksportreport.com → Analytics → Traffic Attribution
   (May be under Traffic tab or a separate card in the Analytics overview)

### Step 2: Read the Source Breakdown

The main view shows a pie or bar chart of traffic by source category:
- What percentage is Direct?
- What percentage is from Search?
- What percentage is Referral?

A typical content site might show: 45% direct, 35% search, 12% social, 8% referral.

### Step 3: Drill into Search Traffic

Click on "Search" to expand the source breakdown:
- Which search engines are sending traffic?
- Google vs Bing vs DuckDuckGo distribution
- Changes over time (weekly trend)

### Step 4: Drill into Referral Domains

The referral breakdown shows which specific domains are sending traffic:
- Top referral domains by request volume
- Any unexpected referrers (possible link scraping or hotlinking)

### Step 5: Apply Time Comparison

Use the compare toggle to overlay two periods:
- Did the ratio of social vs search vs direct change after a content initiative?
- Did a specific marketing campaign show up as a traffic source spike on a specific date?

---

## Hands-On Lab

### Prerequisites

- macksportreport.com on Cloudflare (any plan)
- `curl` installed

### Lab 1: Verify Referer Header Processing

```bash
# Make a request with a Referer header (simulating coming from Google)
curl -s -I https://macksportreport.com/ \
  -H "Referer: https://www.google.com/search?q=sports+scores"

# Make a request with a social referer
curl -s -I https://macksportreport.com/ \
  -H "Referer: https://www.twitter.com/"

# Make a request with no referer (direct)
curl -s -I https://macksportreport.com/

# These requests will appear in analytics with different source classifications
echo "Check Traffic Attribution dashboard in ~5 minutes for these requests."
```

### Lab 2: Check Current Referer Policy

```bash
# Check what Referrer-Policy your site is setting
curl -s -I https://macksportreport.com/ | grep -i "referrer-policy"

# If no Referrer-Policy header, the browser default is used
# Modern browser default: strict-origin-when-cross-origin
```

### Lab 3: Simulate Different Traffic Sources

```bash
# Simulate a burst from different sources to see in attribution
SITE="https://macksportreport.com/"

# Search traffic
for i in $(seq 1 5); do
  curl -s -o /dev/null "$SITE" -H "Referer: https://www.google.com/search?q=test"
done

# Social traffic
for i in $(seq 1 3); do
  curl -s -o /dev/null "$SITE" -H "Referer: https://www.linkedin.com/feed/"
done

# Referral traffic
for i in $(seq 1 2); do
  curl -s -o /dev/null "$SITE" -H "Referer: https://sports-news-blog.com/article"
done

echo "Generated simulated attribution data. Check dashboard in ~5 minutes."
```

### Lab 4: GraphQL Query for Traffic Attribution Data

```bash
export CF_EMAIL="your@email.com"
export CF_API_KEY="your-api-key"
export ZONE_ID="your-zone-id"

# Query HTTP requests grouped by client source (referer)
curl -s -X POST \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"{ viewer { zones(filter: { zoneTag: \\\"$ZONE_ID\\\" }) { httpRequestsAdaptiveGroups( limit: 10, filter: { datetime_geq: \\\"$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)\\\" }, orderBy: [count_DESC] ) { dimensions { clientRefererHost } count } } } }\"
  }" \
  https://api.cloudflare.com/client/v4/graphql | jq '.data.viewer.zones[0].httpRequestsAdaptiveGroups[] | select(.dimensions.clientRefererHost != null) | {referer: .dimensions.clientRefererHost, requests: .count}'
```

---

## Demo Script (2 Minutes)

**Setup:** Traffic Attribution dashboard open, set to last 7 days with source breakdown visible.

---

"Traffic Attribution tells the story of how people are discovering your site.

[Point to the breakdown chart]

We can see immediately that about 42% of traffic is direct — people typing the URL or coming from bookmarks. That's your returning audience, your loyal users. That number is healthy for a sports content site.

35% is from search — organic Google traffic. This is the long-term investment in SEO paying off. The trend line here is important — if this percentage is growing week over week, your content strategy is working.

[Click to expand social]

Social is 18% — above average actually. And look at the breakdown: 60% from Twitter, 25% from Reddit, 15% from Facebook. For a sports site, that pattern makes sense — sports content goes viral on Twitter and Reddit.

[Scroll to referral domains]

Referral traffic at 5% — and look at the specific domains. ESPN.com is referencing macksportreport.com in three articles. That's both good for traffic and excellent for SEO.

The practical value here: if you launch a social media campaign next week, you should see social's percentage increase. If you run an email newsletter campaign, you'd see direct traffic spike (newsletters often don't include Referer). This gives you a fast feedback loop on marketing channel effectiveness — without cookies, without a JavaScript requirement."

---

## Competitive Context

| Feature | Cloudflare Traffic Attribution | Google Analytics 4 | Simple Analytics |
|---------|-------------------------------|-------------------|-----------------|
| **Source categorization** | Automatic (search/social/direct/referral) | Automatic + UTM | Automatic |
| **UTM campaign tracking** | No | Yes (full) | Yes (basic) |
| **Requires JavaScript** | No (edge-based) | Yes | Yes |
| **Cookie requirement** | No | Yes | No |
| **GDPR consent** | Not required | Required | Not required |
| **Referrer domain detail** | Yes | Yes | Yes |
| **Cross-session user journeys** | No | Yes | No |
| **Conversion tracking** | No | Yes (goals) | Limited |
| **Real-time data** | Yes | Yes | Yes |
| **Cost** | Included in CF plan | Free (data to Google) | $19/month |

**Cloudflare differentiator:** Traffic Attribution is a byproduct of edge traffic processing — zero overhead, no JavaScript required, no consent needed. It won't replace GA4 for deep marketing analytics, but it gives engineering teams a quick signal on traffic source health without the compliance burden.

---

## Self-Check Questions

**Question 1:** A customer's Traffic Attribution shows 78% "Direct" traffic, but they believe most of their traffic comes from email newsletters. What is the most likely technical explanation for why email traffic shows as Direct?

```
Your answer:




```

---

**Question 2:** A content marketing team wants to track which email campaign drove the most signups last month. Can Cloudflare Traffic Attribution answer this question? If not, what approach would you recommend?

```
Your answer:




```

---

**Question 3:** A customer sets `Referrer-Policy: no-referrer` on their outbound links to protect user privacy. How does this affect Traffic Attribution for the sites their users visit from their platform?

```
Your answer:




```

---

**Question 4:** Explain why API traffic (requests to `/api/*` endpoints) almost always appears as "Direct" in Traffic Attribution, and what the implications are for interpreting attribution data for API-heavy applications.

```
Your answer:




```

---

**Question 5:** A sports site is comparing two weeks: Week 1 had 30% social traffic, Week 2 had 18% social traffic. However, total traffic was the same in both weeks. What are two different interpretations of this change?

```
Your answer:




```

---

## Sources

- [Cloudflare Analytics Traffic Attribution](https://developers.cloudflare.com/analytics/account-and-zone-analytics/zone-analytics/)
- [HTTP Referer Header — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer)
- [Referrer-Policy Header — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy)
- [Cloudflare Analytics GraphQL API](https://developers.cloudflare.com/analytics/graphql-api/)
- [Analytics Engine Documentation](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Workers KV Documentation](https://developers.cloudflare.com/kv/)
