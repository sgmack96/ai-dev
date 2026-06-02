# Module 4.1 — Observatory (Performance Testing)
> Dashboard Location: macksportreport.com → Speed → Observatory | Estimated Time: 90 minutes | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is Cloudflare Observatory?

Observatory is Cloudflare's built-in performance testing tool, powered by Google Lighthouse and run directly from Cloudflare's global edge network. Instead of running Lighthouse from your local machine — which reflects your local network conditions, ISP, and geographic proximity to the origin — Observatory runs tests from Cloudflare edge nodes distributed around the world, giving you a consistent, reproducible, network-neutral view of how your site performs.

When a customer says "my site feels slow," Observatory is the first place you go. It gives you a structured, scored, actionable answer.

**Why it matters for SEs:**
- Instant credibility in discovery calls — "Let me pull up your Observatory score right now"
- Creates urgency: a failing LCP score is a business problem, not just a technical one
- Ties directly to Cloudflare optimization features, so every recommendation has a fix you can sell

### Core Web Vitals Explained

Google's Core Web Vitals are a set of real-world user experience signals that directly impact Google Search rankings (since May 2021). Observatory measures all three.

#### LCP — Largest Contentful Paint
- **What it measures:** How long until the largest visible element (hero image, heading, video poster) is fully rendered
- **Good:** < 2.5 seconds
- **Needs Improvement:** 2.5s – 4.0s
- **Poor:** > 4.0 seconds
- **Business impact:** Every 100ms improvement in LCP correlates with ~1% conversion rate improvement (Google/Deloitte study)
- **Common causes of slow LCP:** Large uncompressed images, render-blocking JavaScript, slow TTFB, no CDN

#### FID / INP — First Input Delay / Interaction to Next Paint
- **FID (legacy):** Time from first user interaction to browser responding. Being deprecated.
- **INP (current standard):** Measures ALL interactions throughout the session, not just the first. Reports the worst-case interaction latency at p98.
- **Good INP:** < 200ms
- **Needs Improvement:** 200ms – 500ms
- **Poor:** > 500ms
- **Common causes:** Long JavaScript tasks blocking the main thread, third-party scripts, heavy event handlers

#### CLS — Cumulative Layout Shift
- **What it measures:** How much content unexpectedly moves while the page loads (images without dimensions, late-loading ads, web fonts causing FOUT)
- **Good:** < 0.1
- **Needs Improvement:** 0.1 – 0.25
- **Poor:** > 0.25
- **Business impact:** Users clicking the wrong button because content shifted is a direct UX failure
- **Common causes:** Images/iframes without explicit width/height, dynamically injected content above existing content

### Performance Score (0–100)

Observatory returns a composite Lighthouse Performance Score based on a weighted formula:

| Metric | Weight |
|--------|--------|
| FCP (First Contentful Paint) | 10% |
| Speed Index | 10% |
| LCP | 25% |
| TBT (Total Blocking Time) | 30% |
| CLS | 15% |
| **Time to Interactive** | 10% |

Score ranges:
- **90–100:** Fast (green) — site is well optimized
- **50–89:** Needs improvement (orange) — noticeable issues
- **0–49:** Poor (red) — significant problems affecting users and SEO

---

## Deep Dive (Architect-Level)

### How Observatory Differs from Local Lighthouse

| Dimension | Local Lighthouse | CF Observatory |
|-----------|-----------------|----------------|
| Network | Your ISP, your location | CF edge, globally consistent |
| Hardware | Your laptop CPU | Standardized edge compute |
| Reproducibility | Varies by machine state | Consistent across runs |
| Geographic coverage | Single location | Multiple global regions |
| Affected by local cache | Yes | No (cold cache per run) |
| Frequency | Manual | Manual + scheduled |

Running Lighthouse locally on a MacBook Pro on a fast corporate WiFi connection shows you the *best case*. Observatory shows you what a real user in that region actually experiences.

### How Cloudflare Runs Observatory Tests

1. You trigger a test from the dashboard (or API)
2. Cloudflare spins up a headless Chromium instance at the selected edge location
3. The browser loads your URL with a cold cache (no prior cookies, no cached assets)
4. Lighthouse audits run: network waterfall captured, JS execution timed, layout shifts recorded
5. Results stored and scored, recommendations generated

The key architectural difference: Cloudflare's test nodes fetch your origin through the CF network, meaning your cache, CDN, and Cloudflare optimization features (Rocket Loader, Polish, Early Hints) are all active during the test. This is intentional — it measures the actual end-user experience through CF.

### Observatory and Cloudflare Features Correlation

| CF Feature | Primary Metric Improved | Mechanism |
|------------|------------------------|-----------|
| Rocket Loader | TBT, FCP, LCP | Defers non-critical JS, unblocks rendering |
| Auto Minify | LCP, Speed Index | Smaller HTML/CSS/JS = faster parse |
| Brotli | LCP, TTFB | Smaller transfer sizes |
| Early Hints (103) | LCP | Browser preloads resources before HTML arrives |
| Image Polish | LCP | Smaller image payload, faster render |
| APO (Automatic Platform Optimization) | LCP, TTFB, FID | Serves full HTML from cache, eliminates origin round-trips |
| Argo Smart Routing | TTFB | Faster path to origin |
| HTTP/3 | FCP, LCP | Eliminates head-of-line blocking, faster on lossy networks |

