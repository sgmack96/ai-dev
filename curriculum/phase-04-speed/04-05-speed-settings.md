# Module 4.5 — Speed Settings (Minification, Compression, Optimization)
> Dashboard Location: macksportreport.com → Speed → Settings | Estimated Time: 120 minutes | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### The Speed Settings Layer

Cloudflare's Speed Settings are a collection of edge-level transformations applied to HTTP responses as they pass through the Cloudflare network. The critical insight: these transformations happen at the edge, requiring **zero changes to your origin code or infrastructure**. You flip a toggle in the dashboard; Cloudflare handles the implementation globally, instantly.

Every setting in this module maps directly to a measurable Observatory metric improvement. When a customer says "I don't have engineering bandwidth to optimize performance," Speed Settings are your answer.

### Auto Minify — HTML, CSS, JavaScript

**What it does:** Removes whitespace, comments, and redundant characters from HTML, CSS, and JavaScript files as they transit the CF edge. A 45KB JavaScript file might become 32KB after minification — a 29% reduction with zero functional change.

**Mechanism:**
- Cloudflare intercepts the response
- Applies a minification pass (not the same as compression — minification removes characters; compression encodes them)
- Serves the minified version to the client
- Original file at origin is untouched

**When to enable:** Almost always safe for standard well-written code. JavaScript minification is more aggressive — it renames variables, removes dead code branches.

**Caveats:**
1. **Inline `<script>` tags with template literals** — Can break if poorly formatted
2. **Source maps** — Minified JS is harder to debug. Ensure source maps are deployed separately.
3. **Already minified assets** — Running minification on pre-minified files adds no benefit and minor CPU overhead
4. **Badly formatted HTML** — Rare, but malformed HTML + aggressive minification can produce parse errors

**Best practice:** Enable HTML and CSS minification broadly. Enable JS minification but test on staging first. Use the CF Page Rule / Transform Rule to exclude `/admin/*` or `/debug/*` paths if needed.

### Brotli Compression

**What it is:** A compression algorithm developed by Google (2015), providing 15–30% better compression ratios than gzip for text content at comparable CPU cost. Named after a Swiss bakery.

**How it works — content negotiation:**
```
Client sends: Accept-Encoding: br, gzip, deflate
CF checks: Is Brotli enabled? Is the response text-based?
CF responds: Content-Encoding: br
             [brotli-compressed body]
Client decompresses in browser (all modern browsers support br)
```

**Brotli compression levels (1–11):**
- Level 1–4: Faster compression, less size reduction (good for real-time streaming)
- Level 5–9: Balanced (Cloudflare uses this range for most content)
- Level 10–11: Maximum compression, significant CPU cost (pre-compress static files)

**What gets compressed:**
- HTML, CSS, JavaScript, JSON, XML, SVG — yes (text-based, compresses well)
- Images (JPEG, PNG, WebP) — no (already compressed; re-compressing adds CPU waste)
- PDFs, videos, audio — no

**Brotli vs Gzip comparison:**

| Content Type | Gzip (level 6) | Brotli (level 6) | Brotli improvement |
|-------------|----------------|------------------|-------------------|
| HTML page | 72% reduction | 80% reduction | +8% |
| CSS file | 78% reduction | 84% reduction | +6% |
| JavaScript | 70% reduction | 78% reduction | +8% |
| JSON API | 75% reduction | 82% reduction | +7% |

**Impact on Observatory LCP:** Direct — smaller transfer sizes mean faster download, faster parse, faster render.

### Early Hints (HTTP 103)

**What it is:** HTTP 103 is an informational status code that Cloudflare can return *before* the full 200 response. It contains `Link: rel=preload` headers telling the browser to start fetching critical assets immediately — before the HTML is even fully received.

**The problem Early Hints solves:**

Traditional page load sequence:
```
[Browser] → Request HTML
[Server]  → (200ms TTFB) → Return HTML
[Browser] → Parse HTML → Discover <link rel=stylesheet> + <script> tags
[Browser] → Request CSS file → (starts 200ms after initial request)
[Browser] → Request JS file → (starts 200ms after initial request)
```

With Early Hints:
```
[Browser] → Request HTML
[CF Edge] → (immediately) → Return HTTP 103 with Link headers
[Browser] → Start fetching CSS and JS (in parallel!)
[CF Edge] → (200ms TTFB) → Return full HTML 200
[Browser] → Parse HTML → CSS and JS already partially/fully downloaded
```

