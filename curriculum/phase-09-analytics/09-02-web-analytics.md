# Module 9.2 — Web Analytics
> Dashboard Location: macksportreport.com → Analytics → Web Analytics
> Estimated Time: 40 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare Web Analytics is a **privacy-first, cookieless** alternative to Google Analytics. It was released in 2020 and has been steadily expanded. Unlike Google Analytics, which requires setting cookies and collecting PII, Cloudflare Web Analytics operates without any cookies and never collects personal user data.

### The Privacy Problem With Traditional Analytics

Google Analytics, Adobe Analytics, and similar tools work by:

1. Setting a persistent cookie on the user's device
2. Associating every page visit with that cookie (a user identifier)
3. Building a profile of the user's behavior across sessions
4. Sending this data to Google's servers

This creates a GDPR/CCPA compliance burden: you must disclose data collection, obtain consent (cookie banner), and honor deletion requests.

### How Cloudflare Web Analytics Is Different

Cloudflare Web Analytics does not set cookies. It does not track individual users across sessions. It cannot link a user's visit today to their visit yesterday. What it measures:

- **Sessions** — a visit to your site (defined as activity within a 30-minute window)
- **Pageviews** — individual page loads within a session
- **Duration** — time on page (approximate)
- **Core Web Vitals** — browser-measured performance metrics
- **Referrers** — where the user came from (domain-level, not full URL)
- **Devices** — type (desktop/mobile/tablet), browser, OS
- **Countries** — geographic location via IP geolocation (IP not stored)

### What Gets Measured: Core Web Vitals

Cloudflare Web Analytics captures **Core Web Vitals** — the metrics Google uses to measure user experience quality:

| Metric | Full Name | What It Measures | Good Threshold |
|--------|-----------|-----------------|----------------|
| **LCP** | Largest Contentful Paint | How fast the main content loads | < 2.5 seconds |
| **FID** | First Input Delay | Responsiveness to first user interaction | < 100ms |
| **CLS** | Cumulative Layout Shift | Visual stability (does content jump around?) | < 0.1 |
| **INP** | Interaction to Next Paint | Overall responsiveness (replaces FID) | < 200ms |
| **TTFB** | Time to First Byte | Server response time | < 800ms |
| **FCP** | First Contentful Paint | First render of any content | < 1.8 seconds |

These are measured **in real user browsers** (Real User Monitoring / RUM), not synthetic tests. This makes them significantly more accurate than lab measurements from tools like Lighthouse.

---

## Deep Dive (Architect-Level)

### How the Beacon Works

Cloudflare Web Analytics injects a small JavaScript snippet into your pages. When a user visits a page, this snippet:

1. Waits for the page to be fully loaded
2. Collects Core Web Vitals from the browser's Performance API
3. On page unload (when the user navigates away or closes the tab), fires a **beacon** — a small HTTP POST to Cloudflare's collection endpoint

The beacon payload includes:
- Page URL (no query string by default)
- Referrer
- Performance metrics (CWV)
- Device type, browser, OS (derived from user-agent, not stored as PII)
- Country (from IP geolocation, IP immediately discarded)
- Session identifier (ephemeral, not persistent across sessions)

### Injection Methods

**Method 1: Auto-injection (Cloudflare-proxied zones only)**

If your zone is proxied through Cloudflare, you can enable auto-injection in the dashboard. Cloudflare's edge automatically appends the Web Analytics script to every HTML response — no code changes required.

```
Analytics → Web Analytics → Enable → Auto-inject
```

**Method 2: Manual snippet**

For sites not proxied through Cloudflare, or for more control, add the snippet manually to your HTML:

```html
<!-- Cloudflare Web Analytics -->
<script defer src='https://static.cloudflareinsights.com/beacon.min.js'
  data-cf-beacon='{"token": "YOUR_TOKEN"}'></script>
<!-- End Cloudflare Web Analytics -->
```

Place this before the closing `</body>` tag.

### Single-Page Application (SPA) Support

Traditional beacon-based analytics have a problem with SPAs (React, Vue, Next.js): page transitions happen without a full page reload, so the beacon never fires for subsequent "pages."

Cloudflare Web Analytics supports SPAs via the `__cfBeacon.send()` method:

```javascript
// In your SPA router, call this on every route change:
if (window.__cfBeacon) {
  window.__cfBeacon.send({
    type: 'page'
  });
}
```

For React Router:

```javascript
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

function AnalyticsTracker() {
  const location = useLocation();
  
  useEffect(() => {
    // Fire beacon on route change
    if (window.__cfBeacon) {
      window.__cfBeacon.send({ type: 'page' });
    }
  }, [location]);
  
  return null;
}

// Add to your App component
function App() {
  return (
    <Router>
      <AnalyticsTracker />
      {/* rest of your app */}
    </Router>
  );
}
```

### Data Retention and Privacy Compliance

- Data is retained for **6 months**
- No PII is collected or stored
- No cookies are set
- GDPR-compliant out of the box: no consent banner required for analytics purposes
- CCPA-compliant: no personal data sold or shared
- EU data residency: check Cloudflare DPA for specifics

