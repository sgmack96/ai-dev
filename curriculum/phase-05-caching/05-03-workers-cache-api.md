# Module 5.3 — Workers Routes & Cache API
> Dashboard Location: macksportreport.com → Workers & Pages → Overview
> Estimated Time: 120 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### Where Workers Fit in the Caching Stack

Cloudflare Workers sit at the edge, executing JavaScript **before and after** the cache layer depending on configuration. Understanding this positioning is critical for building correct caching strategies.

```
Internet → Cloudflare Edge → [Worker (optional)] → Cache Layer → Origin
```

More precisely:

```
Request → Worker intercepts (fetch event)
             ↓
        Worker checks cache (cache.match)
             ↓ MISS
        Worker fetches origin (fetch(request))
             ↓
        Worker stores response (cache.put)
             ↓
        Worker returns response to client
```

Workers give you **programmatic control** over caching that declarative Cache Rules cannot provide. Cache Rules are "if this URL matches, apply these settings." Workers are "run this code for every request."

### When to Use Workers Cache vs Cache Rules

| Scenario | Use Cache Rules | Use Workers |
|----------|----------------|-------------|
| Standard TTL overrides | ✅ | Overkill |
| HTML caching for static pages | ✅ | Overkill |
| Query string normalization | ✅ | Overkill |
| Cache based on API response body | ❌ | ✅ |
| Custom cache key logic (session-aware) | Partially | ✅ Full control |
| Transform response before caching | ❌ | ✅ |
| Cache different origins under one domain | ❌ | ✅ |
| A/B testing with cache isolation | ❌ | ✅ |
| Conditional caching based on response headers | ❌ | ✅ |
| Programmatic cache invalidation from Worker | ❌ | ✅ |

---

## Deep Dive (Architect-Level)

### Workers Routes

Workers Routes define which URL patterns cause a Worker script to execute. Routes are pattern-matched strings.

**Route format:**
```
macksportreport.com/*           # All paths on root domain
api.macksportreport.com/*       # All paths on api subdomain  
macksportreport.com/articles/*  # Only /articles/ path tree
*.macksportreport.com/*         # All subdomains, all paths
```

**Route matching rules:**
- `*` matches zero or more characters (including slashes in path)
- No regex support in traditional routes
- For regex, use Worker `fetch` handler with `new URL(request.url)` parsing

**Routes vs Workers Modules:**

| | Service Workers (routes-based) | ES Modules (workers.dev / Pages) |
|-|-------------------------------|----------------------------------|
| Export style | `addEventListener('fetch', handler)` | `export default { fetch(req, env, ctx) }` |
| Bindings access | Global `env` N/A | Via `env` parameter |
| Durable Objects | Requires module format | Native |
| Subrequests | `fetch()` global | `fetch()` global |
| Recommendation | Legacy | ✅ Modern standard |

**Modern ES Module Worker format (always use this):**
```javascript
export default {
  async fetch(request, env, ctx) {
    // request = incoming Request object
    // env = bindings (KV, D1, R2, secrets, etc.)
    // ctx = ExecutionContext (waitUntil, passThroughOnException)
    return new Response("Hello World");
  }
}
```

---

### The Cache API

The Cache API in Workers is an implementation of the [Web Cache API specification](https://w3c.github.io/ServiceWorker/#cache-objects), adapted for the Cloudflare edge environment.

#### caches.default

```javascript
const cache = caches.default;
```

This is the **zone-level shared cache** — the same cache that Cache Rules write to. If you `cache.put` a response in a Worker, it can later be served as a cache HIT by the standard Cloudflare caching layer for subsequent requests that don't go through the Worker.

#### cache.match(request)

```javascript
const response = await cache.match(request);
// Returns: Response | undefined
// undefined = cache miss
```

Performs a cache lookup using the request's URL as the cache key. Returns the cached Response if found, undefined if not.

**Important:** `cache.match` checks the cache for the **exact request URL** by default. If you need a custom cache key, create a new Request object with the desired URL.

```javascript
// Custom cache key example
const cacheKey = new Request(`https://macksportreport.com/__cache/${customKey}`, {
  method: 'GET'
});
const cached = await cache.match(cacheKey);
```

#### cache.put(request, response)

```javascript
await cache.put(request, response);
// Returns: Promise<void>
// Throws: if response has Cache-Control: no-store
```

Stores a response in the cache associated with the request URL.

**Critical restrictions:**
1. The response **must** have a `Cache-Control` header that allows caching (not `no-store`)
2. The URL **must** be on the same zone (same hostname)
3. The response body is consumed — you must clone before putting if you also need to return it

```javascript
// WRONG — body is consumed
await cache.put(request, response);
return response; // Error: body already consumed