Early Hints essentially eliminates the "discovery" delay for critical resources. LCP improvements of 100–500ms are common.

**How CF generates Early Hints:**
- CF analyzes previous page responses for your zone
- Identifies which resources appear in `<link rel=preload>` headers or are critical assets
- Remembers them and proactively sends the 103 for subsequent requests
- Zero configuration required — CF learns automatically

**Browser support:** Chrome, Edge, Firefox. Safari is adding support (check caniuse.com).

**Enabling:**
```
Dashboard → macksportreport.com → Speed → Settings → Early Hints → On
```

### HTTP/2 and HTTP/3 (QUIC)

**HTTP/2 — The Multiplexing Revolution:**

HTTP/1.1 was sequential — one request per connection at a time. HTTP/2 introduced multiplexing: multiple requests over a single TCP connection simultaneously, using stream IDs.

Key HTTP/2 features:
- **Multiplexing:** Multiple in-flight requests per connection (eliminates head-of-line blocking at HTTP layer)
- **Header compression (HPACK):** HTTP headers compressed, reducing overhead on repeat requests
- **Stream prioritization:** Browser signals which resources are more important
- **Server Push (deprecated):** Server could push assets before client requested them (removed in modern browsers)

**HTTP/3 — QUIC Protocol:**

HTTP/3 runs on QUIC (Quick UDP Internet Connections) instead of TCP. Why this matters:

| Problem with TCP | QUIC Solution |
|-----------------|---------------|
| Head-of-line blocking: lost packet blocks all streams | Each stream independent — lost packet only blocks that stream |
| Connection establishment: 3-way handshake (1.5 RTT) | 0-RTT or 1-RTT connection establishment |
| Encryption overhead: TLS added on top | TLS 1.3 built-in at the QUIC layer |
| Mobility: changing IP breaks TCP connection | Connection IDs — IP change doesn't break connection |

**Impact on real-world performance:**
- Lossy networks (mobile 4G, high-packet-loss WiFi): HTTP/3 dramatically better
- Fast stable connections (fiber, corporate network): marginal improvement
- Connection establishment: HTTP/3 + 0-RTT is 100–200ms faster for repeated visits

**How to verify H2/H3 on your site:**
```bash
# Check HTTP/2 support
curl -I --http2 https://macksportreport.com/ | grep "HTTP/2"

# Check HTTP/3 support (via Alt-Svc header)
curl -I https://macksportreport.com/ | grep -i "alt-svc"
# Expected: alt-svc: h3=":443"; ma=86400

# Use nghttp2 to inspect H2 details
nghttp -nv https://macksportreport.com/ 2>&1 | head -50
```

### Rocket Loader — Asynchronous JavaScript Loading

**What it does:** Rocket Loader intercepts JavaScript files referenced in your HTML and loads them asynchronously using a proxy mechanism. This prevents render-blocking — the browser can paint content without waiting for JS to download and execute.

**Standard JS loading (blocking):**
```html
<script src="/app.js"></script>  <!-- Browser pauses here, waits for JS to download + execute -->
<p>This content delayed until JS is done</p>  <!-- Not rendered yet -->
```

**With Rocket Loader:**
```html
<!-- CF rewrites to async loading -->
<script type="text/rocketscript" data-cfasync="true" src="/app.js"></script>
<!-- Browser continues rendering immediately, loads JS async in background -->
<p>This content renders right away</p>
```

**Metrics improved:**
- **FCP (First Contentful Paint)** — Page shows content faster
- **TBT (Total Blocking Time)** — Less time with main thread blocked
- **LCP** — If LCP element is visible before JS executes

**What can break with Rocket Loader:**
1. **jQuery document.ready() in inline scripts** — If inline script depends on external jQuery being loaded synchronously
2. **Third-party widgets** (chat widgets, analytics) — Some expect to load in document order
3. **Custom `<script>` execution order dependencies** — Script A must run before Script B
4. **CSRF tokens injected by JS** — Forms that depend on JS-injected CSRF tokens at DOM ready

**Mitigation:** Add `data-cfasync="false"` attribute to specific scripts to exclude them from Rocket Loader:
```html
<script src="/critical-init.js" data-cfasync="false"></script>
```