### Web Analytics vs Google Analytics 4 — Architecture Comparison

| Aspect | Cloudflare Web Analytics | Google Analytics 4 |
|--------|-------------------------|-------------------|
| **Cookie required** | No | Yes (first-party) |
| **GDPR consent required** | Generally no | Yes (in most interpretations) |
| **PII collected** | No | Yes (user IDs, demographics) |
| **Cross-session tracking** | No | Yes |
| **Cross-site tracking** | No | Yes (via Google account) |
| **Real-time dashboard** | Yes (1-2 min delay) | Yes |
| **Core Web Vitals** | Yes (RUM) | No (synthetic only) |
| **Events / custom tracking** | Limited | Extensive |
| **Funnel analysis** | No | Yes |
| **E-commerce tracking** | No | Yes |
| **Data ownership** | You | Google |
| **Cost** | Free | Free (with data to Google) |

---

## Dashboard Walkthrough

### Step 1: Enable Web Analytics for macksportreport.com

1. Navigate to dash.cloudflare.com → macksportreport.com
2. In the left nav, click **Analytics** → **Web Analytics**
3. If not yet enabled: click **Enable Web Analytics**
4. Choose **Auto-inject** (since macksportreport.com is proxied through Cloudflare)
5. Click **Done**

Note: it takes 15-30 minutes for data to start appearing after initial setup.

### Step 2: Explore the Summary View

The top section shows:
- **Pageviews** — total page loads in the selected period
- **Visits** — unique sessions
- **Pageviews per visit** — engagement depth indicator
- **Bounce rate** — sessions with only one pageview

### Step 3: Core Web Vitals Panel

Scroll down to the **Core Web Vitals** section. You'll see:
- A histogram for LCP, CLS, and INP
- Percentage of visits rated Good / Needs Improvement / Poor
- These are P75 values (75th percentile of real user measurements)

The P75 threshold is what Google uses for its Page Experience signal — the 75th percentile of your real users must be in the "Good" range.

### Step 4: Top Pages

The **Top Pages** table shows which paths receive the most traffic. Useful for:
- Identifying your most important pages (optimize these first)
- Detecting unexpected traffic to pages that shouldn't be popular (potential bots)

### Step 5: Top Referrers

Shows the domains sending traffic to you. Note that:
- Direct traffic appears as "(none)" or similar
- Google search traffic appears as "google.com"
- Full referrer URLs are not shown (privacy)

### Step 6: Device, Browser, OS Breakdown

Pie/donut charts showing distribution. Key insight: if 60%+ of your traffic is mobile but your LCP is failing on mobile, that's a prioritized fix.

---

## Hands-On Lab

### Prerequisites

- macksportreport.com proxied through Cloudflare
- Web Analytics enabled (auto-inject)
- `curl` and `jq` installed

### Lab 1: Verify the Beacon Is Loading

```bash
# Check that the beacon script is being injected into a page
curl -s https://macksportreport.com/ | grep -i "beacon"
```

Expected output should contain something like:
```
beacon.min.js
```

### Lab 2: Inspect the Beacon Request

Open macksportreport.com in Chrome, open DevTools → Network tab, filter by "beacon". Watch for the POST request to `cloudflareinsights.com/cdn-cgi/rum` when you navigate away from the page.

```bash
# Simulate what the beacon sends (simplified — real beacon uses JS)
# The actual endpoint is:
# POST https://cloudflareinsights.com/cdn-cgi/rum
# With JSON payload containing performance metrics
```

### Lab 3: Manual Snippet Installation Test

Create a test HTML file and verify the snippet:

```bash
cat > /tmp/test-analytics.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
  <title>Analytics Test</title>
</head>
<body>
  <h1>Testing Cloudflare Web Analytics</h1>
  <p>Open DevTools > Network to watch for the beacon.</p>
  
  <!-- Cloudflare Web Analytics -->
  <script defer src='https://static.cloudflareinsights.com/beacon.min.js'
    data-cf-beacon='{"token": "YOUR_TOKEN_HERE"}'></script>
  <!-- End Cloudflare Web Analytics -->
</body>
</html>
EOF

echo "File created. Open in browser and check network tab for beacon request."
cat /tmp/test-analytics.html
```

### Lab 4: Pull Web Analytics Data via API

```bash
export CF_API_TOKEN="your-api-token"
export CF_ACCOUNT_ID="your-account-id"
export SITE_TAG="your-web-analytics-site-tag"

# Get Web Analytics sites
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/rum/site_info/list" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
```

```bash
# Get pageview summary for a site
curl -s -X POST \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{
    \"query\": \"{ viewer { accounts(filter: { accountTag: \\\"$CF_ACCOUNT_ID\\\" }) { rumPageloadEventsAdaptiveGroups( limit: 10, filter: { siteTag: \\\"$SITE_TAG\\\", datetime_geq: \\\"$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)\\\" }, orderBy: [count_DESC] ) { dimensions { requestPath } count } } } }\"
  }" \
  https://api.cloudflare.com/client/v4/graphql | jq '.data.viewer.accounts[0].rumPageloadEventsAdaptiveGroups'
```