### Recommendations Panel — What CF Suggests

Observatory generates actionable recommendations based on the Lighthouse audit results. Categories include:

**Render-blocking resources** — Scripts or stylesheets in `<head>` that block HTML parsing. Fix: defer/async JS, inline critical CSS.

**Image optimization** — Images not sized correctly, no next-gen format (WebP/AVIF), no lazy loading. Fix: enable Polish, add `loading="lazy"`.

**Unused JavaScript** — Large JS bundles where most code isn't executed on the current page. Fix: code splitting, tree shaking.

**Text compression** — Resources served without Brotli or gzip. Fix: enable Brotli in CF dashboard.

**Long main-thread tasks** — JavaScript taking > 50ms on the main thread. Fix: reduce third-party scripts, use web workers.

**No caching on static assets** — Assets with short or no cache TTL. Fix: add Cache Rules in CF.

---

## Dashboard Walkthrough

### Step 1: Navigate to Observatory
```
macksportreport.com → Speed (left nav) → Observatory
```

### Step 2: Understand the Overview Panel
- Current performance score (large circle, color-coded)
- Core Web Vitals status: LCP / INP / CLS with pass/fail badges
- Last test date and test region
- "Run Test" button (top right)

### Step 3: Run a New Test
1. Click "Run Test"
2. Select region (default: your nearest CF data center, or choose from dropdown)
3. Wait 30–60 seconds for headless browser run to complete
4. New results appear; compare with previous run

### Step 4: Read the Diagnostics Tab
- Each Lighthouse audit listed with pass/fail
- Click any audit to expand: what failed, why it matters, how to fix it
- "Opportunities" section shows estimated time savings per fix

### Step 5: Test History
- Timeline view of all previous Observatory runs
- Score trend over time — useful for showing improvement after enabling CF features
- Click any historical run to see full details

### Step 6: Compare Regions
- Re-run test selecting different geographic regions
- Common comparison: US East, US West, Europe (Frankfurt), Asia (Tokyo)
- If scores diverge significantly by region, origin proximity is likely the bottleneck → Argo or Tiered Caching recommendation

---

## Hands-On Lab

### Prerequisites
- Cloudflare account with macksportreport.com active
- API token with Zone:Read and Zone Settings:Edit permissions

### Lab 1: Trigger Observatory Test via API

```bash
# Set your variables
export CF_API_TOKEN="your_api_token_here"
export ZONE_ID="your_zone_id_here"

# Get zone ID if you don't have it
curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=macksportreport.com" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.result[0].id'

# Trigger an Observatory test
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/speed_api/schedule" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://macksportreport.com",
    "region": "us-central1"
  }' | jq '.'
```

### Lab 2: Retrieve Test Results

```bash
# List all tests for a URL
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/speed_api/pages/macksportreport.com/tests" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.result[] | {id: .id, score: .mobile.performance_score, lcp: .mobile.metrics.largest_contentful_paint, cls: .mobile.metrics.cumulative_layout_shift}'

# Get specific test details
TEST_ID="your_test_id"
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/speed_api/pages/macksportreport.com/tests/$TEST_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
```

### Lab 3: Schedule Recurring Tests

```bash
# Schedule weekly test from us-central1
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/speed_api/schedule" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://macksportreport.com/",
    "region": "us-central1",
    "frequency": "WEEKLY"
  }' | jq '.'

# Verify schedule
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/speed_api/schedule/macksportreport.com" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.'
```

### Lab 4: Enable Early Hints (improves LCP score)

```bash
# Enable Early Hints for the zone
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/early_hints" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq '.result'

# Enable Rocket Loader
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/rocket_loader" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq '.result'

# After enabling, re-run Observatory and compare LCP
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/speed_api/schedule" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://macksportreport.com", "region": "us-central1"}' | jq '.result.id'
```

### Lab 5: Check Current Lighthouse Score via curl + Interpret

```bash
# Simulate what Observatory is doing — run Lighthouse CLI locally for comparison
# Install: npm install -g lighthouse

lighthouse https://macksportreport.com \
  --output=json \
  --output-path=./lighthouse-report.json \
  --only-categories=performance \
  --chrome-flags="--headless"

# Extract key metrics
cat lighthouse-report.json | jq '{
  score: .categories.performance.score,
  lcp: .audits["largest-contentful-paint"].numericValue,
  cls: .audits["cumulative-layout-shift"].numericValue,
  tbt: .audits["total-blocking-time"].numericValue,
  fcp: .audits["first-contentful-paint"].numericValue
}'
```

### Lab 6: Interpret and Document Results

