# Module 6.6 — Snippets
> **Dashboard Location:** macksportreport.com → Rules → Snippets
> **Estimated Time:** 60 minutes
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Are Snippets?

Cloudflare Snippets are **lightweight JavaScript programs** that run at the Cloudflare edge for specific matching requests. They sit between the declarative rules system (Transform Rules, Configuration Rules) and the full power of Cloudflare Workers — they're designed for common use cases that need a bit of code but don't warrant a full Worker deployment.

Think of Snippets as the answer to: "I need to do something a Transform Rule can't express, but I don't want to deal with the Wrangler CLI and a full Workers project to add a security header."

### The Positioning in the Cloudflare Ecosystem

```
Transform Rules          → No code, declarative
    ↓
Snippets                 → Lightweight JavaScript, dashboard-only
    ↓
Workers (with Hono/etc.) → Full JavaScript, external deploys, bindings, KV, etc.
```

**Snippets are the middle tier.** They give you JavaScript's expressiveness for logic that can't be captured in a conditional expression, without the operational overhead of deploying and managing a full Worker.

### When Snippets Make Sense

Use Snippets when:
- You need conditional logic more complex than boolean expressions allow
- You need to perform string manipulation that expression functions don't cover
- You want to run simple A/B test logic at the edge
- You need to set headers based on more than just static values or field references
- You want to modify response body in a limited way (e.g., inject a small script tag)

Don't use Snippets when:
- You need to make external HTTP fetch requests (use Workers)
- You need KV, D1, R2, or any bindings (use Workers)
- You need durable persistent state (use Durable Objects)
- Your logic is more than ~50 lines of JavaScript (maintainability argument — use Workers)
- You need npm packages (use Workers with bundling)

### Current Status (2026)

Snippets are generally available on paid plans. They are included in the plan cost — there's no additional per-invocation billing like full Workers (beyond the normal request cost). This makes Snippets economically attractive for simple transformations that would otherwise require a Worker.

---

## Deep Dive (Architect-Level)

### The Snippets Runtime Model

Snippets run inside the same V8 isolate environment as Workers, with these constraints:

