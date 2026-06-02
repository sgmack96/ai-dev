# Module 10.10 — Cloudflare Pages
> Dashboard Location: Account Home → Workers & Pages → Pages | Estimated Time: 75 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare Pages is a Jamstack deployment platform — connect your GitHub or GitLab repository, push code, and Pages automatically builds and deploys your site globally across Cloudflare's network. Every deployment is immediately available at a preview URL, and production deployments go live within seconds.

**What Jamstack means:** JavaScript, APIs, and Markup. The frontend is pre-rendered at build time (or server-rendered at the edge), served as static files or edge-rendered HTML, with dynamic functionality handled by APIs. No persistent server processes.

**Who Pages is for:**
- Frontend developers building React, Vue, Svelte, Angular, or any framework app
- Marketing teams with content sites built on Astro, Hugo, Jekyll, Eleventy
- Full-stack developers building on Next.js, Remix, SvelteKit, Nuxt with server-side rendering at the edge
- Any team that was on Vercel or Netlify and wants to consolidate on Cloudflare

**The pitch vs Vercel/Netlify:** Same developer experience, globally distributed on CF's network, and tighter integration with Workers, KV, D1, R2, and Queues. If you're already using Cloudflare for your DNS and security, Pages brings your frontend into the same platform.

---

## Deep Dive (Architect-Level)

### Build Pipeline

When you push to your connected repository:

1. **Webhook received:** GitHub/GitLab notifies Cloudflare of the push
2. **Build triggered:** Pages spins up a build environment (Ubuntu-based container)
3. **Framework detection:** Pages reads `package.json` or file structure to detect framework (Next.js, Astro, Hugo, etc.)
4. **Build command runs:** e.g., `npm run build` or `hugo`
5. **Output directory uploaded:** The `dist/` or `public/` directory is uploaded to Cloudflare's asset storage
6. **Global deployment:** Assets propagated to all CF PoPs
7. **Preview URL assigned:** Every commit gets `<hash>.pages.dev`
8. **Production alias updated:** If branch is `main`, `your-project.pages.dev` and custom domain update

Build times: typically 30 seconds to 3 minutes for most frameworks. Concurrent builds are supported on paid plans.

### Framework Support Matrix

| Framework | Build Command | Output Directory | SSR Support |
|---|---|---|---|
| Next.js | `next build` | `.next` | Yes (Pages Functions) |
| Astro | `astro build` | `dist` | Yes (SSR mode) |
| SvelteKit | `npm run build` | `build` | Yes (CF adapter) |
| Remix | `remix build` | `public/build` | Yes |
| Nuxt | `nuxt build` | `.output` | Yes |
| Vue (Vite) | `vite build` | `dist` | No (SPA) |
| React (CRA) | `react-scripts build` | `build` | No (SPA) |
| Hugo | `hugo` | `public` | No (static) |
| Jekyll | `jekyll build` | `_site` | No (static) |
| Gatsby | `gatsby build` | `public` | Partial |

### Pages Functions (Edge Computing)

Pages Functions are Workers that live inside your Pages project. They enable server-side logic without a separate Workers deployment:

- File-based routing: `functions/api/[slug].ts` → handles `/api/*`
- Access to all Workers bindings: KV, D1, R2, Queues, Durable Objects
- Middleware: `functions/_middleware.ts` runs on every request

```
my-pages-project/
├── public/                    # Static assets
│   └── index.html
├── functions/
│   ├── _middleware.ts         # Runs on all requests
│   ├── api/
│   │   ├── hello.ts           # /api/hello
│   │   └── [id].ts            # /api/:id (dynamic route)
│   └── blog/
│       └── [slug].ts          # /blog/:slug
└── package.json
```

### Deployment Environments

Pages supports two built-in environments:
- **Production:** Only `main` branch (or whichever branch you designate)
- **Preview:** All other branches and pull requests

Each environment can have its own:
- Environment variables (different API keys for preview vs production)
- KV namespaces, D1 databases, R2 buckets (use staging resources in preview)

### Headers and Redirects

`_headers` file controls response headers for static assets:
```
/api/*
  Access-Control-Allow-Origin: https://macksportreport.com

/static/*
  Cache-Control: public, max-age=31536000, immutable
```

`_redirects` file handles URL redirects:
```
/old-blog-post  /new-blog-post  301
/api/*          https://api.macksportreport.com/:splat  200
```

### Pages vs Workers — When to Use Each

