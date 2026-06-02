# Module 10.12 — Hyperdrive
> Dashboard Location: Account Home → Workers & Pages → Hyperdrive | Estimated Time: 60 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Hyperdrive is Cloudflare's connection pooling proxy for PostgreSQL-compatible databases. It solves a specific and painful problem that every developer using Workers with an external database runs into: connection overhead.

**The problem in plain terms:**

Traditional server applications keep a database connection pool alive in memory. When a request comes in, it grabs an existing connection from the pool — the TCP handshake and TLS negotiation already happened when the pool was initialized. Cost: ~1ms to grab a connection.

Workers are stateless V8 isolates. There is no persistent connection pool. Every Worker request that needs the database must:
1. Perform a TCP handshake to the database (~10-40ms depending on geography)
2. Complete a TLS negotiation (~20-60ms)
3. Authenticate with the database (~5ms)
4. Run the actual query
5. Close the connection

The connection setup overhead alone is 35-105ms per request — before a single query runs. For a Worker that makes multiple queries, this compounds. For a database hosted in us-east-1 called from a Worker in London, the physics make it even worse.

**Hyperdrive's solution:**

Hyperdrive maintains persistent connection pools inside Cloudflare's infrastructure, close to (or collocated with) your database. When a Worker calls Hyperdrive, it's connecting to a local (in-network) endpoint that already has open connections to your database. The Worker-to-Hyperdrive hop is fast; Hyperdrive-to-DB reuses an existing authenticated connection.

**Result:** Query latency drops from 100-200ms (connection + query) to 10-30ms (query only, no connection setup).

**Supported databases:**
- PostgreSQL 12+
- Neon (serverless Postgres)
- Supabase (hosted Postgres)
- PlanetScale (MySQL-compatible via Postgres protocol)
- CockroachDB
- Any Postgres-wire-compatible database

---

## Deep Dive (Architect-Level)

### Architecture Diagram

```
Worker Isolate (e.g., London PoP)
   │
   │  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString })
   │  await client.connect()  ← fast, connects to nearby Hyperdrive endpoint
   ▼
Hyperdrive Connection Pool (Cloudflare, same PoP or nearby)
   │
   │  [Pool of pre-authenticated connections to your database]
   │  [Reuses existing TCP+TLS sessions]
   ▼
Your Database (e.g., Neon in us-east-1, Supabase in eu-west-1)
```

### Connection String Transformation

When you create a Hyperdrive config, it generates a local connection string. Your Worker code uses the local string, not the real database URL. The real credentials and hostname are never exposed to Worker code:

```typescript
// Worker code — connects to Hyperdrive local endpoint
const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
// env.HYPERDRIVE.connectionString = "postgresql://hyperdrive:xxx@hyperdrive-local.cfdata.org:5432/db"
// The real database URL is stored in Hyperdrive config, never in Worker code
```

This has a security benefit: your database credentials aren't in Worker environment variables (which appear in Wrangler.toml or dashboard). They're stored encrypted in Hyperdrive's configuration.

### Query Caching

Hyperdrive includes an optional read query cache for `SELECT` statements:
- Cache key: the full SQL query string + parameters
- Cache location: Cloudflare CDN (same PoP as Worker)
- Cache TTL: configurable (default 60 seconds)
- Invalidation: TTL-based only (no manual invalidation currently)

This is useful for:
- Lookup tables that change infrequently (product catalog, config values)
- Reference data (country codes, category lists)
- Dashboard queries where slight staleness is acceptable

NOT suitable for: user-specific data, real-time inventory, anything where stale data causes problems.

```javascript
// Enable caching with custom TTL when creating Hyperdrive config
wrangler hyperdrive create my-db \
  --connection-string="postgresql://..." \
  --caching-disabled=false \
  --max-age=60 \
  --stale-while-revalidate=15
```

### Transaction Support

Hyperdrive supports PostgreSQL transactions. However, because connection pooling is involved, each transaction is dispatched to a single pooled connection for its duration:

```typescript
const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
await client.connect();

try {
  await client.query('BEGIN');
  await client.query('INSERT INTO orders VALUES ($1, $2)', [orderId, userId]);
  await client.query('UPDATE inventory SET stock = stock - 1 WHERE id = $1', [itemId]);
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  await client.end();
}
```

### D1 vs Hyperdrive: When to Use Each

| Scenario | Use D1 | Use Hyperdrive |
|---|---|---|
| New greenfield project | Yes — no existing DB | No |
| Existing PostgreSQL database | No — can't migrate easily | Yes — wrap your existing DB |
| Multi-region replication | Yes (built-in) | Depends on your DB config |
| SQL interface at edge | Yes | Yes |
| Postgres-specific extensions | No | Yes (uses your actual Postgres) |
| Stored procedures, triggers | No | Yes |
| < 10 GB data | Yes (D1 limits) | Yes |
| Free tier | Yes | Yes (Workers Paid plan required) |

