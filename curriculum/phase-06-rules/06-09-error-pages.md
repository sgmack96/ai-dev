# Module 6.9 — Error Pages
> **Dashboard Location:** macksportreport.com → Rules → Error Pages
> **Estimated Time:** 45 minutes
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Are Error Pages?

Error Pages let you replace Cloudflare's default error responses with custom HTML content. When Cloudflare generates an error — because your origin is down, because a firewall rule blocked the request, or because of a routing issue — instead of showing Cloudflare's generic "Error 521" or "Error 1001" pages, your users see a branded, informative page that you design.

This matters for:
- **Brand consistency:** A white-label Cloudflare error page during an outage breaks the customer experience and looks unprofessional
- **Customer communication:** Your custom page can display support contact info, status page URLs, and helpful messaging
- **Trust:** Users who see a generic "Cloudflare" error may think the site has been hacked or abandoned; branded errors maintain trust
- **Compliance:** Some industries require specific error message content (e.g., GDPR mentions, data center contact info)

### The Two Generations of Error Pages

Cloudflare has two error page systems:

**Legacy Custom Error Pages:** Available on Pro+. Upload one HTML file per error code (or a range). Limited CSS support (inline only). Found at Account level.

**New Error Pages (Rules-based):** Available with the new Rules Engine. Allows expression-based matching to show different error pages to different users. Found at macksportreport.com → Rules → Error Pages. This module focuses primarily on the new system.

---

## Deep Dive (Architect-Level)

### Cloudflare Error Code Reference: The Complete Map

Understanding which error codes are Cloudflare-generated vs origin-generated is essential for debugging and customer communication:

#### 1xxx Series: Cloudflare Connection/Routing Errors (Always Cloudflare-generated)

| Code | Name | Root Cause |
|---|---|---|
| **1000** | DNS points to prohibited IP | Zone DNS pointing to Cloudflare itself or a disallowed IP |
| **1001** | DNS Resolution Error | Cloudflare couldn't resolve the origin hostname |
| **1002** | Restricted / DNS Points to Prohibited IP | Request to Cloudflare IP or restricted hostname |
| **1003** | Access Denied: Direct IP Access Not Allowed | Request by IP directly to Cloudflare, bypassing hostname |
| **1004** | Host Not Configured | Zone exists but no DNS record matches |
| **1006** | Access Denied: Your IP has been banned | IP banned at account level |
| **1007** | Access Denied: Your IP has been banned | IP banned (variant) |
| **1008** | Access Denied: Your IP has been banned | IP banned (variant) |
| **1009** | Access Denied | Cloudflare Access policy block |
| **1010** | The owner of this website has banned the ASN | ASN-level block |
| **1011** | Access Denied | Hotlink protection triggered |
| **1012** | Access Denied | IP banned by WAF firewall event |
| **1013** | HTTP Hostname and TLS SNI Hostname Mismatch | SNI mismatch on incoming request |
| **1014** | CNAME Cross-User Banned | CNAME pointing across Cloudflare accounts (security) |
| **1015** | You are being rate limited | Rate limiting rule fired |
| **1016** | Origin DNS Error | Origin hostname doesn't resolve in Cloudflare's DNS lookup |
| **1017** | The owner of this website has banned your ASN | ASN blocked |
| **1018** | Could not connect to the origin web server | Failed to establish TCP connection to origin |
| **1019** | Compute Server Error | Internal Cloudflare Worker error |
| **1020** | Access Denied | Firewall rule block |
| **1023** | You cannot visit this page | GeoBlocking |

#### 52x Series: Origin Server Errors (Cloudflare reached origin but origin failed)

| Code | Name | Root Cause |
|---|---|---|
| **520** | Web Server Returned an Unknown Error | Origin returned unexpected response (invalid HTTP) |
| **521** | Web Server Is Down | Origin refused TCP connection (port closed, firewall) |
| **522** | Connection Timed Out | Cloudflare connected to origin but origin took too long to respond |
| **523** | Origin Is Unreachable | Origin IP unreachable (routing issue, down server) |
| **524** | A Timeout Occurred | Origin connected, but didn't send a full response within 100 seconds |
| **525** | SSL Handshake Failed | TLS handshake between Cloudflare and origin failed |
| **526** | Invalid SSL Certificate | Origin's SSL certificate is invalid or expired |
| **527** | Railgun Listener to Origin Error | Argo Tunnel/Railgun error (legacy) |
| **530** | Origin DNS Error | Combination error: 1016 + DNS failure |