### Image Optimization — Polish and Mirage

**Polish — Automatic WebP Conversion:**

Polish is Cloudflare's image optimization feature that:
1. Converts JPEG/PNG images to WebP format (25–35% smaller at same visual quality)
2. Applies lossy or lossless compression
3. Strips EXIF metadata (reduces file size, removes location data)

Polish modes:
- **Lossless:** Compress without any quality loss. Safe for all images. Smaller savings (10–20%).
- **Lossy:** Higher compression with imperceptible quality reduction. Larger savings (25–35%). Recommended.

Browser support negotiation:
```
Client sends: Accept: image/webp,image/*,*/*;q=0.8
CF checks: Is Polish enabled? Does browser support WebP?
CF returns: image/webp (if WebP supported by browser)
CF returns: original format (if older browser without WebP support)
```

**Plan requirement:** Polish requires Pro plan or higher.

**Mirage — Mobile Image Optimization:**

Mirage handles lazy loading and device-appropriate image sizing:
- Detects mobile devices and network conditions
- Loads low-resolution placeholder images first
- Upgrades to full resolution as they scroll into view
- Reduces initial page weight for mobile users dramatically

**Plan requirement:** Pro plan or higher.

### Prefetch URLs

**What it does:** Adds a `<link rel=prefetch>` hint to your HTML responses, telling browsers to pre-fetch linked pages when users hover over links. By the time they click, the next page is already in the browser cache.

**When to use:** Works well for multi-step flows (landing page → product page → checkout), documentation sites, or any linear navigation path.

---

## Deep Dive (Architect-Level)

### Feature Interaction Matrix

These features don't operate in isolation — they interact and can compound improvements:

| Features | Interaction | Net Effect |
|----------|-------------|------------|
| Brotli + Auto Minify | Compresses already-minified content → even smaller | Compounding: 40%+ size reduction |
| Early Hints + Polish | Early Hints loads hero image faster; Polish makes it smaller | LCP improvement × 2 |
| Rocket Loader + Early Hints | Early Hints preloads CSS; Rocket Loader defers JS | Fastest possible FCP + TTI |
| HTTP/3 + All of above | Faster transport for smaller, asynchronously loaded assets | Maximum throughput efficiency |
| Polish + Mirage | Polish for WebP conversion; Mirage for lazy load | Optimal mobile performance |

### Measuring the Delta — Before/After

The rigorous way to attribute improvement to a specific feature:

```
1. Run Observatory test — record baseline score, LCP, TBT, FCP
2. Enable ONE feature (e.g., Brotli only)
3. Wait 5 minutes for settings to propagate
4. Run Observatory test again — record new score
5. Calculate delta per feature
6. Repeat for each feature
7. Enable all features together — record combined score
```

This is the demo pattern: turn features on one at a time during a live customer call and watch the Observatory score climb in real time.

### Configuration via Workers — Advanced Pattern

For fine-grained control, you can implement these optimizations in a Worker:

```javascript
// worker.js — Custom compression + Early Hints implementation
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Add Early Hints for known critical resources
    const criticalResources = [
      '</css/main.css>; rel=preload; as=style',
      '</js/app.js>; rel=preload; as=script',
      '</images/hero.webp>; rel=preload; as=image'
    ];
    
    // Return 103 Early Hints
    // Note: actual 103 response handled by CF edge, not Workers directly
    // Workers can set Link headers that CF uses for Early Hints generation
    
    const response = await fetch(request);
    const newHeaders = new Headers(response.headers);
    
    // Add Link preload headers for CF Early Hints to learn from
    newHeaders.set('Link', criticalResources.join(', '));
    
    return new Response(response.body, {
      status: response.status,
      headers: newHeaders
    });
  }
};
```

### Diagnosing Rocket Loader Breakage

When a customer reports "things broke after enabling Rocket Loader," systematic diagnosis:

```bash
# Step 1: Check browser console for JS errors
# Open DevTools → Console → look for "is not defined", "cannot read property"

# Step 2: Check what Rocket Loader is modifying
# Elements → look for type="text/rocketscript" attributes on script tags

# Step 3: Identify the specific breaking script
# Disable Rocket Loader → enable → check which script causes the error

# Step 4: Add exclusion for breaking script
# Method 1: data-cfasync="false" attribute in HTML
# Method 2: Page Rule to disable Rocket Loader for specific paths

# Step 5: Verify the fix
curl -s https://macksportreport.com/ | grep -i "rocketscript"  # Shows what's being deferred
```