---

## Dashboard Walkthrough

**Step 1: Create a Hyperdrive Configuration**
1. Navigate to Account Home → Workers & Pages → Hyperdrive
2. Click "Create a Hyperdrive config"
3. Configuration name: `macksportreport-db`
4. Enter connection string: `postgresql://user:password@your-db-host/dbname`
5. Click "Create"
6. Note the generated Hyperdrive ID

**Step 2: Review Connection Details**
- Origin hostname: your actual database host
- Hyperdrive ID: what you use in wrangler.toml
- Caching status: enabled/disabled
- Connection status: active connections, errors

**Step 3: Monitor Performance**
- Requests per minute through Hyperdrive
- Latency percentiles
- Cache hit rate (if caching enabled)
- Connection pool size and utilization

---

## Hands-On Lab

### Prerequisites
```bash
npm install -g wrangler
wrangler login

# You need a PostgreSQL database accessible from the internet
# Free options: Neon (neon.tech), Supabase (supabase.com)
```

### Lab 1: Set Up a Free Neon Database
```bash
# Go to neon.tech, create a free account and database
# Copy your connection string:
# postgresql://alex:AbC123dEf@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require

export DB_URL="postgresql://user:password@your-neon-host/neondb"
```

### Lab 2: Create Hyperdrive Configuration
```bash
# Create Hyperdrive config
wrangler hyperdrive create macksportreport-db \
  --connection-string="${DB_URL}"

# Output includes:
# id: "your-hyperdrive-id"  ← copy this

wrangler hyperdrive list
```

### Lab 3: Worker with Hyperdrive
```typescript
// Install postgres client compatible with Workers
// npm install pg (but use the Workers-compatible version)
// npm install @neondatabase/serverless (recommended for Workers)

// src/index.ts
import { Client } from 'pg';

interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Hyperdrive provides a local connection string
    const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
    await client.connect();

    try {
      if (url.pathname === '/articles') {
        const result = await client.query(
          'SELECT id, title, published_at FROM articles ORDER BY published_at DESC LIMIT 10'
        );
        return Response.json(result.rows);
      }

      if (url.pathname.startsWith('/articles/')) {
        const id = url.pathname.split('/')[2];
        const result = await client.query(
          'SELECT * FROM articles WHERE id = $1',
          [id]
        );
        if (result.rows.length === 0) {
          return new Response('Not Found', { status: 404 });
        }
        return Response.json(result.rows[0]);
      }

      return new Response('Not Found', { status: 404 });
    } finally {
      // Always close the connection
      await client.end();
    }
  }
} satisfies ExportedHandler<Env>;
```

```toml
# wrangler.toml
name = "hyperdrive-demo"
main = "src/index.ts"
compatibility_date = "2024-11-01"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id-from-lab-2"
```

### Lab 4: Create Tables and Test
```bash
# Install dependencies
npm install pg @types/pg

# Deploy
wrangler deploy

# Create a test table in your Neon database (run in Neon SQL editor or psql)
# CREATE TABLE articles (
#   id SERIAL PRIMARY KEY,
#   title TEXT NOT NULL,
#   content TEXT,
#   published_at TIMESTAMPTZ DEFAULT NOW()
# );
# INSERT INTO articles (title) VALUES ('First Article'), ('Second Article'), ('Third Article');

# Test the Worker
curl https://hyperdrive-demo.your-subdomain.workers.dev/articles
curl https://hyperdrive-demo.your-subdomain.workers.dev/articles/1
```

### Lab 5: Benchmark With vs Without Hyperdrive
```bash
# Test with Hyperdrive (normal deployment)
for i in {1..10}; do
  curl -s -w "Time: %{time_total}s\n" -o /dev/null \
    https://hyperdrive-demo.your-subdomain.workers.dev/articles
done

# Measure the average query time
# Expected: 15-40ms per request with Hyperdrive
# Without Hyperdrive (direct connection): 100-300ms per request
```

### Lab 6: Enable Query Caching
```bash
# Update Hyperdrive config to enable caching with 60s TTL
wrangler hyperdrive update your-hyperdrive-id \
  --max-age=60 \
  --stale-while-revalidate=30

# Check cache behavior
# First request: cache MISS (goes to DB)
curl -v https://hyperdrive-demo.your-subdomain.workers.dev/articles 2>&1 | grep -i "cf-"

# Second request within 60s: cache HIT
curl -v https://hyperdrive-demo.your-subdomain.workers.dev/articles 2>&1 | grep -i "cf-"
```