#### 5xx Series Passed from Origin (Origin-generated errors Cloudflare proxies)

| Code | Source | Notes |
|---|---|---|
| **500** | Origin | Internal server error — Cloudflare passes through unless origin is down |
| **502** | Origin | Bad Gateway — Cloudflare passes through |
| **503** | Origin | Service Unavailable — Cloudflare passes through |
| **504** | Origin | Gateway Timeout — Cloudflare may generate its own 524 in some cases |

### Custom Error Pages: HTML Requirements and Limitations

When creating custom error pages:

**What's allowed:**
- Inline CSS (`<style>` tags)
- Basic JavaScript for simple interactions
- Static images (must be embedded as base64 data URIs — external image URLs won't load if origin is down)
- Custom fonts via base64 or Google Fonts CDN URLs (Google Fonts is reachable even if your origin is down)
- Meta tags, viewport settings

**What's NOT supported:**
- External CSS files (won't load if origin is down — defeats the purpose)
- External image files from your domain (same issue)
- Fetch API or XMLHttpRequest calls
- Server-side rendering

**Best practice for embedded image:**
```html
<!-- Instead of: <img src="/logo.png"> (won't load if origin is down) -->
<!-- Use: -->
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEA..." alt="Logo">
```

### Cloudflare Template Variables

Within a custom error page HTML, Cloudflare provides template variables you can include:

| Variable | Description |
|---|---|
| `::CLIENT_IP::` | The visitor's IP address |
| `::RAY_ID::` | The Cloudflare Ray ID for the request (useful for support tickets) |
| `::SERVER_IP::` | The origin server IP Cloudflare tried to reach |
| `::TUNNEL_ID::` | Argo Tunnel ID (if applicable) |
| `::CLIENT_UA::` | Client user agent string |

Example usage:
```html
<p>Error Reference ID: ::RAY_ID::</p>
<p>Please include this ID when contacting support: <a href="mailto:support@macksportreport.com">support@macksportreport.com</a></p>
```

The Ray ID is invaluable for support escalations — your team can look up the specific request in Cloudflare Logs using the Ray ID.

### New Error Pages: Rules-Based Error Pages

The new Error Pages system (in Rules) allows expression-based customization:

```
Match condition: cf.edge.server_error eq 521
Show custom error page: "Origin Down" template
```

But more powerfully, you can show **different error pages based on conditions:**

```
Rule 1: (cf.edge.server_error eq 521) and (http.request.uri.path starts_with "/api/")
→ Show JSON error response (for API consumers)

Rule 2: (cf.edge.server_error eq 521)
→ Show branded HTML error page (for browser users)
```

This is critical for API-first products where browser users need HTML but API consumers need `{"error": "service_unavailable"}`.

### JSON Error Responses for APIs

For API endpoints, returning an HTML error page to a JSON API consumer is a bad experience. The new Error Pages allow you to return a JSON response for specific error conditions:

```json
{
  "error": "origin_unavailable",
  "message": "The service is temporarily unavailable. Please retry in 60 seconds.",
  "support": "https://status.macksportreport.com",
  "ray_id": "::RAY_ID::"
}
```

With the response Content-Type set to `application/json`. This is only possible with the new Rules-based Error Pages, not the legacy system.

### "Always On" Feature

When Cloudflare can't reach your origin and your error page HTML is stored in Cloudflare's edge (uploaded to your zone), the error page **is served from Cloudflare's cache** even when your origin is completely down.

This is the "always on" capability: your custom branded error page remains visible to users even during a complete origin outage, as long as:
1. The error page HTML has been uploaded to your Cloudflare zone
2. Cloudflare has cached it at the PoP serving the user

### Workers-Based Error Handling vs Error Pages

| Approach | Error Pages | Workers |
|---|---|---|
| **Use case** | Simple branded error HTML | Complex error handling logic |
| **Dynamic content** | No (static HTML + template vars) | Yes — full JavaScript |
| **External API calls** | No | Yes — call status page API, PagerDuty, etc. |
| **Configuration** | Dashboard upload | Worker code deployment |
| **Available during origin outage** | Yes (served from Cloudflare edge) | Yes (Workers run independently) |
| **Cost** | Included | Workers pricing |

**Workers advantage for error handling:** A Worker can catch origin errors (`fetch()` throws or returns 5xx) and construct a rich error response — query a status API, include estimated recovery time, show different messages based on the specific error type.

---

## Dashboard Walkthrough

### Step 1: Navigate to Error Pages
1. macksportreport.com → **Rules** → **Error Pages** (may be under the "New" label)
2. Legacy path: Account Home → Configurations → Custom Pages (per zone)

### Step 2: Create a Custom Error Page for 521

1. Click **+ Create rule** (or the error page creator)
2. Select error type: **521 - Web Server Is Down**
3. Custom page content: paste your HTML (see example below)
4. **Save and deploy**

**Sample 521 Error Page HTML:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MacksportReport — Temporarily Unavailable</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f172a;
      color: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .container {
      text-align: center;
      max-width: 500px;
      padding: 2rem;
    }
    h1 { font-size: 2rem; margin-bottom: 1rem; }
    p { color: #94a3b8; line-height: 1.6; }
    .ray-id {
      font-family: monospace;
      font-size: 0.875rem;
      color: #64748b;
      margin-top: 2rem;
    }
    .status-link {
      color: #38bdf8;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>We're Back Shortly</h1>
    <p>MacksportReport is temporarily unavailable for maintenance. We'll be back online shortly.</p>
    <p>Check our <a class="status-link" href="https://status.macksportreport.com">status page</a> for live updates.</p>
    <p>Need help? <a class="status-link" href="mailto:support@macksportreport.com">Contact support</a></p>
    <p class="ray-id">Reference ID: ::RAY_ID::</p>
  </div>
</body>
</html>
```

### Step 3: Preview the Error Page
1. Click **Preview** in the error page editor
2. Verify layout, colors, and that `::RAY_ID::` placeholder appears correctly
3. Adjust HTML/CSS as needed

### Step 4: Configure for Multiple Error Codes
1. Repeat for 522 (Connection Timed Out) — same template, different message
2. Consider a generic 5xx template for less common errors

---

## Hands-On Lab

### Lab 1: Trigger a Controlled 521 Error

```bash
# Method: temporarily change your origin DNS to a non-listening IP
# This is risky in production — use a test subdomain instead

# For the lab, we'll verify the current error page instead
# First, check if a custom error page exists:
export CF_API_TOKEN="your_api_token"
export ZONE_ID="your_zone_id"

curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/custom_pages" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result[] | {id, state, url}'
```

### Lab 2: Upload a Custom Error Page via API

```bash
# Create HTML file for testing
cat > /tmp/521-error.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MacksportReport — Temporarily Unavailable</title>
  <style>
    body { font-family: sans-serif; background: #0f172a; color: #f1f5f9;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; text-align: center; }
    h1 { font-size: 2rem; }
    p { color: #94a3b8; }
  </style>
</head>
<body>
  <div>
    <h1>We'll Be Right Back</h1>
    <p>MacksportReport is temporarily offline.</p>
    <p>Reference ID: ::RAY_ID::</p>
  </div>
</body>
</html>
EOF

# Upload the custom page
# Note: the URL must be a publicly accessible URL hosting your HTML
# For API upload, you provide a URL to the HTML file
# In production you'd host this on R2 or GitHub Pages

# Using the legacy API endpoint for per-zone custom pages
curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/custom_pages/521" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://raw.githubusercontent.com/yourusername/error-pages/main/521.html",
    "state": "customized"
  }' | jq '{state: .result.state, url: .result.url}'
```

### Lab 3: Test Error Page Rendering

```bash
# Option 1: If you have a test zone, point its origin to 127.0.0.1
# to force a 521 error and see your custom page

# Option 2: Use wrangler to simulate (if you have a Worker)
# Option 3: Manually check the custom page URL

# Verify the custom page is active
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/custom_pages/521" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '{state: .result.state, preview_target: .result.preview_target}'
```

### Lab 4: Create JSON Error Response for API Path

This uses a Worker for the most flexible implementation:

```bash
cat > /tmp/api-error-worker.js << 'EOF'
export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request);

    // If origin returned a 5xx, check if this is an API request
    if (response.status >= 500) {
      const acceptHeader = request.headers.get("Accept") || "";
      if (acceptHeader.includes("application/json") ||
          request.url.includes("/api/")) {
        return new Response(
          JSON.stringify({
            error: "service_unavailable",
            message: "The service is temporarily unavailable.",
            status_page: "https://status.macksportreport.com",
            support: "mailto:support@macksportreport.com"
          }),
          {
            status: response.status,
            headers: {
              "Content-Type": "application/json",
              "X-Error-Source": "cloudflare-edge"
            }
          }
        );
      }
    }

    return response;
  }
}
EOF
echo "JSON error Worker written to /tmp/api-error-worker.js"
echo "Deploy via: wrangler deploy /tmp/api-error-worker.js"
```

### Lab 5: Verify Ray ID Replacement

```bash
# Ray IDs are only replaced in custom pages served during actual errors
# To verify the template variable works, check the custom pages preview:
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/custom_pages/521" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result | {state, url}'
```

---

## Demo Script (2 Minutes)

**Audience:** E-commerce merchant worried about maintaining trust during outages

---

*"Every website goes down sometimes. The question is: what do your customers see when it does? Right now, without custom error pages, they see this."*

[Show the default Cloudflare 521 error page — the generic Cloudflare-branded one]

*"'Web server is down.' Cloudflare logo. Error code. It looks like your site has been hacked or is abandoned. Your customer immediately goes to a competitor."*

[Switch to the custom error page preview]

*"With a custom error page, they see your brand. Your colors. Your message: 'We're performing maintenance, back shortly.' A link to your status page so they can track recovery. Your support email. And critically — a reference ID they can give your support team so you can look up exactly what happened in Cloudflare logs."*

[Show the ::RAY_ID:: template variable]

*"This Ray ID is like a tracking number for the error. When a customer emails saying 'I got an error at 3pm,' your team pastes the Ray ID into Cloudflare analytics and sees exactly what happened — which origin server failed, which edge PoP served the error, what the timing was. Completely removes the 'we can't reproduce it' problem."*

*"Takes about 15 minutes to set up. And it stays live even when your origin is completely down — it's served from Cloudflare's edge, not your server."*

---

## Competitive Context

| Feature | Cloudflare Error Pages | AWS CloudFront Custom Errors | Akamai Custom Error Pages | Fastly Error Responses |
|---|---|---|---|---|
| **Custom HTML upload** | Yes | Yes — S3 object URL | Yes | Yes — VCL |
| **Template variables (Ray ID, IP)** | Yes (::RAY_ID::, ::CLIENT_IP::) | No | Limited | Via VCL variables |
| **JSON responses** | Via new Rules / Workers | Via Lambda@Edge | Via EdgeWorkers | Via VCL |
| **Always served from edge** | Yes | Yes (from S3) | Yes | Yes |
| **Per-error-code custom pages** | Yes | Yes — per error code | Yes | Yes |
| **Expression-based routing** | Yes (new Rules system) | No | Yes (property rules) | Yes (VCL conditions) |
| **Live during complete origin outage** | Yes | Yes (from S3) | Yes | Yes |
| **Easy inline preview** | Yes — dashboard preview | No — test by triggering error | Limited | No easy preview |
| **No-code setup** | Yes | Partial (S3 URL needed) | Yes | No (VCL required) |

---

## Self-Check Questions

**Question 1:** A customer reports users seeing "Error 522" frequently during business hours. Explain what 522 means technically and what the top 3 causes are that you would investigate first.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 2:** A customer wants their custom 521 error page to show a live countdown timer counting down from 30 minutes. Can this be done with custom error pages? What's the limitation, and what alternative approach would you suggest?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 3:** Explain why embedding images as base64 data URIs in a custom error page is the recommended approach, rather than using `<img src="/logo.png">`.

```
Your answer:
_______________________________________________
_______________________________________________
```

**Question 4:** A customer's error page includes `<img src="https://external-cdn.example.com/logo.png">`. This external CDN is operated by a third party. What risk does this create for the error page experience during an outage?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 5:** Describe a scenario where you would use a Worker to handle errors instead of the built-in Error Pages feature. What capability does the Worker unlock that Error Pages cannot provide?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

---

## Sources

- [Custom Error Pages Documentation](https://developers.cloudflare.com/support/more-dashboard-apps/cloudflare-custom-pages/configuring-custom-pages-error-and-challenge/)
- [Cloudflare Error Codes Reference](https://developers.cloudflare.com/support/troubleshooting/cloudflare-errors/)
- [Error 521: Web Server Down](https://developers.cloudflare.com/support/troubleshooting/cloudflare-errors/troubleshooting-cloudflare-5xx-errors/#error-521-web-server-is-down)
- [Error 522: Connection Timed Out](https://developers.cloudflare.com/support/troubleshooting/cloudflare-errors/troubleshooting-cloudflare-5xx-errors/#error-522-connection-timed-out)
- [Cloudflare Ray ID](https://developers.cloudflare.com/fundamentals/reference/cloudflare-ray-id/)
- [Workers — Handling Errors](https://developers.cloudflare.com/workers/examples/return-custom-errors/)
- [New Error Pages (Rules)](https://developers.cloudflare.com/rules/error-rules/)
