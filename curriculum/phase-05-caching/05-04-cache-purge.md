# Module 5.4 — Cache Purge
> Dashboard Location: macksportreport.com → Caching → Configuration (Purge Cache button)
> Estimated Time: 90 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### The Stale Content Problem

Caching creates a fundamental tension: **the longer you cache, the better your performance and the lower your origin load — but the longer users might see outdated content**.

For macksportreport.com, this tension is acute:
- Cache articles for 1 hour → great performance, but if a score is corrected, users see wrong data for up to 60 minutes
- Cache articles for 1 minute → fresh data, but your origin handles far more requests

**Cache purge is the solution.** Instead of using a short TTL as a safety net, you use a long TTL for performance and trigger targeted purges whenever content actually changes.

```
Short TTL strategy:
  Cache: 5 minutes → Origin sees 288 req/user/day even with perfect caching

Long TTL + targeted purge:
  Cache: 24 hours → Origin sees 1 req on update + 1 req on user's first visit
```

For a news site, the optimal pattern is:
1. Cache articles for 24 hours (excellent cache hit ratio)
2. When an article is updated, immediately purge that specific URL
3. Next request fetches fresh from origin, is cached again for 24 hours

This is the **publish → cache → purge on update** workflow used by major news organizations.

### The Five Purge Methods

Cloudflare offers five distinct purge mechanisms. Each has different scope, speed, and plan availability.

| Method | Scope | Plan | When to Use |
|--------|-------|------|-------------|
| **Purge Everything** | Entire zone | All | Emergency only — nuke everything |
| **Purge by URL** | Single URL | All | After specific page update |
| **Purge by Prefix** | All URLs with prefix | Enterprise | After category update |
| **Purge by Tag** | All URLs sharing a tag | Enterprise | Content group updates |
| **Purge by Hostname** | All URLs on a host | Enterprise | Multi-hostname zone reset |

---

## Deep Dive (Architect-Level)

### Purge Everything

**What it does:** Invalidates every cached asset across every Cloudflare PoP for the zone. The next request for any resource will be a cache MISS.

**Use cases:**
- Emergency: you deployed bad code and cached responses are serving errors
- Major site redesign: all CSS, JS, HTML cached files need to refresh
- Security incident: cached content contains sensitive data that must be removed

**Risks:**
- Immediate origin traffic spike: all assets go to MISS simultaneously
- Origin may not handle the sudden load increase
- Can cause a "cache stampede" on high-traffic sites

**Mitigation:** Use Tiered Cache — purge propagates from edges to upper tiers gracefully.

```bash
# Purge Everything via API
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything": true}'
```

**Response time:** Globally propagated within ~150ms per Cloudflare SLA.

---

### Purge by URL

**What it does:** Invalidates one or more specific URLs. The next request to that exact URL fetches fresh from origin.

**Limitations:**
- Maximum **30 URLs per API request** (for single POST call)
- URL must match exactly (including protocol, query string)
- Does NOT auto-purge all query string variations of a URL

**Example:** If an article at `/articles/nfl-playoffs` was shared with 50 different UTM parameters, you'd need to purge each variant separately OR use prefix/tag purge.

```bash
# Purge specific URLs
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "files": [
      "https://macksportreport.com/articles/nfl-playoffs",
      "https://macksportreport.com/",
      "https://macksportreport.com/standings/afc"
    ]
  }'
```

**With headers (for Vary-based caching):**
```bash
# Purge URL with specific header variation (for Vary: Accept-Language)
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "files": [
      {
        "url": "https://macksportreport.com/articles/nfl-playoffs",
        "headers": {
          "Accept-Language": "en-US"
        }
      },
      {
        "url": "https://macksportreport.com/articles/nfl-playoffs",
        "headers": {
          "Accept-Language": "es-ES"
        }
      }
    ]
  }'
```

---

### Purge by Prefix (Enterprise)

**What it does:** Invalidates ALL cached URLs that begin with a given prefix.

```bash
# Purge all URLs under /articles/
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "prefixes": [
      "macksportreport.com/articles/",
      "macksportreport.com/standings/"
    ]
  }'
```