// CORRECT — clone before putting
const responseToCache = response.clone();
ctx.waitUntil(cache.put(request, responseToCache));
return response; // Original response returned to client
```

#### cache.delete(request)

```javascript
const deleted = await cache.delete(request);
// Returns: true if deleted, false if not found
```

Removes a single cached entry by request URL. This is a **programmatic single-URL purge** from within a Worker.

**Use case:** When a Worker handles a webhook from a CMS, it can immediately purge the cached version of the updated page.

#### cache.open(cacheName)

```javascript
const namedCache = await caches.open('sports-api-v2');
await namedCache.put(request, response);
```

Creates a **named, isolated cache** separate from `caches.default`. Named caches are useful when you need:
- Different TTL management per cache namespace
- Bulk invalidation of a named cache
- Isolation between different Worker use cases

**Note:** Named caches are Worker-specific. The standard Cloudflare edge cache won't check named caches — only the default cache.

---

### Complete Cache-First Worker Pattern

This is the canonical pattern for implementing programmatic caching in Workers:

```javascript
export default {
  async fetch(request, env, ctx) {
    // Step 1: Only cache GET requests
    if (request.method !== 'GET') {
      return fetch(request);
    }

    // Step 2: Check the cache
    const cache = caches.default;
    let response = await cache.match(request);

    if (response) {
      // Cache HIT — add custom header for debugging
      const headers = new Headers(response.headers);
      headers.set('X-Worker-Cache', 'HIT');
      return new Response(response.body, {
        status: response.status,
        headers
      });
    }

    // Cache MISS — fetch from origin
    response = await fetch(request);

    // Step 3: Only cache successful responses
    if (response.status === 200) {
      // Clone the response — body can only be read once
      const responseToCache = response.clone();

      // Step 4: Add cache headers to control TTL
      const cacheHeaders = new Headers(responseToCache.headers);
      cacheHeaders.set('Cache-Control', 'public, max-age=3600');

      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        headers: cacheHeaders
      });

      // Step 5: Store in cache asynchronously (don't block the response)
      ctx.waitUntil(cache.put(request, cachedResponse));
    }

    // Return original response with custom header
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('X-Worker-Cache', 'MISS');
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  }
}
```

**Why `ctx.waitUntil()`?** This tells the Worker runtime: "keep this Worker alive until this promise resolves, even after the response has been sent." Without it, the `cache.put` might be killed before completing.

---

### Custom Cache Keys via Workers

Workers can implement arbitrary cache key logic that is impossible in declarative Cache Rules:

#### Cache by Country

```javascript
export default {
  async fetch(request, env, ctx) {
    const country = request.cf?.country || 'US';
    const url = new URL(request.url);
    
    // Create a cache key that includes the user's country
    const cacheKey = new Request(
      `${url.origin}${url.pathname}?__country=${country}`,
      { method: 'GET' }
    );

    const cache = caches.default;
    let response = await cache.match(cacheKey);

    if (response) return response;

    response = await fetch(request);
    const responseToCache = response.clone();
    
    const cacheResponse = new Response(responseToCache.body, {
      headers: { 'Cache-Control': 'public, max-age=3600' }
    });
    ctx.waitUntil(cache.put(cacheKey, cacheResponse));
    
    return response;
  }
}
```

#### Cache by Subscription Tier

```javascript
function getSubscriptionTier(request) {
  const cookie = request.headers.get('Cookie') || '';
  const tierMatch = cookie.match(/subscription_tier=(\w+)/);
  return tierMatch ? tierMatch[1] : 'free';
}

