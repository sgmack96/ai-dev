# Module 9.4 — Edge Reachability (Network Error Logging)
> Dashboard Location: macksportreport.com → Analytics → Edge Reachability
> Estimated Time: 35 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Edge Reachability is built on **Network Error Logging (NEL)** — a W3C standard that enables browsers to report connectivity failures directly to a server endpoint. It answers a question that no other analytics tool can: "What happened to requests that failed before they even reached Cloudflare?"

### The Observability Gap

Traditional monitoring tools have a fundamental blind spot:

- **Server logs** only capture requests that reach your server
- **Cloudflare analytics** only captures requests that reach the Cloudflare edge
- **Synthetic monitoring** tests from a fixed set of probe locations

None of these can capture failures that occur **between the user's device and Cloudflare**. A user in a small ISP in Indonesia whose DNS resolution fails for your domain — you never see that in any log.

**NEL fills this gap.** Browsers that support NEL will report these failures to a reporting endpoint, giving you visibility into last-mile connectivity issues.

### What NEL Measures

NEL captures failures in the connection between the **user's browser and the nearest Cloudflare edge**. These are categorized as:

| Error Type | Description |
|-----------|-------------|
| **DNS failure** | Browser could not resolve your domain to an IP address |
| **TCP connection failure** | DNS resolved, but TCP connection to Cloudflare edge failed |
| **TLS handshake failure** | TCP connected, but TLS negotiation failed |
| **HTTP protocol failure** | TLS succeeded, but HTTP request failed at protocol level |
| **Network changed** | User switched networks (cellular to WiFi) mid-connection |
| **Abandoned** | User abandoned the request (navigated away) |

### Why This Is Unique

NEL operates in the browser, not at the server. It uses a separate reporting channel (the Reporting API), which means:

1. The failure report travels over a **different network path** than the failed request
2. Browsers queue reports and send them even if the main request never succeeded
3. You see failures that generate **zero log entries anywhere** in your stack

This is why Cloudflare named this feature "Edge Reachability" — it literally tells you whether users can reach your Cloudflare edge.

### How Cloudflare Implements NEL

Cloudflare's implementation:

1. Cloudflare sets a `Report-To` HTTP response header on every response for zones with NEL enabled
2. This header tells the browser: "If you encounter any network errors for this origin, report them to this URL"
3. When a failure occurs, the browser queues a JSON report
4. The browser sends these reports to Cloudflare's reporting endpoint in a background batch

**Response headers sent by Cloudflare:**

```
Report-To: {"group":"cloudflare-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v3?s=..."}]}
NEL: {"success_fraction":0.01,"failure_fraction":1,"report_to":"cloudflare-nel","max_age":604800}
```

**Key parameters:**
- `success_fraction: 0.01` — report 1% of successful requests (controls reporting volume)
- `failure_fraction: 1` — report 100% of failures (you want to see all of them)
- `max_age: 604800` — browser remembers this policy for 7 days (604800 seconds)

### Plan Requirement

Edge Reachability / NEL data in the Cloudflare dashboard is an **Enterprise feature**. The NEL headers are sent on all plans, but the data collection and dashboard visualization requires Enterprise.

---

## Deep Dive (Architect-Level)

### Browser Support and Coverage

NEL is supported in:
- Chrome/Chromium: Yes (since v69)
- Edge: Yes (Chromium-based)
- Firefox: No (not implemented)
- Safari: No (not implemented)