**Use cases:**
- Season starts/ends → purge all `/standings/` pages
- Category rebrand → purge `/nfl/` or `/nba/`
- Bug fix affecting all article pages → purge `/articles/`

**Limitations:** Enterprise only. Up to 30 prefixes per request.

---

### Purge by Tag (Enterprise)

Cache tags are the most powerful purge mechanism. They enable you to group cached responses under arbitrary labels and purge the entire group with a single API call.

#### Setting Up Cache Tags

Your origin adds a `Cache-Tag` response header:

```http
HTTP/1.1 200 OK
Content-Type: text/html
Cache-Control: public, max-age=86400
Cache-Tag: article-1234, author-john-doe, category-nfl, season-2024

<!DOCTYPE html>...
```

Cloudflare stores the tags with the cached response. When you purge `article-1234`, every cached URL that was served with `Cache-Tag: article-1234` is invalidated — regardless of URL pattern.

**Multiple tags per response:** A single response can have many tags.

**Tag format rules:**
- Comma-separated in the header value
- Maximum tag string length: 1024 characters
- Maximum unique tags per zone: 1 million

#### Tag Strategy for macksportreport.com

```
Article page: Cache-Tag: article-{id}, author-{author_id}, category-{sport}, team-{team_id}
Standings page: Cache-Tag: standings, standings-{conference}, standings-{division}
Homepage: Cache-Tag: homepage, latest-articles, featured
Player profile: Cache-Tag: player-{player_id}, team-{team_id}
```

**Power query: "Update player #42's stats, invalidate everything related"**
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"tags": ["player-42"]}'
```

This single API call purges:
- The player's profile page
- Every article that mentions them
- Any standings page showing their team
- Any search result page that includes them

Without tags, you'd need to track every URL that mentions player #42 — which is impossible at scale.

---

### Purge Rate Limits

| Action | Limit |
|--------|-------|
| Purge Everything | No documented per-second limit; use sparingly |
| URL purge | 1,000 URLs per single API call (note: docs say 30 per call, but batching to 1,000 in the files array is supported) |
| Tag purge | 30 tags per API call |
| Prefix purge | 30 prefixes per API call |
| API requests per minute | 1,200 (general API rate limit) |

**Note:** There is no separate "purge rate limit" documented, but excessive purge requests can trigger the general API rate limit of 1,200 requests/minute.

---

### Purge Propagation Time

Cloudflare's SLA for purge propagation is **under 150 milliseconds globally**. In practice, most purges propagate in under 100ms.

**What happens during propagation:**
1. You call the Purge API
2. Cloudflare's control plane sends invalidation messages to all PoPs
3. Each PoP marks the resource as stale/expired in its local cache
4. The next request to any PoP for that resource results in a MISS and an origin fetch

**After purge, the first request from each PoP is a MISS.** With 330 PoPs, if all receive traffic simultaneously, your origin could receive up to 330 concurrent requests for the same resource within the first second after purge. This is why Tiered Cache is important — upper tier PoPs absorb the initial MISS and lower tier PoPs get a HIT from the upper tier.

---

### Purge in CI/CD Pipelines

Integrating cache purge into your deployment workflow ensures users never see stale content after a deploy.

#### GitHub Actions Example

```yaml
# .github/workflows/deploy.yml
name: Deploy and Purge Cache

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Deploy to origin
        run: |
          # Your deployment command here
          ./scripts/deploy.sh

      - name: Purge Cloudflare Cache
        env:
          CF_ZONE_ID: ${{ secrets.CF_ZONE_ID }}
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
        run: |
          # Purge specific URLs after deploy
          curl -s -X POST \
            "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
            -H "Authorization: Bearer ${CF_API_TOKEN}" \
            -H "Content-Type: application/json" \
            -d '{
              "files": [
                "https://macksportreport.com/",
                "https://macksportreport.com/standings/",
                "https://macksportreport.com/assets/main.css",
                "https://macksportreport.com/assets/app.js"
              ]
            }' | jq .result.success

      - name: Verify Cache Purge
        run: |
          sleep 2  # Brief delay for propagation
          STATUS=$(curl -sI https://macksportreport.com/assets/main.css | grep cf-cache-status)
          echo "Cache status after purge: ${STATUS}"
          # Should show MISS on first request after purge
```

#### Node.js Purge Script

```javascript
// scripts/purge-cache.js
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ZONE_ID = process.env.CF_ZONE_ID;

async function purgeUrls(urls) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ files: urls })
    }
  );

  const data = await response.json();
  
  if (!data.success) {
    console.error('Purge failed:', data.errors);
    process.exit(1);
  }
  
  console.log('Purged successfully:', urls);
  return data;
}