export default {
  async fetch(request, env, ctx) {
    const tier = getSubscriptionTier(request);
    const url = new URL(request.url);
    
    // Different cache namespace per tier
    const cacheKey = new Request(
      `${url.origin}${url.pathname}?__tier=${tier}`,
      { method: 'GET' }
    );

    const cache = caches.default;
    let response = await cache.match(cacheKey);
    if (response) return response;

    // Inject tier header so origin knows what to serve
    const originRequest = new Request(request.url, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers),
        'X-Subscription-Tier': tier
      }
    });

    response = await fetch(originRequest);
    const responseToCache = response.clone();
    ctx.waitUntil(cache.put(cacheKey, new Response(responseToCache.body, {
      headers: { 'Cache-Control': 'public, max-age=1800' }
    })));
    
    return response;
  }
}
```

#### Cache API Response with Computed TTL

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Dynamic TTL based on path
    const getTTL = (path) => {
      if (path.startsWith('/breaking-news/')) return 60;     // 1 minute
      if (path.startsWith('/articles/')) return 3600;         // 1 hour  
      if (path.startsWith('/standings/')) return 300;         // 5 minutes
      if (path.startsWith('/schedule/')) return 86400;        // 24 hours
      return 3600; // default 1 hour
    };

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    
    if (response.ok) {
      const ttl = getTTL(url.pathname);
      const responseToCache = new Response(response.clone().body, {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers),
          'Cache-Control': `public, max-age=${ttl}`,
          'X-Cache-TTL': String(ttl)
        }
      });
      ctx.waitUntil(cache.put(request, responseToCache));
    }

    return response;
  }
}
```

---

### Programmatic Cache Invalidation from Workers

Workers can delete cache entries based on business logic:

```javascript
// Example: CMS webhook handler
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'POST' && new URL(request.url).pathname === '/webhook/content-update') {
      const body = await request.json();
      const { articleSlug, action } = body;

      if (action === 'published' || action === 'updated') {
        // Purge specific cached URLs
        const cache = caches.default;
        const urlsToPurge = [
          `https://macksportreport.com/articles/${articleSlug}`,
          `https://macksportreport.com/articles/${articleSlug}?utm_source=twitter`,
          `https://macksportreport.com/`  // Homepage may show latest articles
        ];

        await Promise.all(
          urlsToPurge.map(url => cache.delete(new Request(url)))
        );

        return new Response(JSON.stringify({ purged: urlsToPurge }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response('No action taken', { status: 200 });
    }

    // Regular request handling
    return fetch(request);
  }
}
```

---

### wrangler.toml Configuration

```toml
name = "macksportreport-cache-worker"
main = "src/index.js"
compatibility_date = "2024-01-01"

# Route configuration
[[routes]]
pattern = "macksportreport.com/*"
zone_name = "macksportreport.com"

# KV namespace for metadata (optional)
[[kv_namespaces]]
binding = "CACHE_META"
id = "your_kv_namespace_id"