---

## Dashboard Walkthrough

### Step 1: Navigate to Speed Settings
```
macksportreport.com → Speed → Optimization
```
*(Settings appear under sub-tabs: Content Optimization, Protocol Optimization, Image Optimization)*

### Step 2: Enable Auto Minify
- Toggle: **Auto Minify → JavaScript** → On
- Toggle: **Auto Minify → CSS** → On
- Toggle: **Auto Minify → HTML** → On
- Save changes

### Step 3: Enable Brotli
- Toggle: **Brotli** → On
- Verify: Check response headers after enabling

### Step 4: Enable Early Hints
- Toggle: **Early Hints** → On
- Note: Takes effect for subsequent requests — CF needs to learn your critical assets

### Step 5: Enable Rocket Loader
- Toggle: **Rocket Loader** → On
- Test your site immediately — check for JS errors
- If issues: Toggle back off, investigate, use `data-cfasync="false"` exclusions

### Step 6: HTTP/2 and HTTP/3 Status
- These are enabled by default on all Cloudflare zones
- Verify: Scroll to Network tab → HTTP/2 and HTTP/3 should show "Enabled"

### Step 7: Enable Polish (Pro+ required)
- Toggle: **Polish → Lossy** (recommended) or **Lossless**
- Toggle: **WebP** → On (required alongside Polish)
- Test: Inspect image response headers for `cf-polished` header

---

## Hands-On Lab

### Prerequisites
- macksportreport.com on Cloudflare (Pro plan for Polish/Mirage)
- API token with Zone Settings:Edit permission
- `curl` and browser DevTools

### Lab 1: Enable All Speed Settings via API

```bash
export CF_API_TOKEN="your_api_token_here"
export ZONE_ID="your_zone_id_here"

# Enable Auto Minify (HTML, CSS, JS)
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/minify" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": {"css": "on", "html": "on", "js": "on"}}' | jq '.result'

# Enable Brotli
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/brotli" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq '.result'

# Enable Early Hints
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/early_hints" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq '.result'

# Enable Rocket Loader
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/rocket_loader" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq '.result'

# Enable Polish (lossy + WebP) — Pro plan required
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/polish" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "lossy"}' | jq '.result'

curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/webp" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq '.result'

echo "All speed settings enabled."
```

### Lab 2: Verify Brotli is Active

```bash
# Check compression encoding on your site
curl -s -I -H "Accept-Encoding: br" https://macksportreport.com/ | grep -i "content-encoding"
# Expected: content-encoding: br

# If gzip, Brotli isn't active for this request
curl -s -I -H "Accept-Encoding: gzip" https://macksportreport.com/ | grep -i "content-encoding"
# Expected: content-encoding: gzip (fallback when br not requested)

# Compare actual response sizes
echo "=== Brotli response size ==="
curl -s -o /dev/null -w "%{size_download} bytes\n" -H "Accept-Encoding: br" https://macksportreport.com/

echo "=== No compression response size ==="
curl -s -o /dev/null -w "%{size_download} bytes\n" --compressed -H "Accept-Encoding: identity" https://macksportreport.com/
```

### Lab 3: Verify Polish (WebP Conversion)

```bash
# Request an image and check for WebP + Polish headers
curl -s -I \
  -H "Accept: image/webp,image/*,*/*;q=0.8" \
  "https://macksportreport.com/path/to/image.jpg" | grep -E "content-type|cf-polished"

# Expected output:
# content-type: image/webp        ← converted to WebP
# cf-polished: sizeDiff=-18924    ← bytes saved by Polish

# Compare file sizes (original vs WebP)
ORIGINAL_SIZE=$(curl -s -o /dev/null -w "%{size_download}" \
  -H "Accept: image/jpeg" \
  "https://macksportreport.com/path/to/image.jpg")

WEBP_SIZE=$(curl -s -o /dev/null -w "%{size_download}" \
  -H "Accept: image/webp,image/*,*/*;q=0.8" \
  "https://macksportreport.com/path/to/image.jpg")

echo "Original: ${ORIGINAL_SIZE} bytes"
echo "WebP: ${WEBP_SIZE} bytes"
echo "Savings: $(echo "scale=1; ($ORIGINAL_SIZE - $WEBP_SIZE) * 100 / $ORIGINAL_SIZE" | bc)%"
```