---

## Demo Script (2 Minutes)

**Audience:** Developer using Workers who just tried connecting to PostgreSQL and got 200ms query latency

**Opening (20 seconds):**
"You're hitting a Neon database from a Worker and getting 150ms per query. I know. Every request opens a new TCP connection, negotiates TLS, authenticates — before a single row is read. Hyperdrive fixes this."

**Act 1 — Explain the architecture (30 seconds):**
"Hyperdrive maintains a connection pool inside Cloudflare's network, near your database. Your Worker connects to a local Cloudflare endpoint — fast — and Hyperdrive uses an existing authenticated connection to your actual DB. You skip the 100ms of connection setup."

**Act 2 — Show the configuration (30 seconds):**
"One command: `wrangler hyperdrive create my-db --connection-string='postgresql://...'`. One line in wrangler.toml. Your existing postgres client code works unchanged — you just pass `env.HYPERDRIVE.connectionString` instead of your real DB URL. [Show before/after code side by side.] Nothing else changes."

**Act 3 — Show the benchmark (20 seconds):**
"[Show the timing from Lab 5.] 180ms before. 22ms with Hyperdrive. Same database, same query, same Worker. The difference is connection overhead."

**Close (20 seconds):**
"Hyperdrive is free with the Workers Paid plan. If you're already on Workers, it costs nothing to turn on. What's your current database query latency?"

---

## Competitive Context

| Feature | Cloudflare Hyperdrive | PgBouncer (self-hosted) | AWS RDS Proxy | Neon Serverless Driver | PlanetScale Boost |
|---|---|---|---|---|---|
| **Deployment** | Managed (zero ops) | Self-hosted | AWS-managed | Library change | Cloud-managed |
| **Connection pooling** | Yes | Yes | Yes | No (different approach) | Yes |
| **Query caching** | Yes (TTL-based) | No | No | No | Yes |
| **Workers integration** | Native binding | HTTP call required | HTTP/Lambda only | Library-based | HTTP only |
| **Supported protocols** | PostgreSQL wire | PostgreSQL wire | MySQL, PostgreSQL | HTTP only | MySQL only |
| **Cost** | Free (Workers Paid) | Server cost | $0.015/hour+ | Free | Included with plan |
| **Latency (Worker)** | 15-40ms | Depends on location | 20-50ms (Lambda) | 20-60ms | 10-30ms |
| **Geographic distribution** | CF global edge | Single location | Single region | Global (Neon only) | Global |
| **Credentials security** | Stored in CF, not Worker | Your server | AWS Secrets Manager | In Worker env | PlanetScale managed |
| **Transactions** | Yes | Yes | Yes | Limited | Yes |

**Key differentiator:** Hyperdrive runs at the edge alongside your Worker — no cross-region call to a connection pooler. PgBouncer or AWS RDS Proxy require a round-trip to wherever the pooler lives. For Workers at Cloudflare's 300+ PoPs, this geographic advantage is significant.

---

## Self-Check Questions

**Question 1:** Explain the three steps that happen during a cold database connection (TCP handshake, TLS, auth) and the typical latency for each. What does Hyperdrive eliminate?

```
Your answer:




```

**Question 2:** When should you use D1 vs Hyperdrive? Give two specific scenarios where each is clearly the better choice.

```
Your answer:




```

**Question 3:** A developer asks: "Does Hyperdrive cache write queries (INSERT/UPDATE/DELETE)?" What is the answer and why?

```
Your answer:




```

**Question 4:** Explain why storing database credentials in Hyperdrive is more secure than storing them as Worker environment variables.

```
Your answer:




```

**Question 5:** A customer has a Supabase database in ap-southeast-1 (Singapore). Their Workers handle traffic from Europe. With Hyperdrive, where does the connection pool live? Does it help if the pool is still in Singapore?

```
Your answer:




```

---

## Sources

- [Cloudflare Hyperdrive Documentation](https://developers.cloudflare.com/hyperdrive/)
- [Hyperdrive Configuration Reference](https://developers.cloudflare.com/hyperdrive/configuration/)
- [Hyperdrive Caching](https://developers.cloudflare.com/hyperdrive/configuration/query-caching/)
- [Workers Database Tutorials](https://developers.cloudflare.com/workers/tutorials/postgres/)
- [Neon Serverless Driver for Workers](https://neon.tech/docs/serverless/serverless-driver)
- [Cloudflare Blog: Announcing Hyperdrive](https://blog.cloudflare.com/hyperdrive-making-regional-databases-feel-distributed/)
- [PgBouncer Documentation](https://www.pgbouncer.org/)
- [AWS RDS Proxy Pricing](https://aws.amazon.com/rds/proxy/pricing/)
