# Module 5.5 — Tiered Cache (Argo Smart Routing + Cache)
> Dashboard Location: macksportreport.com → Caching → Tiered Cache
> Estimated Time: 90 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### The Problem Tiered Cache Solves

Cloudflare operates 330+ Points of Presence (PoPs) worldwide. Without Tiered Cache, each PoP independently maintains its own local cache. This creates a fundamental scaling problem called the **"cold PoP" problem**.

**Scenario without Tiered Cache:**

macksportreport.com publishes a viral NFL story. Within 60 seconds, traffic comes from:
- 12 users in London → PoP LHR serves MISS × 12 (first 12 distinct URLs)
- 8 users in Tokyo → PoP NRT serves MISS × 8
- 45 users in Los Angeles → PoP LAX serves MISS × 45
- 22 users in São Paulo → PoP GRU serves MISS × 22

Each PoP independently fetches from your origin. If the article has 10 embedded assets (images, JS, CSS), that's 10 requests per PoP × 330 PoPs = **3,300 concurrent origin requests** in the worst case, all within the first few minutes of a viral post.

```
PoP LHR ──────────────────────────┐
PoP NRT ──────────────────────────┤
PoP LAX ──────────────────────────┼──→ Origin (overwhelmed)
PoP GRU ──────────────────────────┤
PoP SYD ──────────────────────────┘
... (325 more PoPs)
```

**Scenario with Tiered Cache:**

The same 330 PoPs are organized into a two-tier hierarchy. Lower tier PoPs (the majority) check an Upper Tier PoP before going to origin.

```
PoP LHR (MISS) ──→ Upper Tier FRA (HIT) ──→ Returns cached copy
PoP NRT (MISS) ──→ Upper Tier NRT_UPPER (MISS) ──→ Origin → cached at upper tier
PoP LAX (MISS) ──→ Upper Tier SEA (HIT) ──→ Returns cached copy
PoP GRU (MISS) ──→ Upper Tier GRU_UPPER (HIT) ──→ Returns cached copy
```

Instead of 330 potential origin requests, you might see 5-10 origin requests (one per upper tier region on first request). Every subsequent request from a lower tier PoP gets served by the upper tier's cache.

**Result: 95-99% reduction in origin requests** for high-traffic, globally-accessed content.

---

## Deep Dive (Architect-Level)

### The Two-Tier Architecture

```
User Request
     ↓
Lower Tier PoP (e.g., LHR-B, the small London edge node)
     ↓ MISS
Upper Tier PoP (e.g., FRA01, the Frankfurt hub)
     ↓ HIT? → Returns to Lower Tier → Returns to User
     ↓ MISS
Origin Server
     ↓
Response cached at Upper Tier
     ↓
Response cached at Lower Tier
     ↓
Response returned to User
```

### Cloudflare PoP Tier Structure

Cloudflare's network has three tiers of PoPs:

| Tier | Description | Count | Role in Tiered Cache |
|------|-------------|-------|---------------------|
| **Tier 1** | Major internet hubs (FRA, LHR, LAX, NRT, IAD) | ~20 | Primary Upper Tier candidates |
| **Tier 2** | Regional hubs | ~80 | Secondary Upper Tier / Lower Tier |
| **Tier 3** | Edge delivery PoPs | ~230 | Lower Tier (primary delivery) |

In Tiered Cache topology:
- Tier 3 PoPs → check Tier 2 or Tier 1 upper tier before origin
- Tier 2 PoPs → check Tier 1 before origin (in some topologies)
- Tier 1 PoPs → go directly to origin on MISS

### Tiered Cache Options

#### Generic Global Topology

One upper tier globally. All lower tier PoPs route through a single designated upper tier PoP before hitting origin.

- **Pros:** Simple, consistent, reduces origin requests from all regions
- **Cons:** Higher latency for lower tiers far from the single upper tier
- **Use case:** Small sites, origin in one region, simple architecture

#### Smart Tiered Cache Topology (Recommended)

Cloudflare automatically selects the optimal upper tier PoP for each lower tier based on:
- Network latency between tiers
- Traffic patterns and demand signals
- Historical cache efficiency
- Geographic clustering