### Lab 5: SPA Integration Exercise

If macksportreport.com uses a JavaScript framework, add the SPA tracking hook:

```javascript
// For Next.js (pages router) — add to _app.js
import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function App({ Component, pageProps }) {
  const router = useRouter()
  
  useEffect(() => {
    const handleRouteChange = (url) => {
      if (window.__cfBeacon) {
        window.__cfBeacon.send({ type: 'page' })
      }
    }
    
    router.events.on('routeChangeComplete', handleRouteChange)
    return () => {
      router.events.off('routeChangeComplete', handleRouteChange)
    }
  }, [router.events])
  
  return <Component {...pageProps} />
}
```

---

## Demo Script (2 Minutes)

**Setup:** Have macksportreport.com → Analytics → Web Analytics open. Navigate to the Core Web Vitals section.

---

"One of the most common compliance headaches I hear from startups is: 'we need Google Analytics but legal is pushing back on GDPR cookie banners.'

[Point to Web Analytics overview]

Cloudflare Web Analytics is a free alternative that requires zero cookies and zero consent banners. You see real pageviews, session counts, where visitors are coming from — all the essential data, but none of the compliance risk.

[Scroll to Core Web Vitals]

Here's something Google Analytics actually can't do: real-time Core Web Vitals from real users. This isn't Lighthouse running in a lab — this is actual measurements from your actual visitors. LCP at 1.8 seconds means 75% of your real users see your main content in under 1.8 seconds.

[Click on Top Pages]

Your top pages, referrers, device types — all here, all without a single cookie.

The business case: if you're spending engineering time on GDPR consent management just to track pageviews, you're over-engineering. Cloudflare Web Analytics covers 80% of the use cases with zero compliance overhead.

And if you need the advanced funnel and e-commerce tracking that requires cookies, you can run both — GA4 for the complex stuff, Cloudflare for the baseline."

---

## Competitive Context

| Feature | Cloudflare Web Analytics | Google Analytics 4 | Plausible Analytics | Fathom |
|---------|-------------------------|-------------------|--------------------|----|
| **Cookie-free** | Yes | No | Yes | Yes |
| **GDPR compliant** | Yes (no consent needed) | Requires consent | Yes | Yes |
| **Core Web Vitals (RUM)** | Yes | No | No | No |
| **Real-time data** | Yes | Yes | Yes | Yes |
| **SPA support** | Yes (manual) | Yes (auto) | Yes | Yes |
| **Custom events** | Limited | Extensive | Limited | Limited |
| **Funnel tracking** | No | Yes | No | No |
| **E-commerce** | No | Yes | Paid plan | Paid plan |
| **Data ownership** | You | Google | You | You |
| **Price** | Free | Free | $9/month | $14/month |
| **Data retention** | 6 months | 14 months | 2+ years (paid) | Unlimited (paid) |
| **Script size** | ~5KB | ~100KB | ~1KB | ~1KB |

**Cloudflare differentiator:** Only tool in this comparison that provides Core Web Vitals RUM data without cookies. Google's CrUX (Chrome User Experience Report) provides similar data but with a 28-day lag and only for pages that receive significant Chrome traffic.

---

## Self-Check Questions

**Question 1:** A customer asks: "If Cloudflare Web Analytics doesn't use cookies, how does it count 'unique visitors'?" How do you explain the technical answer and its implications for accuracy?

```
Your answer:




```

---

**Question 2:** A customer has a React SPA and installs the Cloudflare Web Analytics snippet in their `index.html`. After a week, they notice it only shows 1/10th of their actual pageviews. What is the likely cause, and what is the fix?

```
Your answer:




```

---

**Question 3:** A customer's legal team says they still need a cookie consent banner because they use Cloudflare Web Analytics. Are they correct? What is the accurate answer, and what caveats should you include?

```
Your answer:




```

---

**Question 4:** A customer's LCP shows P75 = 4.2 seconds. They open Lighthouse and it shows LCP = 1.1 seconds. Which number is more accurate, and what explains the discrepancy?

```
Your answer:




```

---

**Question 5:** When would you recommend a customer use Cloudflare Web Analytics alongside Google Analytics 4 rather than replacing GA4 entirely?

```
Your answer:




```

---

## Sources

- [Cloudflare Web Analytics Documentation](https://developers.cloudflare.com/analytics/web-analytics/)
- [Cloudflare Web Analytics — JavaScript API](https://developers.cloudflare.com/analytics/web-analytics/javascript-api/)
- [Core Web Vitals Thresholds — Google](https://web.dev/vitals/)
- [Web Vitals Chrome Extension](https://chrome.google.com/webstore/detail/web-vitals/)
- [W3C Beacon API Specification](https://www.w3.org/TR/beacon/)
- [Cloudflare Privacy Policy for Web Analytics](https://developers.cloudflare.com/analytics/web-analytics/understanding-web-analytics/privacy/)
- [Plausible vs Cloudflare Web Analytics Comparison](https://plausible.io/vs-cloudflare-web-analytics)