async function purgeTags(tags) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tags })
    }
  );

  const data = await response.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors));
  console.log('Purged tags:', tags);
  return data;
}

// Example: purge after article update
async function main() {
  const articleId = process.argv[2];
  
  if (!articleId) {
    // Purge static assets after deploy
    await purgeUrls([
      'https://macksportreport.com/assets/main.css',
      'https://macksportreport.com/assets/app.js',
      'https://macksportreport.com/'
    ]);
  } else {
    // Purge specific article by tag
    await purgeTags([`article-${articleId}`]);
  }
}

main().catch(console.error);
```

---

### Purge vs Cache Rule Bypass: Key Distinction

| | Cache Purge | Cache Rule Bypass |
|-|-------------|-------------------|
| What it does | Removes existing cached copy | Prevents caching from happening |
| When to use | After content update | For always-dynamic content |
| Effect on cache | Removes entry; next request → MISS | Entry never stored |
| User impact | First request after purge: origin latency | Every request: origin latency |
| Persistent? | One-time action | Ongoing rule |

---

## Dashboard Walkthrough

### Step 1: Access Purge Cache

1. Cloudflare Dashboard → **macksportreport.com**
2. Left sidebar → **Caching** → **Configuration**
3. Scroll to **Purge Cache** section

### Step 2: Purge by URL
1. Click **Custom Purge**
2. Select **URL** tab
3. Enter: `https://macksportreport.com/articles/`
4. Add more URLs as needed (one per line)
5. Click **Purge**

### Step 3: Purge Everything
1. Click **Purge Everything**
2. Confirm the modal warning: "Are you sure? This will purge all cached assets."
3. Click **Purge**

### Step 4: Verify Purge Worked

```bash
# After purge, first request should be MISS
curl -sI https://macksportreport.com/articles/ | grep cf-cache-status
# Expected: cf-cache-status: MISS

# Second request should be HIT again
curl -sI https://macksportreport.com/articles/ | grep cf-cache-status
# Expected: cf-cache-status: HIT
```

---

## Hands-On Lab

### Lab Setup

```bash
export CF_ZONE_ID="your_zone_id"
export CF_API_TOKEN="your_api_token"
```

### Lab 1: Baseline Cache State Check

```bash
# Get the current cf-cache-status and age for key URLs
for URL in \
  "https://macksportreport.com/" \
  "https://macksportreport.com/favicon.ico"; do
  echo -n "${URL}: "
  curl -sI "${URL}" | grep -i cf-cache-status | tr -d '\r'
done
```

### Lab 2: Purge a Single URL and Verify

```bash
# Purge favicon.ico
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"files": ["https://macksportreport.com/favicon.ico"]}' | jq .

# Immediately verify — should be MISS
curl -sI https://macksportreport.com/favicon.ico | grep cf-cache-status
# Expected: MISS

# Wait 1 second, request again — should cache again
sleep 1
curl -sI https://macksportreport.com/favicon.ico | grep cf-cache-status
# Expected: HIT or MISS (depends on if Cloudflare re-cached on first request)
```

### Lab 3: Bulk URL Purge

```bash
# Purge multiple URLs at once
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "files": [
      "https://macksportreport.com/",
      "https://macksportreport.com/favicon.ico",
      "https://macksportreport.com/articles/"
    ]
  }' | jq '{success: .success, id: .result.id}'
```

### Lab 4: Purge Everything