### Lab 4: Verify HTTP/3 Support

```bash
# Check for Alt-Svc header indicating H3 support
curl -s -I https://macksportreport.com/ | grep -i "alt-svc"
# Expected: alt-svc: h3=":443"; ma=86400

# Verify HTTP/2 is active
curl -s -I --http2 https://macksportreport.com/ | head -1
# Expected: HTTP/2 200

# Full headers dump for protocol verification
curl -v --http2 https://macksportreport.com/ -o /dev/null 2>&1 | grep -E "< HTTP|< alt-svc|< content-encoding"
```

### Lab 5: Test Rocket Loader (and Safe Exclusion)

```bash
# Check if Rocket Loader is rewriting script tags
curl -s https://macksportreport.com/ | grep -c "rocketscript"
# Returns number of scripts deferred by Rocket Loader

# View which scripts are being deferred
curl -s https://macksportreport.com/ | grep -o 'src="[^"]*"' | head -20

# Check for the Rocket Loader bootstrapper script
curl -s https://macksportreport.com/ | grep "rocket-loader"

# If you need to exclude a specific script from Rocket Loader,
# add data-cfasync="false" to the script tag in your HTML:
# <script src="/critical.js" data-cfasync="false"></script>
# This tells CF not to defer this particular script
```

### Lab 6: Full Speed Audit Script

```bash
#!/bin/bash
# speed-audit.sh — Comprehensive speed settings verification

DOMAIN="${1:-macksportreport.com}"
URL="https://$DOMAIN"

echo "================================"
echo "Speed Settings Audit: $DOMAIN"
echo "================================"
echo ""

echo "--- Compression ---"
BR=$(curl -sI -H "Accept-Encoding: br" "$URL" | grep -i "content-encoding" | tr -d '\r')
echo "Brotli: $BR"
GZ=$(curl -sI -H "Accept-Encoding: gzip" "$URL" | grep -i "content-encoding" | tr -d '\r')
echo "Gzip fallback: $GZ"
echo ""

echo "--- Protocol ---"
H2=$(curl -sI --http2 "$URL" 2>&1 | head -1 | tr -d '\r')
echo "HTTP/2: $H2"
H3=$(curl -sI "$URL" | grep -i "alt-svc" | tr -d '\r')
echo "HTTP/3 availability: ${H3:-NOT ADVERTISED}"
echo ""

echo "--- Cloudflare Headers ---"
CF_RAY=$(curl -sI "$URL" | grep -i "cf-ray" | tr -d '\r')
echo "CF-Ray: $CF_RAY"
CF_CACHE=$(curl -sI "$URL" | grep -i "cf-cache-status" | tr -d '\r')
echo "CF-Cache: $CF_CACHE"
echo ""

echo "--- Rocket Loader ---"
RL_COUNT=$(curl -s "$URL" | grep -c "rocketscript" 2>/dev/null || echo "0")
echo "Scripts deferred by Rocket Loader: $RL_COUNT"
echo ""

echo "--- Transfer Size ---"
SIZE=$(curl -sI "$URL" | grep -i "content-length" | tr -d '\r')
echo "Content-Length: ${SIZE:-not specified (streaming)}"
echo ""
echo "Audit complete."
```

```bash
chmod +x speed-audit.sh
./speed-audit.sh macksportreport.com
```

---

## Demo Script (2 Minutes)

**Audience:** Developer or technical founder

---

**[0:00 – 0:20] The Setup**

"I want to show you how to get a 20–40% performance improvement on your site in about 3 minutes, without touching a single line of your code."

*Navigate to: macksportreport.com → Speed → Observatory → Run Test. While it runs:*

"This is your baseline."

---

**[0:20 – 0:55] Enable the Features**

*While Observatory test runs, navigate to Speed → Settings.*

"Here's what I'm doing: enabling Brotli — that's better compression than gzip, 20–30% smaller payloads. Early Hints — this tells the browser to start loading your CSS and hero image before the HTML even arrives. And Rocket Loader — this defers your JavaScript so it doesn't block your first paint."

*Toggle each feature on.*