```bash
# Create a performance baseline report
cat << 'EOF' > performance-baseline.md
# Performance Baseline — macksportreport.com
Date: $(date)
Region: us-central1

## Observatory Results
- Score: [fill in]
- LCP: [fill in] (target: <2.5s)
- INP: [fill in] (target: <200ms)
- CLS: [fill in] (target: <0.1)

## Top 3 Recommendations from Observatory
1. [fill in]
2. [fill in]
3. [fill in]

## Features to Enable
- [ ] Early Hints
- [ ] Rocket Loader
- [ ] Image Polish
- [ ] Brotli

## Expected Score After Optimization
[estimate]
EOF
echo "Baseline doc created"
```

---

## Demo Script (2 Minutes)

**Audience:** Customer (marketing + engineering)

---

**[0:00 – 0:20] The Hook**

"Before we talk about what Cloudflare can do for your site speed, let me show you where you actually stand right now. This takes 30 seconds."

*Navigate to: macksportreport.com → Speed → Observatory. Click "Run Test."*

---

**[0:20 – 0:50] While Test Runs**

"What's happening right now: Cloudflare is spinning up a headless Chrome browser at one of our edge locations — the same environment your users hit — and running a full Lighthouse audit. No local network bias, no warm cache, exactly what your users see."

"These three numbers — LCP, INP, CLS — are what Google calls Core Web Vitals. They directly affect your Google Search ranking. A poor LCP score is costing you organic traffic today."

---

**[0:50 – 1:30] Read the Results**

*Results load. Point to the score circle.*

"You're at [score]. Let's look at why."

*Click on the failing LCP audit.*

"Your LCP is [X] seconds. Target is under 2.5. The biggest offender is [element from audit]. Cloudflare can attack this from two angles: Early Hints — which tells the browser to start loading your hero image before the full HTML even arrives — and Image Polish, which automatically converts it to WebP and strips unnecessary metadata."

---

**[1:30 – 2:00] The Close**

"What I want to do is enable three features right now — Early Hints, Rocket Loader, and Image Polish — re-run this test, and show you the delta. In most cases we see a 15–30% score improvement with zero code changes on your end. Want me to proceed?"

---

## Competitive Context

| Dimension | Cloudflare Observatory | Google PageSpeed Insights | GTmetrix | WebPageTest |
|-----------|----------------------|--------------------------|----------|-------------|
| **Where test runs from** | CF edge nodes (global) | Google crawlers | GTmetrix servers | WPT servers (selected) |
| **Integrated with CDN** | Yes — tests through CF | No | No | No |
| **Triggered from** | Dashboard + API | Web UI | Web UI + API | Web UI + API |
| **Scheduling** | Yes (weekly) | No | Paid plans | Paid plans |
| **Tied to optimization features** | Yes — direct recommendations linked to CF features | No | No | No |
| **Cost** | Included in all plans | Free | Free/Paid | Free/Paid |
| **Regions** | Multiple (paid more) | Limited | Multiple (paid) | Many (paid) |
| **Historical tracking** | Yes | No (you must save) | Yes (paid) | Yes (paid) |

**SE Positioning:** Observatory is the only performance testing tool that (a) runs tests through your actual CDN configuration, (b) gives recommendations tied directly to features you can enable in 1 click, and (c) tracks score history over time — all included in the plan you're already paying for.

---

## Self-Check Questions

**Instructions:** Answer each question without referring to your notes. Leave space for your answers.

---

**Q1.** What is the "Good" threshold for Largest Contentful Paint (LCP), and what does exceeding it mean for Google Search rankings?

```
Your answer:




```

---

**Q2.** A customer runs Observatory from their local laptop and gets a score of 85. They run it again from Cloudflare Observatory and get 62. What explains the discrepancy, and which number should you trust?

```
Your answer:




```

---

**Q3.** Name three Cloudflare features that directly improve Observatory scores and explain which Core Web Vital metric each primarily affects.

```
Your answer:




```

---

**Q4.** A customer's Observatory score is 45 (red). LCP is 5.2 seconds. The top recommendation is "Eliminate render-blocking resources." What does this mean in plain language, and what Cloudflare feature would you recommend first?

```
Your answer:




```

---

**Q5.** How does Observatory differ from Cloudflare's Real User Monitoring (RUM), and when would you use each?

```
Your answer:




```

---

## Sources

- [Cloudflare Observatory Documentation](https://developers.cloudflare.com/speed/speed-test/)
- [Core Web Vitals — Google Search Central](https://developers.google.com/search/docs/appearance/core-web-vitals)
- [Cloudflare Speed API Reference](https://developers.cloudflare.com/api/operations/speed-create-test)
- [Early Hints Documentation](https://developers.cloudflare.com/cache/about/early-hints/)
- [Rocket Loader Documentation](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/)
- [Image Polish Documentation](https://developers.cloudflare.com/images/polish/)
- [Lighthouse Performance Scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring/)
- [INP — Interaction to Next Paint](https://web.dev/inp/)
- [Cloudflare APO Documentation](https://developers.cloudflare.com/automatic-platform-optimization/)