```bash
# WARNING: This purges all cached content for the zone
# Use only in a test scenario
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything": true}' | jq .

# Verify — multiple assets should now be MISS
for URL in \
  "https://macksportreport.com/" \
  "https://macksportreport.com/favicon.ico"; do
  echo -n "${URL}: "
  curl -sI "${URL}" | grep -i cf-cache-status | tr -d '\r'
done
```

### Lab 5: Simulate Cache Tag Workflow (Origin-Side Setup)

If you have access to your origin server configuration (nginx, Apache, or application server):

```nginx
# nginx: Add Cache-Tag headers to articles
location /articles/ {
  # Your proxy_pass configuration
  add_header Cache-Tag "articles $arg_category";
  add_header Cache-Control "public, max-age=86400";
}
```

```python
# Python Flask: Add Cache-Tag headers
@app.route('/articles/<slug>')
def article(slug):
    article = get_article(slug)
    response = make_response(render_template('article.html', article=article))
    tags = f"article-{article.id},category-{article.category},author-{article.author_id}"
    response.headers['Cache-Tag'] = tags
    response.headers['Cache-Control'] = 'public, max-age=86400'
    return response
```

```bash
# Then purge by tag (Enterprise zones only)
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"tags": ["articles"]}' | jq .
```

### Lab 6: Build a Purge Script with Retry Logic

```bash
#!/bin/bash
# purge.sh — Purge with retry on rate limit

CF_ZONE_ID="${CF_ZONE_ID:?CF_ZONE_ID is required}"
CF_API_TOKEN="${CF_API_TOKEN:?CF_API_TOKEN is required}"

purge_urls() {
  local urls=("$@")
  local payload=$(printf '%s\n' "${urls[@]}" | jq -R . | jq -s '{files: .}')
  
  local max_retries=3
  local attempt=0
  
  while [ $attempt -lt $max_retries ]; do
    local response=$(curl -s -X POST \
      "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "${payload}")
    
    local success=$(echo "$response" | jq -r '.success')
    
    if [ "$success" = "true" ]; then
      echo "Purge successful"
      return 0
    fi
    
    local error_code=$(echo "$response" | jq -r '.errors[0].code')
    
    # Rate limit: code 10000 or HTTP 429
    if [ "$error_code" = "10000" ]; then
      echo "Rate limited. Waiting 60 seconds..."
      sleep 60
    else
      echo "Purge failed: ${response}"
      return 1
    fi
    
    attempt=$((attempt + 1))
  done
  
  echo "Max retries exceeded"
  return 1
}

# Usage: ./purge.sh "https://macksportreport.com/" "https://macksportreport.com/articles/"
purge_urls "$@"
```

```bash
chmod +x purge.sh
./purge.sh "https://macksportreport.com/" "https://macksportreport.com/favicon.ico"
```

### Lab 7: Measure Time-to-Purge Propagation

```bash
# Measure how quickly purge propagates globally
# First, establish a HIT
curl -sI https://macksportreport.com/favicon.ico | grep cf-cache-status

# Trigger purge and measure
start_time=$(date +%s%N)
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"files": ["https://macksportreport.com/favicon.ico"]}' > /dev/null
end_time=$(date +%s%N)

purge_api_ms=$(( (end_time - start_time) / 1000000 ))
echo "Purge API call took: ${purge_api_ms}ms"

# Check how quickly it shows as MISS
for i in {1..5}; do
  STATUS=$(curl -sI https://macksportreport.com/favicon.ico | grep cf-cache-status)
  echo "Attempt ${i}: ${STATUS}"
  sleep 0.2
done
```

---

## Demo Script (2 Minutes)

**Audience:** Content editor or site reliability engineer
**Setup:** Browser open to macksportreport.com article, terminal ready

---

**[0:00]** "Here's the problem cache purge solves: you cached an article for 24 hours for performance. Then you discover a factual error and fix it. Users are still seeing the wrong version."

```bash
# Show article is cached (HIT with age > 0)
curl -sI https://macksportreport.com/articles/nfl-playoffs | grep -i "cf-cache\|age"
# cf-cache-status: HIT
# age: 7234  ← been cached for 2 hours already
```

**[0:20]** "That content update you just deployed? Still not reaching users. Here's how we fix it instantly."