"That took about 45 seconds. Now let's go back to Observatory and run the test again."

---

**[0:55 – 1:30] Compare Before/After**

*Run second Observatory test. Compare results.*

"Your score went from [X] to [Y]. LCP dropped from [A]ms to [B]ms. The changes are already live on your site globally — Cloudflare pushed them to [300+ locations] instantly."

---

**[1:30 – 2:00] Polish Pitch (Pro Upgrade)**

"The one thing I didn't enable yet is Polish — automatic WebP image conversion. Your hero image is currently [size]KB as JPEG. Polish would convert it to WebP at about [size×0.65]KB — a 35% reduction. Polish requires Pro plan. Given that your LCP is currently driven by that image load, it's probably your fastest ROI upgrade. Can I walk you through the Pro features?"

---

## Competitive Context

| Feature | Cloudflare | Fastly | CloudFront | Vercel |
|---------|------------|--------|------------|--------|
| **Auto Minify** | Yes (HTML/CSS/JS) | Manual config | No (origin handles) | Limited |
| **Brotli** | Yes (built-in) | Yes | Yes | Yes |
| **Early Hints (103)** | Yes | Limited | No | Yes (for their framework) |
| **HTTP/3 + QUIC** | Yes (default) | Yes | Yes | Yes |
| **Rocket Loader** | Yes (unique to CF) | No | No | No |
| **Polish (WebP)** | Yes (Pro+) | Image optimization product | Lambda@Edge + Lambda | Built-in (Vercel) |
| **Mirage** | Yes (Pro+) | No | No | No |
| **Zero-config setup** | Yes — dashboard toggles | Requires VCL config | Requires behaviors | Limited |
| **Plan pricing** | From free | Usage-based | Usage-based | Pro $20/mo |

**SE Positioning:** Rocket Loader is uniquely Cloudflare's. No other CDN has an automatic JavaScript async-loading layer at the edge. It's Cloudflare IP. Polish + Mirage provides equivalent functionality to Imgix or Cloudinary for standard use cases — included in Pro plan rather than a separate SaaS product at $99+/month.

---

## Self-Check Questions

**Instructions:** Answer each question without referring to your notes.

---

**Q1.** A customer enables Auto Minify for JavaScript and reports that their checkout page is now broken. Walk through your systematic debugging process. What is the likely cause, and what is the fix?

```
Your answer:




```

---

**Q2.** Explain how Brotli compression works at a protocol level — specifically how browser and server negotiate which compression algorithm to use. What happens when a browser that doesn't support Brotli makes a request?

```
Your answer:




```

---

**Q3.** What is the specific problem that Early Hints (HTTP 103) solves? Draw a simplified timeline showing a page load WITH and WITHOUT Early Hints to illustrate the improvement.

```
Your answer:




```

---

**Q4.** A customer asks: "Does HTTP/3 help my users or is it just a spec no one uses?" Answer with specific data about real-world improvement scenarios and browser adoption.

```
Your answer:




```

---

**Q5.** A customer has Polish enabled with lossy compression. Their designer reports that product images look different on the site vs their original files. How do you diagnose whether Polish is the cause, and what configuration change would preserve image fidelity while still reducing file size?

```
Your answer:




```

---

## Sources

- [Cloudflare Auto Minify](https://developers.cloudflare.com/speed/optimization/content/auto-minify/)
- [Cloudflare Brotli Compression](https://developers.cloudflare.com/speed/optimization/content/brotli/)
- [Cloudflare Early Hints](https://developers.cloudflare.com/cache/about/early-hints/)
- [Cloudflare Rocket Loader](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/)
- [Cloudflare Polish](https://developers.cloudflare.com/images/polish/)
- [Cloudflare Mirage](https://developers.cloudflare.com/speed/optimization/images/mirage/)
- [Cloudflare HTTP/2 and HTTP/3](https://developers.cloudflare.com/fundamentals/reference/http2-http3/)
- [Brotli Compression Algorithm (Google)](https://github.com/google/brotli)
- [Early Hints — Chromium Blog](https://developer.chrome.com/blog/early-hints/)
- [QUIC Protocol — IETF RFC 9000](https://www.rfc-editor.org/rfc/rfc9000)
- [WebP Format Documentation](https://developers.google.com/speed/webp)
- [HTTP/3 — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Glossary/HTTP_3)