# Environment variables
[vars]
ENVIRONMENT = "production"
```

---

## Dashboard Walkthrough

### Step 1: Access Workers Overview
1. Cloudflare Dashboard → **macksportreport.com**
2. Left sidebar → **Workers & Pages**
3. Click **Create** → **Create Worker**

### Step 2: Deploy with Wrangler CLI
```bash
npm create cloudflare@latest my-cache-worker
cd my-cache-worker
# Edit src/index.js with your Worker code
npx wrangler deploy
```

### Step 3: Add Routes
1. In Workers overview, click your worker name
2. **Settings** tab → **Triggers** → **Routes**
3. Click **Add Route**
4. Enter: `macksportreport.com/*`
5. Select zone: `macksportreport.com`

### Step 4: Monitor Worker Invocations
1. Worker detail page → **Metrics** tab
2. See: Requests, Errors, CPU Time, Duration
3. **Logs** tab for real-time log streaming (requires Workers Logs enabled)

---

## Hands-On Lab

### Lab 1: Deploy a Basic Cache Worker

```bash
# Initialize a new Worker project
npm create cloudflare@latest cache-worker -- --type=hello-world
cd cache-worker
```

Create `src/index.js`:
```javascript
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET') return fetch(request);

    const cache = caches.default;
    
    // Check cache
    const cached = await cache.match(request);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Cache-Source', 'worker-cache');
      return new Response(cached.body, { status: cached.status, headers });
    }

    // Fetch from origin
    const response = await fetch(request);

    // Cache successful responses
    if (response.status === 200) {
      const responseToCache = new Response(response.clone().body, {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers),
          'Cache-Control': 'public, max-age=3600'
        }
      });
      ctx.waitUntil(cache.put(request, responseToCache));
    }

    return response;
  }
};
```

```bash
# Deploy
npx wrangler deploy

# Test
curl -sI https://your-worker.workers.dev/ | grep -i "x-cache-source\|cf-cache"
```

### Lab 2: Test Cache Hit/Miss Cycle

```bash
# Add X-Cache-Source header inspection
# First request — should be a MISS (no X-Cache-Source header)
curl -sI https://macksportreport.com/ | grep -i "x-cache\|cf-cache"

# Second request — should show X-Cache-Source: worker-cache
curl -sI https://macksportreport.com/ | grep -i "x-cache\|cf-cache"
```

### Lab 3: Named Cache Test

```javascript
// src/index.js — using named cache
export default {
  async fetch(request, env, ctx) {
    // Use a versioned cache name for easy bulk invalidation
    const cache = await caches.open('macksports-v1');
    
    const cached = await cache.match(request);
    if (cached) return cached;
    
    const response = await fetch(request);
    const responseToCache = new Response(response.clone().body, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        'Cache-Control': 'public, max-age=600'
      }
    });
    ctx.waitUntil(cache.put(request, responseToCache));
    return response;
  }
};
```

### Lab 4: Cache Purge Worker

```bash
# Test the programmatic delete via a dedicated purge endpoint
curl -X POST https://macksportreport.com/worker/purge \
  -H "Content-Type: application/json" \
  -d '{"url": "https://macksportreport.com/articles/test-article"}'
```

Worker code for purge endpoint:
```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/worker/purge' && request.method === 'POST') {
      const { url: targetUrl } = await request.json();
      const cache = caches.default;
      const deleted = await cache.delete(new Request(targetUrl));
      return new Response(JSON.stringify({ deleted, url: targetUrl }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Normal caching logic
    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;
    return fetch(request);
  }
};
```

### Lab 5: Measure Performance Improvement

```bash
# Benchmark without Worker caching (direct origin)
time curl -s https://macksportreport.com/articles/ > /dev/null

# Benchmark with Worker cache (after initial MISS)
# Run twice: first warms the cache, second measures cached performance
time curl -s https://macksportreport.com/articles/ > /dev/null
time curl -s https://macksportreport.com/articles/ > /dev/null

# For more accurate benchmarking
ab -n 100 -c 10 https://macksportreport.com/articles/
```

### Lab 6: Debug Worker Execution with Wrangler Tail

```bash
# Stream real-time Worker logs
npx wrangler tail cache-worker --format pretty

# In another terminal, make requests
curl -sI https://macksportreport.com/articles/

# Watch the Worker log output in real time
```

---

## Demo Script (2 Minutes)

**Audience:** Developer audience — startup engineering team
**Setup:** VS Code with Worker code, terminal, Cloudflare dashboard

---

**[0:00]** "Let me show you how to implement programmatic caching that goes beyond what you can configure in a UI. Workers give you full control over every request."

```javascript
// Show this code in VS Code
const cached = await cache.match(request);
if (cached) return cached;
// 5 lines of JavaScript = custom CDN logic
```

**[0:20]** "This runs in V8 at our edge — 330+ locations globally. The `cache.match` call checks the zone's cache. If it's there, we return it without ever touching your server."

**[0:40]** "Let me deploy this live..."

```bash
npx wrangler deploy
# [shows deployment succeeding]
```

**[0:55]** "Now watch what happens to your response times..."

```bash
# First request: MISS
time curl -s https://macksportreport.com/ > /dev/null
# real 0m0.234s  ← origin latency

# Second request: HIT from Worker cache
time curl -s https://macksportreport.com/ > /dev/null
# real 0m0.008s  ← edge cache, 30x faster
```

**[1:20]** "That's 30x faster on the second request. Your origin handled exactly one request. The Worker handled the rest."

**[1:35]** "The real power is when you need logic. Cache by user tier, by country, by A/B test group — things you can't do in a config file. It's just JavaScript."

---

## Competitive Context

| Feature | Cloudflare Workers Cache API | AWS Lambda@Edge + CloudFront | Fastly Compute@Edge | Vercel Edge Functions |
|---------|------------------------------|------------------------------|---------------------|----------------------|
| Cache API access | ✅ `caches.default` (zone cache) | ❌ Must write to S3/DAX | ✅ Similar Cache API | ❌ Limited |
| Execution location | 330+ PoPs | ~4 CloudFront locations | 75+ PoPs | ~30 regions |
| Cold start | 0ms (V8 isolates) | ~100ms (Lambda) | 0ms (Wasm) | ~50ms (V8) |
| Cache put/get latency | <1ms | N/A (S3 = 5-30ms) | <1ms | N/A |
| Custom cache keys | Full JS control | Limited via headers | Full control | No |
| Named caches | ✅ `caches.open()` | ❌ Not native | ✅ | ❌ |
| Programmatic purge | ✅ `cache.delete()` | CloudFront Invalidation API | ✅ Purge API | Deployment-based |
| Free tier | 100k req/day | 1M req/month | 50k req/month | Limited |
| Language | JS/TS/Wasm | JS/TS | JS/TS/Rust/Go/Wasm | JS/TS |
| Integration with zone cache | Seamless | Separate service | Seamless | Separate |

**Key differentiator:** Workers Cache API writes directly to the same cache that serves all non-Worker Cloudflare traffic. A Worker `cache.put` is equivalent to a cache MISS → HIT transition in the normal Cloudflare caching layer. AWS Lambda@Edge operates outside CloudFront's native cache — you'd need to write to S3 or ElastiCache separately.

---

## Self-Check Questions

**Q1.** You write a Worker that calls `cache.put(request, response)` without cloning the response, then immediately `return response`. What error will you encounter and why? Write the corrected code.

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q2.** What is the difference between `caches.default` and `await caches.open('my-cache')`? If a Worker stores a response in a named cache, will subsequent non-Worker requests (matching a Cache Rule) find and serve that cached response?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q3.** Why is `ctx.waitUntil(cache.put(request, response))` preferred over `await cache.put(request, response)` when the goal is to not block the response to the user?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q4.** You want to cache `/articles/*` differently for premium vs free users based on a cookie called `tier`. Write the pseudocode for how you would construct the cache key so that free and premium users get separate cache entries.

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

**Q5.** A developer says "Workers cold starts will make our p99 latency worse." How do you respond? What is the actual execution model of Workers, and why is this objection incorrect?

```
Answer:
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
```

---

## Sources

- [Workers Cache API Documentation](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Workers ES Modules Format](https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/)
- [ExecutionContext — waitUntil](https://developers.cloudflare.com/workers/runtime-apis/context/)
- [wrangler.toml Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Workers Runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/)
- [Web Cache API Spec (W3C)](https://w3c.github.io/ServiceWorker/#cache-objects)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