| Scenario | Use Pages | Use Workers |
|---|---|---|
| Static site with some API routes | Yes | No |
| Full SPA with edge functions | Yes | No |
| Purely programmatic API | No | Yes |
| Git-based deployment workflow | Yes | No |
| Complex routing/middleware logic | No (use Workers) | Yes |
| Durable Objects (stateful) | No | Yes |
| Non-HTTP triggers (Cron, Queues) | No | Yes |

---

## Dashboard Walkthrough

**Step 1: Create a Pages Project**
1. Navigate to Account Home → Workers & Pages
2. Click "Create application" → "Pages" tab
3. Connect to Git (authorize GitHub/GitLab)
4. Select repository

**Step 2: Configure Build Settings**
1. Framework preset: select your framework
2. Build command: e.g., `npm run build`
3. Build output directory: e.g., `dist`
4. Environment variables: add `NODE_VERSION=20` if needed

**Step 3: Deploy and View Preview URL**
1. Click "Save and Deploy"
2. Watch build logs in real-time
3. On success: `https://your-project-hash.pages.dev`

**Step 4: Add a Custom Domain**
1. Project → Custom domains → Set up a custom domain
2. Enter: `app.macksportreport.com`
3. CF automatically adds CNAME (since zone is managed here)
4. HTTPS: automatic (CF certificate)

**Step 5: Configure Environment Variables**
1. Settings → Environment variables
2. Add Production variable: `API_URL=https://api.macksportreport.com`
3. Add Preview variable: `API_URL=https://staging-api.macksportreport.com`

**Step 6: Rollback a Deployment**
1. Deployments tab → find a previous deployment
2. "Rollback to this deployment" — instant, no rebuild needed

---

## Hands-On Lab

### Prerequisites
```bash
npm install -g wrangler
wrangler login
```

### Lab 1: Create and Deploy a Pages Project with Wrangler
```bash
# Create a simple static site
mkdir macksportreport-pages && cd macksportreport-pages

# Create a basic HTML page
mkdir public
cat > public/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head><title>Mack Sport Report</title></head>
<body>
  <h1>Mack Sport Report</h1>
  <p>Deployed on Cloudflare Pages.</p>
</body>
</html>
EOF

# Deploy directly (no git required for direct upload)
wrangler pages deploy public --project-name=macksportreport-pages
```

### Lab 2: Add a Pages Function
```bash
# Create functions directory
mkdir -p functions/api

# Create a simple API endpoint
cat > functions/api/sports.ts << 'EOF'
interface Env {}

export const onRequest: PagesFunction<Env> = async (context) => {
  const sports = [
    { id: 1, name: "Basketball", season: "Winter" },
    { id: 2, name: "Baseball", season: "Summer" },
    { id: 3, name: "Football", season: "Fall" }
  ];

  return Response.json({
    data: sports,
    timestamp: new Date().toISOString(),
    colo: context.request.cf?.colo
  });
};
EOF

# Deploy with functions
wrangler pages deploy public --project-name=macksportreport-pages

# Test the function
curl https://macksportreport-pages.pages.dev/api/sports
```

### Lab 3: Pages Function with D1 Binding
```typescript
// functions/api/articles/[id].ts
interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { id } = context.params;

  try {
    const article = await context.env.DB
      .prepare('SELECT * FROM articles WHERE id = ?')
      .bind(id)
      .first();

    if (!article) {
      return new Response('Not Found', { status: 404 });
    }

    return Response.json(article);
  } catch (error) {
    return new Response('Database error', { status: 500 });
  }
};
```

```toml
# wrangler.toml (for local dev with pages)
name = "macksportreport-pages"

[[d1_databases]]
binding = "DB"
database_name = "macksportreport-db"
database_id = "your-d1-database-id"
```

### Lab 4: Add Headers and Redirects
```bash
# Create _headers file
cat > public/_headers << 'EOF'
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/api/*
  Access-Control-Allow-Origin: https://macksportreport.com
  Cache-Control: no-cache

/static/*
  Cache-Control: public, max-age=31536000, immutable
EOF

# Create _redirects file
cat > public/_redirects << 'EOF'
/sports       /api/sports     200
/old-page     /new-page       301
EOF

wrangler pages deploy public --project-name=macksportreport-pages
```

### Lab 5: Local Development with Wrangler
```bash
# Start local Pages dev server
wrangler pages dev public --compatibility-date=2024-11-01

# With D1 local database
wrangler pages dev public --d1=DB=local-db

# Test locally
curl http://localhost:8788/api/sports
```

### Lab 6: Deploy Preview from a Branch (simulated)
```bash
# In a git-connected project, preview deployments happen automatically
# But you can also create a preview deployment via API:

curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/macksportreport-pages/deployments" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: multipart/form-data" \
  -F "branch=feature-new-ui"
```