Smart topology refreshes periodically as traffic patterns change. A viral article from a US sports site might assign SEA (Seattle) as the upper tier for Pacific Rim traffic, but FRA (Frankfurt) for European traffic.

- **Pros:** Automatically optimized, no manual configuration, adapts to traffic
- **Cons:** Less predictable topology for debugging (you don't always know which upper tier served)
- **Use case:** Most production sites — the default recommendation

#### Custom Topology (Enterprise)

Enterprise customers can manually designate which PoPs act as upper tiers.

- **Pros:** Predictable routing, ability to co-locate upper tier near origin
- **Cons:** Manual management, requires understanding of Cloudflare's PoP geography
- **Use case:** Strict data residency requirements, very large sites with complex regional architectures

### Argo Smart Routing Integration

Argo Smart Routing is a separate Cloudflare product that optimizes the network path between Cloudflare PoPs and your origin server using real-time network intelligence.

Without Argo: Cloudflare uses the public internet to reach your origin.
With Argo: Cloudflare routes traffic over its optimized private backbone, avoiding congested internet exchange points.

**How Argo and Tiered Cache complement each other:**

```
User → Lower Tier PoP → Upper Tier PoP → (Argo optimized path) → Origin
```

- Tiered Cache reduces the **frequency** of origin requests
- Argo reduces the **latency** of each origin request that does occur

When you have both enabled:
- 95% of traffic served from lower/upper tier cache (Tiered Cache)
- The 5% of requests that reach origin travel over Argo's fast backbone

**Cost model:**
- Tiered Cache: Included in Business plan; available as add-on on lower plans
- Argo: $0.10/GB of data transferred over Argo backbone (billed separately)

**ROI calculation:**
- If Argo reduces origin latency by 30ms and origin handles 1M requests/day
- With 95% Tiered Cache hit rate → only 50,000 requests/day reach origin
- Argo cost: $0.10/GB × origin bandwidth transferred
- Argo benefit: 50,000 requests × 30ms improvement = substantial p99 latency reduction

---

### Measuring Tiered Cache Effectiveness

#### Origin Offload Metric

The primary KPI for Tiered Cache is **origin offload percentage**:

```
Origin Offload % = (1 - origin_requests / total_requests) × 100
```

Without Tiered Cache: Good sites see 70-80% offload.
With Tiered Cache: Sites see 90-99% offload for cacheable content.

You can measure this in:
1. **Cloudflare Analytics**: Dashboard → Analytics → Traffic → Requests by Cache Status
   - Sum of HIT + STALE + REVALIDATED + UPDATING = cached
   - Sum of MISS + EXPIRED = origin
   - Offload % = cached / total × 100

2. **Workers Analytics** (if Worker is in front of cache):
   - Measure requests that resulted in `cache.match` returning undefined vs a cached Response

3. **Origin server logs** (ground truth):
   - Compare origin request count to Cloudflare total request count

#### cf-cache-status and Tiered Cache

With Tiered Cache enabled, you still see the same `cf-cache-status` values, but their meaning changes slightly:

| Status | Without Tiered Cache | With Tiered Cache |
|--------|---------------------|-------------------|
| HIT | Served from lower-tier PoP cache | Served from lower OR upper tier cache |
| MISS | Not in cache, fetched from origin | Not in cache at any tier, fetched from origin |
| REVALIDATED | Validated against origin | Validated against upper tier (which validates against origin) |

You cannot distinguish from `cf-cache-status` alone whether a HIT came from the lower tier or upper tier. Use `cf-ray` to identify the serving PoP.

#### Reading cf-ray to Identify PoP

```
cf-ray: 7a1b2c3d4e5f6789-FRA
                              ^^^
                              This 3-letter code identifies the PoP that SERVED the response.
                              FRA = Frankfurt (likely an upper tier)
                              If you're requesting from Munich and see FRA, 
                              you're being served from the Frankfurt upper tier.
```

For lower-tier PoPs serving from upper-tier cache, the `cf-ray` code will be the lower-tier PoP (the PoP that received your request), but the `age` header will be higher than if it had just been fetched — indicating the upper tier had a warm copy.

---

### Enabling and Configuring Tiered Cache

#### Dashboard Method

1. Cloudflare Dashboard → Zone → **Caching** → **Tiered Cache**
2. Toggle **Tiered Cache** to ON
3. Select topology:
   - **Generic Global**: One upper tier
   - **Smart Topology** (recommended): Auto-optimized
   - **Custom** (Enterprise): Manual upper tier selection
4. Click **Save**

#### API Method

```bash
# Enable Tiered Cache with Smart Topology
curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/argo/tiered_caching" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq .

# Check current Tiered Cache status
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/argo/tiered_caching" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq .
```

#### Terraform Method

```hcl
resource "cloudflare_tiered_cache" "macksportreport" {
  zone_id    = var.zone_id
  cache_type = "smart"  # or "generic"
}
```

---

## Dashboard Walkthrough

### Step 1: Access Tiered Cache

1. Cloudflare Dashboard → **macksportreport.com**
2. Left sidebar → **Caching** → **Tiered Cache**
3. Review current status: **Disabled** or **Enabled**

### Step 2: Enable Smart Tiered Cache

1. Toggle the **Tiered Cache** switch to **On**
2. Under **Topology**, select **Smart Tiered Cache Topology**
3. Click **Save**
4. Note the confirmation message: "Tiered Cache is now enabled"

### Step 3: Review Origin Offload Analytics

1. Left sidebar → **Analytics** → **Traffic**
2. Under **Requests** section, look at the **Cache Status** breakdown
3. Compare:
   - **Cached** (HIT + STALE + REVALIDATED) → served without origin
   - **Not Cached** (MISS + EXPIRED) → origin was contacted
4. The goal: >90% cached for content-heavy sites

### Step 4: Check Argo Status (Optional)

1. Left sidebar → **Traffic** → **Argo**
2. If Argo is enabled, review bandwidth savings and latency improvement metrics
3. Note: Argo is billed per GB — verify it's cost-effective for your origin traffic patterns

---

## Hands-On Lab

### Lab Setup

```bash
export CF_ZONE_ID="your_zone_id"
export CF_API_TOKEN="your_api_token"
```

### Lab 1: Check Current Tiered Cache Status

```bash
curl -s "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/argo/tiered_caching" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '{
    status: .result.value,
    id: .result.id,
    modified: .result.modified_on
  }'
```

### Lab 2: Enable Tiered Cache

```bash
curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/argo/tiered_caching" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq '{
    success: .success,
    value: .result.value
  }'
```

### Lab 3: Verify Cache Behavior After Enabling Tiered Cache

```bash
# Purge all cache to start fresh
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything": true}' | jq .success

# Wait for purge propagation
sleep 2

# Make first request (MISS — even upper tier is cold)
curl -sI https://macksportreport.com/favicon.ico | grep -i "cf-cache\|cf-ray\|age"

# Make second request from same origin (HIT — lower tier cached)
curl -sI https://macksportreport.com/favicon.ico | grep -i "cf-cache\|cf-ray\|age"
```

### Lab 4: Measure Origin Offload via Analytics API

```bash
# Get cache analytics for the past 24 hours
curl -s "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/analytics/dashboard?since=-1440&until=0" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '
    .result.totals | {
      total_requests: .requests.all,
      cached_requests: .requests.cached,
      uncached_requests: .requests.uncached,
      offload_percentage: ((.requests.cached / .requests.all) * 100 | round)
    }'
```

### Lab 5: Identify PoP from cf-ray Header

```bash
# Extract the PoP from the cf-ray header
cf_ray=$(curl -sI https://macksportreport.com/ | grep -i cf-ray | awk '{print $2}' | tr -d '\r')
echo "cf-ray: ${cf_ray}"

# Extract PoP code (last 3 chars before optional suffix)
pop=$(echo "${cf_ray}" | grep -oP '[A-Z]{3}$' || echo "${cf_ray}" | rev | cut -c1-3 | rev)
echo "Serving PoP: ${pop}"

# Look up PoP location
echo "Visit https://www.cloudflare.com/network/ to find ${pop}"
```

### Lab 6: Simulate Multi-Region Impact

```bash
# Use different DNS resolvers to simulate requests from different regions
# (This changes which PoP serves you based on DNS-based routing)

# Standard request (your local PoP)
echo "Local PoP:"
curl -sI https://macksportreport.com/favicon.ico | grep -i "cf-ray\|cf-cache\|age"

# Force a specific resolver (simulates DNS-based PoP selection)
# Note: This won't change the actual serving PoP in all cases
# but demonstrates the concept
echo ""
echo "Via Google DNS:"
curl -sI --dns-servers 8.8.8.8 https://macksportreport.com/favicon.ico 2>/dev/null | \
  grep -i "cf-ray\|cf-cache\|age" || \
  echo "(--dns-servers may not be available on all curl builds)"
```

### Lab 7: Benchmark Cache Hit Ratio Before/After

```bash
# Benchmark script: measure hit ratio across 20 requests
echo "=== Cache Hit Ratio Test ==="
total=0
hits=0

for i in {1..20}; do
  status=$(curl -sI https://macksportreport.com/favicon.ico | grep -i cf-cache-status | awk '{print $2}' | tr -d '\r')
  total=$((total + 1))
  if [ "$status" = "HIT" ]; then
    hits=$((hits + 1))
  fi
  echo "Request ${i}: ${status}"
done

echo ""
echo "Total: ${total}, Hits: ${hits}, Hit Rate: $(( hits * 100 / total ))%"
```

### Lab 8: Check Argo Status

```bash
# Check if Argo Smart Routing is enabled
curl -s "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/argo/smart_routing" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '{
    argo_status: .result.value,
    modified: .result.modified_on
  }'
```

### Lab 9: Enable Argo (if budget allows — billed per GB)

```bash
# WARNING: Argo has per-GB billing. Verify cost before enabling.
# Enable Argo Smart Routing
curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/argo/smart_routing" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq '{
    success: .success,
    status: .result.value
  }'
```

### Lab 10: Terraform Configuration for Tiered Cache

```hcl
# terraform/main.tf

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cf_api_token
}

variable "cf_api_token" {}
variable "zone_id" {}

resource "cloudflare_tiered_cache" "macksportreport" {
  zone_id    = var.zone_id
  cache_type = "smart"
}

# Optional: Argo Smart Routing
resource "cloudflare_argo" "macksportreport" {
  zone_id       = var.zone_id
  tiered_caching = "on"
  smart_routing  = "on"
}
```

```bash
# Apply
terraform init
terraform plan -var="zone_id=${CF_ZONE_ID}" -var="cf_api_token=${CF_API_TOKEN}"
terraform apply -var="zone_id=${CF_ZONE_ID}" -var="cf_api_token=${CF_API_TOKEN}"
```

---

## Demo Script (2 Minutes)

**Audience:** CTO or VP Engineering at a high-traffic media company
**Setup:** Cloudflare Analytics open showing cache statistics, terminal ready

---

**[0:00]** "Your site is getting global traffic. Let me show you why your origin is still seeing too many requests even with caching enabled."

*[Show cache status chart: 70% HIT, 30% MISS]*

**[0:15]** "70% hit rate is decent, but look at what's causing the 30% MISS. Each of your 330 Cloudflare PoPs independently caches content. When any of them hasn't seen a URL before, they all go to your origin."

**[0:30]** "Tiered Cache creates a two-level hierarchy. Lower-tier edge nodes check an upper-tier hub before touching your origin. Watch what happens when I turn it on..."

```bash
# Show before state
curl -s "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/argo/tiered_caching" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.result.value'
# "off"

# Enable
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/argo/tiered_caching" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq '.success'
# true
```

**[1:00]** "Done. No code changes, no deployment. Just one API call. Within 24-48 hours as your traffic patterns establish, you'll see that 30% MISS drop to under 10%."

**[1:20]** "The math: if your origin handles 1 million requests today, Tiered Cache typically reduces that to 50-100k. That's a 90-95% reduction in origin compute, database queries, and bandwidth costs. For a news site running viral articles, that's the difference between staying online and going down."

**[1:50]** "Add Argo Smart Routing on top of this, and the 5% of requests that do reach your origin travel over Cloudflare's optimized backbone — typically 30-50% faster than the public internet. Two features, massive impact."

---

## Competitive Context

| Feature | Cloudflare Tiered Cache | AWS CloudFront Origin Shield | Fastly Shielding | Akamai SureRoute |
|---------|------------------------|------------------------------|------------------|------------------|
| Concept | Hierarchical PoP tiers | Single shield PoP | Single shield PoP | Multi-tier CDN |
| Topology options | Generic, Smart (auto), Custom | Single designated shield | Single shield location | Complex config |
| Auto-optimization | ✅ Smart Topology | ❌ Manual selection | ❌ Manual selection | Partial |
| Tier count | 2 (edge → upper → origin) | 2 (edge → shield → origin) | 2 | 3 |
| Upper tier count | Multiple (regional hubs) | 1 (single shield) | 1 per config | Multiple |
| Availability | Business+; add-on Free/Pro | $0.0075–0.0200/10k requests | Free with Fastly | Enterprise |
| Smart Routing integration | ✅ Argo (per-GB billing) | ✅ CloudFront backbone | ❌ No private backbone | ✅ SureRoute |
| Purge behavior | Tiered propagation | Shield absorbs stampede | Shield absorbs | Similar |
| Cache analytics | ✅ Hit/miss by status | ✅ CloudFront metrics | ✅ Fastly logs | ✅ |
| Origin offload improvement | 90-99% typical | 60-80% typical | 70-85% typical | Variable |

**Cloudflare differentiator:** Smart Tiered Cache Topology is unique — Cloudflare automatically determines the optimal upper tier PoP per zone based on real traffic patterns. AWS CloudFront Origin Shield requires manual selection of a single shield region, which may not be optimal for globally distributed traffic. Cloudflare's Smart Topology means a site with heavy US + European traffic gets a US upper tier for US traffic and a European upper tier for European traffic simultaneously.

---

## Self-Check Questions

**Q1.** Without Tiered Cache, a viral article generates 1,000 requests per second globally across 100 active PoPs. Each PoP has a 60% hit rate. How many origin requests per second does your server see? Show your calculation. Now recalculate with Tiered Cache enabled, assuming 10 upper tiers each with 80% hit rate.

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q2.** You notice that after enabling Tiered Cache, your `cf-cache-status: MISS` values didn't go down as much as expected for the first 24 hours. After 72 hours, the MISS rate is much lower. Explain why the improvement took time to materialize.

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q3.** A customer objects: "Tiered Cache adds another network hop — won't that make my response times worse?" How do you respond? Under what circumstances (if any) would Tiered Cache actually increase latency?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q4.** Explain the relationship between Tiered Cache and Purge Everything. If you run a Purge Everything, does it propagate through the upper tiers or does it only clear lower-tier PoPs? What does this mean for the origin traffic spike after a full purge?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q5.** Your origin is in a single AWS us-east-1 region. macksportreport.com gets 40% of traffic from the US, 35% from Europe, and 25% from Asia-Pacific. How would Smart Tiered Cache Topology optimize the upper tier selection for each of these three traffic regions? What is the business impact on origin latency for European users compared to using a single Generic Global upper tier in Ashburn, VA?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

---

## Sources

- [Tiered Cache — Overview](https://developers.cloudflare.com/cache/how-to/tiered-cache/)
- [Tiered Cache — Enable via Dashboard](https://developers.cloudflare.com/cache/how-to/tiered-cache/#enable-tiered-cache)
- [Smart Tiered Cache Topology Optimization](https://developers.cloudflare.com/cache/how-to/tiered-cache/#smart-tiered-cache-topology)
- [Argo Smart Routing](https://developers.cloudflare.com/argo-smart-routing/)
- [Cloudflare API — Tiered Caching](https://developers.cloudflare.com/api/resources/argo/subresources/tiered_caching/)
- [Cloudflare API — Argo Smart Routing](https://developers.cloudflare.com/api/resources/argo/subresources/smart_routing/)
- [Cloudflare Network Map](https://www.cloudflare.com/network/)
- [Cache Analytics](https://developers.cloudflare.com/cache/performance-tools/cache-analytics/)
- [Terraform Cloudflare Provider — cloudflare_tiered_cache](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/tiered_cache)