- **No `fetch()` calls to external services** — you cannot make outbound HTTP requests
- **No Cloudflare bindings** — no KV, no R2, no D1, no Durable Objects, no AI
- **No long-running async operations** — strictly synchronous processing of request/response
- **No npm packages** — your code must be self-contained
- **Size limit:** ~32KB of JavaScript (unminified)
- **CPU time limit:** Strict execution time budget (similar to Workers' CPU time limit)

Despite these constraints, the Snippets runtime gives you:
- Full access to the `Request` and `Response` Web API
- Access to request headers, URL, method, body (with caveats on body reading)
- Ability to construct new `Response` objects
- Access to `ctx.next()` — call the next handler in the chain (origin or next rule)

### The Snippet Interface

Every Snippet must export a default object with a `fetch` handler:

```javascript
export default {
  async fetch(request, ctx) {
    // Modify the request BEFORE passing to origin
    const modifiedRequest = new Request(request, {
      headers: {
        ...Object.fromEntries(request.headers.entries()),
        "X-Custom-Header": "value"
      }
    });

    // Call ctx.next() to continue to origin
    const response = await ctx.next(modifiedRequest);

    // Modify the RESPONSE before returning to user
    const newResponse = new Response(response.body, response);
    newResponse.headers.set("X-Frame-Options", "SAMEORIGIN");
    newResponse.headers.delete("X-Powered-By");

    return newResponse;
  }
}
```

**`ctx.next(request?)`** — this is the key function. It forwards the request to the next step in the chain (origin, another rule, etc.) and returns the response. You can:
- Pass `ctx.next()` with no args to forward unchanged
- Pass `ctx.next(modifiedRequest)` to forward with request modifications
- Return a `Response` directly without calling `ctx.next()` to short-circuit (return early)

### Example: Security Headers (Comprehensive)

```javascript
export default {
  async fetch(request, ctx) {
    const response = await ctx.next();

    // Clone headers to make them mutable
    const headers = new Headers(response.headers);

    // Prevent clickjacking
    headers.set("X-Frame-Options", "SAMEORIGIN");

    // Prevent MIME sniffing
    headers.set("X-Content-Type-Options", "nosniff");

    // Referrer policy
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    // Permissions policy (camera, mic, geolocation all denied)
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    // Remove potentially dangerous headers
    headers.delete("X-Powered-By");
    headers.delete("Server");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
}
```

### Example: Simple A/B Test Logic

```javascript
export default {
  async fetch(request, ctx) {
    const url = new URL(request.url);

    // Only run A/B test on homepage
    if (url.pathname !== "/") {
      return ctx.next();
    }

    // Check if user already has a variant assigned (via cookie)
    const cookie = request.headers.get("Cookie") || "";
    const existingVariant = cookie.match(/ab_variant=(a|b)/)?.[1];

    let variant = existingVariant;

    // Randomly assign new visitors
    if (!variant) {
      variant = Math.random() < 0.5 ? "a" : "b";
    }

    // Route to different path based on variant
    const targetUrl = variant === "b"
      ? new URL("/homepage-v2", request.url)
      : new URL("/", request.url);

    const modifiedRequest = new Request(targetUrl.toString(), request);
    const response = await ctx.next(modifiedRequest);

    // Set variant cookie if new assignment
    if (!existingVariant) {
      const newHeaders = new Headers(response.headers);
      newHeaders.append("Set-Cookie",
        `ab_variant=${variant}; Path=/; Max-Age=2592000; SameSite=Lax`);
      return new Response(response.body, { ...response, headers: newHeaders });
    }

    return response;
  }
}
```

### Example: Add Bot Score Header to Request

```javascript
export default {
  async fetch(request, ctx) {
    // Cloudflare provides bot score via request.cf object
    const botScore = request.cf?.botManagement?.score ?? 100;
    const isBotLikely = botScore < 30;

    const newRequest = new Request(request, {
      headers: {
        ...Object.fromEntries(request.headers.entries()),
        "X-Bot-Score": String(botScore),
        "X-Bot-Likely": isBotLikely ? "true" : "false"
      }
    });

    return ctx.next(newRequest);
  }
}
```

Note: The `request.cf` object in Snippets provides access to Cloudflare's request metadata — country, city, ASN, bot management data, etc.

### Example: Early Return (Block Without WAF Rule)

```javascript
export default {
  async fetch(request, ctx) {
    const userAgent = request.headers.get("User-Agent") || "";

    // Block specific scrapers not caught by WAF
    const blockedAgents = [
      "DatadogScraper",
      "CustomHarvester/1.0",
      "PriceSpider"
    ];

    const isBlocked = blockedAgents.some(agent => userAgent.includes(agent));

    if (isBlocked) {
      // Short-circuit — never calls ctx.next(), origin never hit
      return new Response("Access Denied", {
        status: 403,
        headers: { "Content-Type": "text/plain" }
      });
    }

    return ctx.next();
  }
}
```

### Snippets vs Transform Rules vs Workers: Decision Matrix

| Requirement | Transform Rule | Snippet | Worker |
|---|---|---|---|
| Add static header value | Yes | Yes | Overkill |
| Add header from request field (e.g., IP as header) | Yes | Yes | Overkill |
| Add header from conditional logic (if X then Y else Z) | Only if expressible | Yes | Yes |
| Read response body and make decision | No | No (body streaming) | Yes |
| External API call | No | No | Yes |
| Random assignment (A/B test) | No | Yes | Yes |
| Regex-based URL rewrite | Yes | Yes | Yes |
| Access KV store | No | No | Yes |
| Access D1 database | No | No | Yes |
| npm packages | No | No | Yes |
| CPU-intensive computation | No | No (time limits) | Yes (generous limits) |

### Snippet Match Conditions

Like other rules, Snippets fire based on a match condition using the Ruleset Engine expression language:

```
# Run on all requests
true

# Run only on specific path
starts_with(http.request.uri.path, "/api/")

# Run on specific content type responses
http.response.headers["Content-Type"][*] contains "text/html"

# Run for specific country
ip.src.country eq "US"
```

---

## Dashboard Walkthrough

### Step 1: Navigate to Snippets
1. macksportreport.com → **Rules** → **Snippets**
2. If this is your first Snippet, you'll see a "Create snippet" button and an empty state

### Step 2: Create a Security Headers Snippet
1. Click **Create snippet**
2. Name: "Security Headers"
3. Match: Choose **All incoming requests** (expression: `true`)
4. JavaScript editor opens with a template
5. Replace with the security headers example above
6. Click **Save and deploy**

### Step 3: Observe the Code Editor
- Syntax highlighting, basic autocompletion
- No file system — everything is in one inline JavaScript file
- No bundler, no imports from node_modules
- The editor shows a live character/line count

### Step 4: Test the Snippet
1. Open a new browser tab
2. Navigate to `https://macksportreport.com`
3. DevTools → Network → Select document
4. Response Headers: confirm `X-Frame-Options: SAMEORIGIN` and others are present
5. Confirm `X-Powered-By` is absent

### Step 5: View Snippet Analytics
1. Back in Snippets dashboard
2. Each snippet shows invocation count and error rate
3. This is the primary observability surface for Snippets (no native Logpush for Snippets yet)

---

## Hands-On Lab

### Lab 1: Write a Security Headers Snippet

Create a file locally to author and test the snippet code:

```bash
mkdir -p /Users/smack/ai-dev/curriculum/phase-06-rules/snippet-examples
cat > /Users/smack/ai-dev/curriculum/phase-06-rules/snippet-examples/security-headers.js << 'EOF'
export default {
  async fetch(request, ctx) {
    const response = await ctx.next();

    const headers = new Headers(response.headers);
    headers.set("X-Frame-Options", "SAMEORIGIN");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    headers.delete("X-Powered-By");
    headers.delete("Server");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
}
EOF
echo "Security headers snippet written"
```

### Lab 2: Deploy via Dashboard

1. Copy the content of `security-headers.js`
2. Paste into Snippets dashboard editor
3. Set name: "Security Headers Lab"
4. Match: `true` (all requests)
5. Save and deploy

### Lab 3: Verify Headers

```bash
# Confirm security headers are applied
curl -s -I https://macksportreport.com | grep -E "X-Frame|X-Content|Referrer|Permissions|X-Powered|Server:"

# Expected:
# X-Frame-Options: SAMEORIGIN
# X-Content-Type-Options: nosniff
# Referrer-Policy: strict-origin-when-cross-origin
# Permissions-Policy: camera=(), microphone=(), geolocation=()
# (X-Powered-By and Server should NOT appear)
```

### Lab 4: Write a Request Logging Snippet (Via Added Header)

Since Snippets can't call external APIs, use a custom header to "log" data to your origin for analysis:

```bash
cat > /Users/smack/ai-dev/curriculum/phase-06-rules/snippet-examples/request-context.js << 'EOF'
export default {
  async fetch(request, ctx) {
    const cf = request.cf || {};

    // Add context headers that your origin can log
    const contextHeaders = {
      "X-CF-Country": cf.country || "unknown",
      "X-CF-City": cf.city || "unknown",
      "X-CF-ASN": String(cf.asn || 0),
      "X-CF-Bot-Score": String(cf.botManagement?.score ?? 100),
      "X-CF-Colo": cf.colo || "unknown",
      "X-CF-Request-ID": crypto.randomUUID()
    };

    const newRequest = new Request(request, {
      headers: {
        ...Object.fromEntries(request.headers.entries()),
        ...contextHeaders
      }
    });

    return ctx.next(newRequest);
  }
}
EOF
echo "Request context snippet written"
```

### Lab 5: Test the A/B Logic Snippet Locally

While full testing requires deployment, verify your logic with a mental walkthrough:

```bash
cat > /Users/smack/ai-dev/curriculum/phase-06-rules/snippet-examples/ab-test.js << 'EOF'
export default {
  async fetch(request, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/") return ctx.next();

    const cookie = request.headers.get("Cookie") || "";
    const existingVariant = cookie.match(/ab_variant=(a|b)/)?.[1];
    const variant = existingVariant || (Math.random() < 0.5 ? "a" : "b");

    // Add variant to request header so origin knows
    const newRequest = new Request(request, {
      headers: {
        ...Object.fromEntries(request.headers.entries()),
        "X-AB-Variant": variant
      }
    });

    const response = await ctx.next(newRequest);

    if (!existingVariant) {
      const newHeaders = new Headers(response.headers);
      newHeaders.append("Set-Cookie",
        `ab_variant=${variant}; Path=/; Max-Age=2592000; SameSite=Lax`);
      return new Response(response.body, { ...response, headers: newHeaders });
    }

    return response;
  }
}
EOF
echo "A/B test snippet written"
```

---

## Demo Script (2 Minutes)

**Audience:** Startup CTO who uses Workers but wants simpler tooling for small tasks

---

*"You've got Workers deployed for your main application logic — that's the right tool for that. But every time you need to add a security header or change a request context variable, you're opening a repo, making a PR, waiting for CI, deploying. For something that's literally one line of code."*

[Navigate to macksportreport.com → Rules → Snippets]

*"Snippets are the middle ground. Same V8 runtime as Workers, but inline in the dashboard. No Wrangler, no deployment pipeline, no billing per invocation beyond what you're already paying."*

[Create a snippet with the security headers example]

*"I can add a comprehensive security header policy — X-Frame-Options, X-Content-Type-Options, Referrer-Policy, kill the Server header — in about 30 seconds. Match condition is `true` — every request gets this. Save and deploy."*

[Test in terminal]

```bash
curl -I https://macksportreport.com | grep -E "X-Frame|X-Content|Referrer"
```

*"Live in under a minute. And here's the key: Snippets can do conditional logic that Transform Rules can't express. Need to set a header based on a JavaScript calculation? A/B test routing? Custom cookie logic? That's where Snippets shine over declarative rules, without the full Worker overhead."*

---

## Competitive Context

| Feature | Cloudflare Snippets | Vercel Edge Middleware | Netlify Edge Functions | AWS CloudFront Functions |
|---|---|---|---|---|
| **Runtime** | V8 isolate (Workers runtime) | V8 isolate (Edge Runtime) | Deno | V8 isolate |
| **External fetches** | No | Yes | Yes | No |
| **KV/storage access** | No | Yes (Vercel KV) | Yes (Netlify Blob) | No |
| **Dashboard-only authoring** | Yes | No — git-based | No — git-based | Yes |
| **No CLI required** | Yes | No | No | Yes |
| **Binding to CDN rules/conditions** | Yes — Rules Engine integration | Limited | Limited | No |
| **Pricing** | Included in plan | Included (limits apply) | Included (limits apply) | $0.10/million invocations |
| **Code size limit** | ~32KB | 1MB | 20MB | 10KB |
| **Platform-agnostic** | Yes — any origin | Vercel-hosted only | Netlify-hosted only | CloudFront only |

**Key differentiator:** Cloudflare Snippets are **origin-agnostic** (works regardless of where your backend runs) and require **no external deployment tooling**. Vercel and Netlify equivalents only work for their hosted platforms. CloudFront Functions have severe size limits (10KB) and no fetch support — Snippets are more capable.

---

## Self-Check Questions

**Question 1:** A customer asks: "Can I use a Snippet to check a user's JWT token against my auth service before allowing them to hit my origin?" What's your answer, and what would you recommend instead?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 2:** Explain why calling `ctx.next()` is critical in most Snippets. What happens if you forget to call it and return a hardcoded `Response` object?

```
Your answer:
_______________________________________________
_______________________________________________
```

**Question 3:** A customer has both a Transform Rule adding `X-Frame-Options: SAMEORIGIN` and a Snippet that also sets `X-Frame-Options: DENY`. Both apply to the same request. Which value does the user receive? Why?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 4:** What is the `request.cf` object in a Snippet? List five properties available on it and a use case for each.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 5:** A customer wants to implement rate limiting logic using a counter stored in Cloudflare KV inside a Snippet. Is this possible? What's the right product to recommend for this use case?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

---

## Sources

- [Snippets Documentation](https://developers.cloudflare.com/rules/snippets/)
- [Snippets — Getting Started](https://developers.cloudflare.com/rules/snippets/get-started/)
- [Workers Runtime API — Request.cf](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties)
- [Workers Runtime API — Response](https://developers.cloudflare.com/workers/runtime-apis/response/)
- [Workers Runtime API — Headers](https://developers.cloudflare.com/workers/runtime-apis/headers/)
- [Snippets vs Workers vs Transform Rules](https://developers.cloudflare.com/rules/snippets/#snippets-vs-other-cloudflare-products)