---

## Demo Script (2 Minutes)

**Audience:** Frontend developer currently on Vercel or Netlify

**Opening (15 seconds):**
"If you're on Vercel, you already know the workflow — push to GitHub, deploy in 30 seconds. Pages is the same workflow, on Cloudflare's network, and if you're already using Cloudflare for security and DNS, everything is in one dashboard."

**Act 1 — Show deployment (40 seconds):**
"Watch this. [In the Pages dashboard] I connected GitHub 2 minutes ago. Every push to main deploys here [show production URL]. Every pull request gets its own preview URL. [Show a PR deployment] This one's from my feature branch — it's live right now, separate from production."

**Act 2 — Show Pages Functions (30 seconds):**
"The magic is here. [Open functions/ directory] I have a file at `functions/api/sports.ts`. That becomes `/api/sports` on my deployed URL. It has access to my D1 database, my KV store, my R2 bucket — all Cloudflare native. No separate API deployment."

**Act 3 — Show rollback (20 seconds):**
"Bad deployment? [Deployments tab] Click here. Rollback is instant — no rebuild. You're back to the last known-good state in seconds."

**Close (15 seconds):**
"The whole point is: your frontend, your API functions, your database, and your security are all in one platform. When something breaks, there's one dashboard, one support team, one bill."

---

## Competitive Context

| Feature | Cloudflare Pages | Vercel | Netlify | AWS Amplify |
|---|---|---|---|---|
| **Deploy from git** | Yes | Yes | Yes | Yes |
| **Framework detection** | Yes (20+ frameworks) | Yes (Next.js optimized) | Yes | Yes |
| **Edge functions** | Pages Functions (Workers) | Edge Functions (V8) | Edge Functions (Deno) | Lambda@Edge |
| **Free tier builds** | 500/month | 100/month (Hobby) | 500/month | 150 build mins |
| **Preview deployments** | Yes (unlimited) | Yes | Yes | Yes |
| **Custom domains** | Unlimited | Unlimited | Unlimited | Unlimited |
| **D1/KV/R2 native binding** | Yes | No | No | DynamoDB/S3 |
| **Bandwidth limit** | Unlimited (free) | 100 GB (free) | 100 GB (free) | Pay per GB |
| **Build time limit** | 20 min | 45 min | 15-30 min | 30 min |
| **Concurrent builds** | 1 (free), 5 (Pro) | Limited (free) | 1 (free), 3 (Pro) | 1 |
| **Analytics** | Built-in (CF Web Analytics) | Vercel Analytics ($) | Netlify Analytics ($) | CloudWatch |
| **Price (Pro)** | ~$20/month (Workers Paid) | $20/month | $19/month | Pay per use |

**Key differentiator:** Pages is the only Jamstack platform where your edge functions have zero-latency access to a relational database (D1), distributed KV store (KV), and object storage (R2) — all on the same global network, with no extra round-trip.

---

## Self-Check Questions

**Question 1:** A developer asks: "What's the difference between a Pages Function and a Worker?" Give a complete technical explanation of when to choose each.

```
Your answer:




```

**Question 2:** A team deploys a Next.js app to Pages. They want different environment variables for production vs their feature branch preview deployments. How does Pages handle this?

```
Your answer:




```

**Question 3:** A company runs their frontend on Vercel. Their biggest pain point is that Vercel charges for bandwidth overages. How does Pages address this?

```
Your answer:




```

**Question 4:** Explain the file-based routing system for Pages Functions. What file path creates an API endpoint at `/api/articles/123`?

```
Your answer:




```

**Question 5:** A Pages deployment breaks production. The team wants to immediately revert to yesterday's deployment. What is the exact process and how long does it take?

```
Your answer:




```

---

## Sources

- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
- [Pages Functions Documentation](https://developers.cloudflare.com/pages/functions/)
- [Pages Supported Frameworks](https://developers.cloudflare.com/pages/framework-guides/)
- [Pages Bindings (D1, KV, R2)](https://developers.cloudflare.com/pages/functions/bindings/)
- [Pages Headers and Redirects](https://developers.cloudflare.com/pages/configuration/headers/)
- [Pages vs Workers comparison](https://developers.cloudflare.com/workers/static-assets/compatibility-matrix/)
- [Cloudflare Blog: Full-Stack with Pages](https://blog.cloudflare.com/pages-and-workers-are-converging-into-one-experience/)
- [Jamstack Architecture Overview](https://jamstack.org/what-is-jamstack/)