```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"files": ["https://macksportreport.com/articles/nfl-playoffs"]}' | jq .success
# true
```

**[0:45]** "Done. That propagated to 330 data centers in under 150 milliseconds. Let's verify:"

```bash
curl -sI https://macksportreport.com/articles/nfl-playoffs | grep cf-cache-status
# cf-cache-status: MISS ← fresh fetch from origin
```

**[1:00]** "MISS — Cloudflare just fetched the updated article from your server. The next user sees the corrected content. And it's already being re-cached, so subsequent users still get sub-millisecond response times."

**[1:20]** "For a CMS integration, you'd call this API automatically whenever an editor publishes an update. One API call, zero manual intervention, users always see fresh content."

**[1:45]** "The alternative is a 5-minute cache TTL and constant origin load. Purge lets you have 24-hour TTL AND always-fresh content. That's the business case for getting this right."

---

## Competitive Context

| Feature | Cloudflare | AWS CloudFront | Fastly | Akamai |
|---------|-----------|----------------|--------|--------|
| Purge Everything | ✅ Instant | ✅ Distribution-level | ✅ Instant | ✅ |
| Purge by URL | ✅ Up to 1,000 URLs/call | ✅ Up to 3,000 paths/call | ✅ | ✅ |
| Purge by Tag | ✅ Enterprise | ❌ Not native (Lambda@Edge workaround) | ✅ Surrogate-Key | ✅ |
| Purge by Prefix | ✅ Enterprise | ✅ Wildcard invalidation | ✅ | ✅ |
| Purge by Hostname | ✅ Enterprise | N/A | ✅ | ✅ |
| Propagation time | ~150ms | 10-60 seconds | < 500ms | Variable |
| API authentication | Bearer token | AWS Signature v4 | Fastly API key | Akamai EdgeGrid |
| CI/CD integration | Simple REST | AWS SDK | Simple REST | SDK required |
| Free tier purge | ✅ Unlimited URL purges | Limited by AWS pricing | Limited | No free tier |
| Tag setup | Cache-Tag header | CloudFront Invalidation API | Surrogate-Key header | Akamai-Cache-Tag |

**Critical Cloudflare differentiator:** ~150ms global propagation vs CloudFront's 10-60 second invalidation time. For real-time content updates on a sports site, this is the difference between users seeing "correction published" and "correction published in 60 seconds."

---

## Self-Check Questions

**Q1.** An article on macksportreport.com was cached with 15 different UTM parameter variations in the URL. You purge the canonical URL `https://macksportreport.com/articles/nfl-playoffs`. Are the UTM variant URLs also purged? What would you need to use instead to purge all variants with one operation?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q2.** You're setting up a CI/CD pipeline that deploys new CSS and JS assets. The assets use content-hash filenames (`main.a1b2c3.css`), meaning filenames change every deploy. How does this affect your purge strategy? Do you even need to purge?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q3.** Your site has 10,000 article pages. A breaking news story triggers updates across 500 articles simultaneously. What purge strategy would you use, and what are the operational risks you need to mitigate?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q4.** After you run a Purge Everything, your analytics show a spike in origin traffic. Explain exactly why this happens and what you could have done to reduce the impact.

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q5.** Describe the Cache-Tag architecture you would implement for macksportreport.com, including what tags you'd assign to: (a) an NFL game recap article, (b) a standings page, (c) the homepage. How would a trade affecting two teams trigger the minimal necessary purge operations?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

---

## Sources

- [Purge Cache — Cloudflare Docs](https://developers.cloudflare.com/cache/how-to/purge-cache/)
- [Purge by URL](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-single-file/)
- [Purge by Tag (Cache-Tag)](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/)
- [Purge by Prefix](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-prefix/)
- [Cloudflare API — Purge Cache](https://developers.cloudflare.com/api/resources/cache/methods/purge/)
- [Cache-Tag Header Reference](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/#add-cache-tag-http-response-headers)
- [GitHub Actions — Cloudflare Purge Action](https://github.com/marketplace/actions/cloudflare-purge-cache)
- [Purge Rate Limits](https://developers.cloudflare.com/fundamentals/api/reference/limitations/)