This means NEL data represents approximately **65-70% of your actual web traffic** (Chrome's market share). Firefox and Safari failures are not captured. This is an important caveat when analyzing NEL data — you're not seeing the complete picture.

### NEL Report JSON Structure

When a failure occurs, the browser sends a report like this:

```json
{
  "age": 12,
  "type": "network-error",
  "url": "https://macksportreport.com/api/scores",
  "body": {
    "elapsed_time": 0,
    "method": "GET",
    "phase": "dns",
    "protocol": "",
    "referrer": "https://macksportreport.com/",
    "sampling_fraction": 1,
    "server_ip": "",
    "status_code": 0,
    "type": "dns.name_not_resolved"
  }
}
```

**Key fields:**
- `phase`: `dns`, `connection`, `application` — where in the stack the failure occurred
- `type`: specific error type (e.g., `tcp.refused`, `tls.protocol.error`, `dns.name_not_resolved`)
- `server_ip`: empty for DNS failures (resolution never succeeded)
- `age`: how many milliseconds after the failure the report was queued

### Reading Edge Reachability Dashboard Data

The Edge Reachability dashboard shows:

**Error Volume Over Time:**
A time series of error counts. Spikes here indicate connectivity events affecting groups of users simultaneously — often ISP-level routing problems.

**Error Types Breakdown:**
- DNS failures dominant → potential DNS resolution problems (DNSSEC issues, registrar problems, DNS amplification affecting your resolvers)
- TCP failures dominant → routing problems between ISPs and Cloudflare PoPs
- TLS failures dominant → certificate issues, TLS version mismatches, or deep packet inspection (enterprise firewalls)

**By ISP/ASN:**
Shows which internet service providers (Autonomous System Numbers) are generating the most errors. Extremely useful for identifying:
- An ISP with a routing issue to Cloudflare
- Regions where Cloudflare's network has reduced reach

**By Country:**
Geographic breakdown of errors. A spike in errors from a specific country often correlates with:
- ISP routing outage in that country
- Government-level internet disruption
- Cloudflare PoP capacity issue in that region

### Practical Use Case: Diagnosing an ISP-Level Routing Issue

**Scenario:** You receive reports that users in the Philippines can't access macksportreport.com, but the Cloudflare dashboard shows no WAF blocks and origin is healthy.

**Edge Reachability Investigation:**
1. Open Edge Reachability dashboard
2. Filter by Country = Philippines
3. Check error types: TCP connection failures are elevated
4. Check ISP breakdown: one specific Philippine ISP (e.g., PLDT) shows 90% of the errors
5. Check error timing: started 2 hours ago

**Conclusion:** A routing issue between PLDT (PH ISP) and the nearest Cloudflare PoP is causing TCP connection failures. Users on Globe or DITO (other PH ISPs) are unaffected.

**Resolution path:**
- Raise with Cloudflare support (they can investigate and contact the ISP's NOC)
- Check Cloudflare status page for any known issues with the Manila PoP

This entire diagnosis is impossible without NEL data.

### NEL vs Other Observability Tools

| Observation Method | What It Can See |
|-------------------|----------------|
| **Server logs** | Requests that reached origin |
| **Cloudflare analytics** | Requests that reached Cloudflare edge |
| **Synthetic monitoring** | Failures from probe locations only |
| **Real User Monitoring (RUM)** | Errors after page load (JS exceptions), not pre-connection failures |
| **NEL / Edge Reachability** | Connection failures before the request reaches Cloudflare edge |

---

## Dashboard Walkthrough

### Step 1: Access Edge Reachability

**Note:** Full Edge Reachability dashboard requires Enterprise. If on a lower plan, you can verify NEL headers are being sent but won't see the dashboard.

1. macksportreport.com → Analytics → Edge Reachability

### Step 2: Verify NEL Headers Are Set

Even on lower plans, you can verify Cloudflare is setting NEL headers:

```bash
curl -s -I https://macksportreport.com/ | grep -i "nel\|report-to"
```

Expected output:
```
nel: {"success_fraction":0.01,"failure_fraction":1,"report_to":"cloudflare-nel","max_age":604800}
report-to: {"group":"cloudflare-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/..."}]}
```

### Step 3: Read the Error Volume Chart (Enterprise)

The time series shows NEL error volume. Key questions:
- Is there a baseline level of errors (every site has some)?
- Are there spikes above baseline? When did they start/end?
- Did any spike correlate with a known event or deployment?

### Step 4: ISP/ASN Breakdown

This table shows which ASNs (internet service providers) are generating the most errors. Common findings:
- Mobile networks often have higher error rates due to network switching
- Tier 2/3 ISPs in developing markets may have routing inconsistencies
- CGNAT (carrier-grade NAT) users may show TCP connection variability

### Step 5: Error Type Analysis

Drill into the error types to determine what kind of connectivity problem exists:
- DNS errors: check DNSSEC, propagation issues
- TCP errors: routing/BGP issues
- TLS errors: certificate, TLS version, or firewall/DPI issues

---

## Hands-On Lab

### Prerequisites

- Any Cloudflare plan (to verify headers)
- Enterprise plan (to view full dashboard)
- Chrome browser with DevTools

### Lab 1: Verify NEL Headers

```bash
# Check NEL and Report-To headers on macksportreport.com
curl -v -s https://macksportreport.com/ 2>&1 | grep -i "nel\|report-to" | head -5
```

### Lab 2: Inspect NEL Headers in Chrome DevTools

1. Open Chrome, go to https://macksportreport.com
2. Open DevTools (F12) → Network tab
3. Click on the first request (the HTML document)
4. Click "Headers" tab → scroll to "Response Headers"
5. Look for `nel` and `report-to` headers
6. Screenshot or copy the header values

### Lab 3: View Saved Reports (Chrome Internals)

Chrome stores NEL reports before sending them. You can inspect the queue:

1. In Chrome address bar, navigate to: `chrome://net-export/`
2. Click "Start Logging to Disk"
3. Visit macksportreport.com
4. Stop logging and open the JSON file
5. Search for `"network_error"` entries to see any queued NEL reports

### Lab 4: Simulate a DNS Failure to Test NEL

```bash
# Using a local hosts file modification to simulate DNS failure (educational only)
# Add to /etc/hosts temporarily:
# This will cause DNS failure for macksportreport.com from your machine
# DO NOT run this on a production machine

# Instead, just verify the header values
curl -s -D - https://macksportreport.com/ -o /dev/null 2>&1 | grep -E "^nel:|^report-to:" -i
```

### Lab 5: Decode the Reporting Endpoint URL

```bash
# The Report-To header contains an encoded URL
# Let's inspect what Cloudflare's endpoint looks like
REPORT_TO=$(curl -s -I https://macksportreport.com/ | grep -i "report-to" | tr -d '\r')
echo "Report-To header: $REPORT_TO"
echo ""
echo "This tells browsers to send NEL reports to Cloudflare's collection endpoint."
echo "The ?s= parameter contains zone-specific routing information (base64 encoded)."
```

---

## Demo Script (2 Minutes)

**Setup:** Show the curl command output displaying NEL headers. If Enterprise, have Edge Reachability dashboard open.

---

"Here's a question for you: how do you monitor problems that never show up in your logs?

If a user in Vietnam tries to load your site and DNS resolution fails — they never get to your site, never reach Cloudflare, nothing appears in any log. From a monitoring perspective, it's invisible. You'd only find out if users start complaining on social media.

[Show curl output with NEL headers]

This is Network Error Logging. Cloudflare sets these headers in every response. They tell the browser: 'If you have trouble connecting to this site in the future, report it to us.'

So the next time a user somewhere in the world experiences a DNS failure, a TCP timeout, or a TLS error before reaching Cloudflare — their browser will quietly send us a report. Not to your server — to Cloudflare's reporting endpoint. Even though the request never succeeded.

[Open Edge Reachability dashboard if available]

Here's what that data looks like. You can see failures grouped by ISP, by country, by error type. This table tells you which ISPs have routing problems reaching Cloudflare's network. This particular spike yesterday — TCP connection failures from users on a specific Thai ISP. We can see the exact window, the exact provider, and the exact error type.

This level of visibility into last-mile connectivity problems is something you can't get from any other tool. It's the difference between your support team investigating user complaints reactively versus proactively identifying regional connectivity issues before users escalate."

---

## Competitive Context

| Capability | Cloudflare NEL/Edge Reachability | Fastly | AWS CloudFront | Akamai |
|-----------|----------------------------------|--------|----------------|--------|
| **Pre-edge failure visibility** | Yes (NEL) | No | No | No (proprietary alternative) |
| **DNS failure reporting** | Yes | No | No | No |
| **TCP failure reporting** | Yes | No | No | No |
| **TLS failure reporting** | Yes | No | No | No |
| **ISP/ASN breakdown** | Yes | No | No | No |
| **Real browser reports** | Yes | No (synthetic) | No (synthetic) | Limited |
| **Standard (W3C)** | Yes | N/A | N/A | No |
| **Available on free plan** | Headers sent, dashboard Enterprise | N/A | N/A | N/A |

**Unique position:** Cloudflare is the only major CDN with a built-in, standards-based, browser-reported connectivity monitoring tool. This is a meaningful differentiator for Enterprise customers who care about complete observability.

---

## Self-Check Questions

**Question 1:** A customer says: "My site is perfectly healthy — Cloudflare analytics shows no issues and my server logs are clean." How does Edge Reachability / NEL add value to their observability stack that they can't get from these two sources?

```
Your answer:




```

---

**Question 2:** A customer reports that users in Brazil are having trouble accessing their site. How would you use Edge Reachability to investigate whether this is a last-mile connectivity problem vs an origin server problem? Walk through the steps.

```
Your answer:




```

---

**Question 3:** Why does NEL only cover approximately 65-70% of web traffic, and what is the technical reason for this limitation?

```
Your answer:




```

---

**Question 4:** A customer sees a spike in TLS handshake failures in Edge Reachability. The affected users are all on corporate networks. What are two likely causes?

```
Your answer:




```

---

**Question 5:** Explain the `success_fraction` and `failure_fraction` parameters in the NEL header. Why would you set `success_fraction` low (0.01) but `failure_fraction` high (1.0)?

```
Your answer:




```

---

## Sources

- [Cloudflare Edge Reachability Documentation](https://developers.cloudflare.com/analytics/account-and-zone-analytics/edge-reachability/)
- [W3C Network Error Logging Specification](https://www.w3.org/TR/network-error-logging/)
- [W3C Reporting API Specification](https://www.w3.org/TR/reporting/)
- [MDN: Network Error Logging](https://developer.mozilla.org/en-US/docs/Web/HTTP/Network_Error_Logging)
- [Cloudflare Blog: Introducing Edge Reachability](https://blog.cloudflare.com/edge-reachability/)
- [Report-To Header Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Report-To)
