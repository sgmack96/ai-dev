# SE Intel — Technical Study Guide

> **What this is:** A textbook-style guide to everything you built in SE Intel.
> Every concept is explained through the actual code. Every chapter ends with
> interview questions and answers grounded in your specific implementation.
>
> **How to use it:** Read top to bottom. Chapters build on each other.
> Spend 30 minutes a day — one chapter per sitting. By day 11 you'll have
> the entire system in your head.
>
> **Last updated:** June 2026

---

## Table of Contents

1. [The Problem We Solved](#chapter-1--the-problem-we-solved)
2. [The Runtime: Workers and Durable Objects](#chapter-2--the-runtime-workers-and-durable-objects)
3. [The Auth System](#chapter-3--the-auth-system)
4. [The Rate Limiter](#chapter-4--the-rate-limiter)
5. [The RAG System](#chapter-5--the-rag-system)
6. [The Two-Tier Memory System](#chapter-6--the-two-tier-memory-system)
7. [The Streaming Architecture](#chapter-7--the-streaming-architecture)
8. [The Evaluation Harness](#chapter-8--the-evaluation-harness)
9. [The MCP Server](#chapter-9--the-mcp-server)
10. [Failure Modes and Trade-offs](#chapter-10--failure-modes-and-trade-offs)
11. [The Behavioral Story](#chapter-11--the-behavioral-story)

---

# Chapter 1 — The Problem We Solved

## The Concept

SE Intel is a **multi-agent revenue intelligence platform** for sales teams. It runs
on Cloudflare's edge network and costs $0 in infrastructure. Three AI agents, each
specialized for a different job:

| Agent | Job | Example Prompt |
|-------|-----|---------------|
| **AccountIntelAgent** | Pre-call research on prospect companies | "Research Stripe — tech stack and Cloudflare opportunity" |
| **EnablementAgent** | Sales coaching, objection handling, product knowledge | "How does Workers compare to Lambda? Handle the lock-in objection" |
| **TranscriptAgent** | Post-call transcript analysis, CRM-ready output | "Here's my call notes from the Notion meeting..." |

This is not a wrapper around an LLM API. A wrapper calls GPT and returns the response.
SE Intel is a production system that solves 5 hard problems:

### Problem 1: State Management
If Alice sends two requests at the same time, both read her conversation history,
both generate a response, and both write back — one of the writes gets lost.
This is a classic **race condition**. Most tutorials ignore it entirely.

### Problem 2: Hallucination
A raw LLM will confidently make up pricing, invent product names, and fabricate
competitive claims. In a sales context, that's worse than no answer — a rep using
hallucinated pricing in a customer call is a deal-killer.

### Problem 3: Access Control
An Account Executive should not see internal discount approval tiers. A Solutions
Engineer should not see deal strategy pricing. The system needs **role-based access
control** at the data layer, not just the UI layer.

### Problem 4: Cost
Calling OpenAI's GPT-4o costs ~$10/million input tokens. If every request does a
RAG lookup + LLM call + memory extraction, costs spiral. Workers AI (Llama 3.3 70B)
is included in the Cloudflare Workers paid plan at no additional per-token cost for
most usage.

### Problem 5: Streaming
Users expect to see words appear as the AI thinks, not wait 15 seconds for a
complete response. Streaming requires a fundamentally different architecture than
request/response — you need Server-Sent Events, `ReadableStream`, and careful
lifecycle management so background work (memory, audit) completes after the
stream closes.

**Every technical decision in chapters 2-9 traces back to one of these 5 problems.**

---

### Study Questions — Chapter 1

> These are self-check questions. Answer them from memory before reading the next chapter.

1. What are the 3 agents in SE Intel and what does each do?
2. What is the race condition problem in a multi-user chat system?
3. Why is hallucination especially dangerous in a sales context?
4. Why does the system need RBAC at the data layer, not just the UI?
5. What are the 5 hard problems SE Intel solves?

---

# Chapter 2 — The Runtime: Workers and Durable Objects

## The Concept

### What is a Cloudflare Worker?

A Worker is a **V8 isolate** — the same JavaScript engine that powers Google Chrome.
It is not a container. It is not a virtual machine. The distinction matters:

| Property | Container (AWS Lambda) | V8 Isolate (Workers) |
|----------|----------------------|---------------------|
| **Cold start** | 100ms-1s (download image, start runtime) | ~0ms (isolate already warm) |
| **Memory** | Dedicated per instance (128MB-10GB) | Shared across isolates (~128MB per isolate) |
| **Location** | One region you choose | 300+ edge locations globally |
| **Pricing** | Per-ms of compute time | Per-request ($0.15/million after free tier) |

A Worker runs your code in **every Cloudflare data center worldwide**. When a user
in Tokyo hits your API, their request runs in Tokyo — not in us-east-1.

### What is a Durable Object?

A Durable Object (DO) is a JavaScript class instance with three special properties:

1. **Single-threaded execution** — all requests to the same DO instance are processed
   one at a time, in order. No two requests ever run concurrently inside one DO.
2. **Embedded SQLite** — each DO has its own SQLite database (up to 10GB). No network
   hop to read data — it's co-located with the compute.
3. **Hibernation** — when no requests are active, the DO sleeps. Cost: $0. When the
   next request arrives, it wakes in <1ms. SQLite data persists across hibernation.

### The Race Condition Problem (Why DOs Matter)

This is the core architectural insight. Study this scenario:

```
WITHOUT Durable Objects (shared database like Postgres or D1):
═══════════════════════════════════════════════════════════════

Timeline →

Request A:  READ history [msg1, msg2]          WRITE [msg1, msg2, msg3-A]
Request B:      READ history [msg1, msg2]          WRITE [msg1, msg2, msg3-B]
                                                    ↑
                                         msg3-A is LOST. B overwrote A.

Both requests read the SAME history because they ran concurrently.
Both appended their response. B's write was last, so A's message vanished.


WITH Durable Objects (single-threaded, serialized):
═══════════════════════════════════════════════════

Request A:  READ → [msg1, msg2] → WRITE → [msg1, msg2, msg3-A] → DONE
Request B:  (queued, waiting)   → READ → [msg1, msg2, msg3-A] → WRITE → [msg1, msg2, msg3-A, msg3-B]
                                   ↑
                        B sees A's write. No data lost. No locks needed.
```

This is why we chose Durable Objects. Not because they're fancy — because they
solve a real data integrity problem with zero additional complexity.

## What We Built

### One DO instance per user, per agent type

```javascript
// Worker router creates (or finds) a DO instance for this specific user
// idFromName("alice") ALWAYS returns the same DO for alice
// idFromName("bob") returns a completely different, isolated DO
const doId = env.ACCOUNT_AGENT.idFromName(userId)
const stub = env.ACCOUNT_AGENT.get(doId)

// Forward the request to Alice's personal DO instance
// Bob's context is never touched — they're separate isolates
const response = await stub.fetch(
  new Request("https://do-internal/chat", {
    method: "POST",
    body: JSON.stringify({ message, threadId, userContext })
  })
)
```
`📄 src/index.ts:174-188`

### The base agent class — what every agent inherits

```javascript
class BaseAgent {
  constructor(state, env, agentType) {
    this.state = state        // DO runtime state — gives us access to SQLite
    this.env = env            // Cloudflare bindings (AI, KV, D1, Vectorize)
    this.agentType = agentType // "account" or "enablement" or "transcript"

    // Each DO has its own embedded SQLite — this is the interface to it
    this.memory = new ShortTermMemory(state.storage)
  }

  // The DO handles HTTP requests — the Worker router calls us via stub.fetch()
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/chat")    return this.handleChat(request)
    if (url.pathname === "/stream")  return this.handleStream(request)
    if (url.pathname === "/history") return this.handleHistory(request)
  }

  // Subclasses implement these — each agent has different prompts and tools
  abstract buildSystemPrompt(userContext, ltmContext)
  abstract dispatchTools(message, userContext, toolCalls)
}
```
`📄 src/agents/base-agent.ts:35-69`

## Why We Built It This Way

**Why Durable Objects instead of a shared database (D1, Postgres)?**
- No race conditions — requests serialize automatically. No locks, no transactions.
- SQLite is co-located — reading conversation history is sub-millisecond, no network hop.
- Per-user isolation is physical, not logical. Alice's data isn't just WHERE-filtered — it's a separate database entirely.
- Idle DOs hibernate at $0 — you only pay when users are active.

**Why two separate DO classes (AccountIntelAgent + EnablementAgent) instead of one?**
- Context isolation: account research context shouldn't bleed into product coaching context.
- Each agent has its own conversation history — keeps the context window smaller and cleaner.
- Independent scaling: if account research gets 10x traffic, it doesn't affect enablement DOs.
- The trade-off: separate DOs can't natively share state. That's why long-term memory is in KV (Chapter 6).

## What We Rejected and Why

| Alternative | Why We Rejected It |
|------------|-------------------|
| **Shared D1 database for history** | Race conditions on concurrent writes. Would need row-level locking or optimistic concurrency — more complexity for worse performance. |
| **Redis/Upstash for session state** | External network hop for every history read. Adds latency and a dependency. DO SQLite is co-located and free. |
| **One DO class for all agents** | Conversation contexts would mix. An account research thread and an enablement thread shouldn't share the same history. |
| **Stateless (no history)** | Every request would be standalone — no multi-turn conversations, no "what did I just ask about?" |

---

### Interview Questions — Chapter 2

**Q: What is a Durable Object and why did you use it?**
A: A Durable Object is a JavaScript class instance with guaranteed single-threaded execution and embedded SQLite storage. I used it because SE Intel needs per-user conversation history, and concurrent requests to a shared database create race conditions on that history. With a DO, all requests for one user serialize automatically — no locks needed, no data loss. Each user gets their own DO instance with its own SQLite database. When idle, it hibernates at $0.

**Q: What's the difference between a V8 isolate and a container?**
A: A container (like Lambda) downloads an image, starts a runtime, and runs your code — that's the cold start, usually 100ms-1s. A V8 isolate is just a JavaScript execution context inside an already-running V8 engine — the same engine Chrome uses. No image to download, no runtime to boot. Cold start is effectively 0ms. The trade-off: isolates share memory across tenants (128MB per isolate), so you can't run heavy compute like ML training.

**Q: What happens to the SQLite data when a Durable Object hibernates?**
A: It persists. SQLite data is durably stored — hibernation only releases the compute (the JavaScript isolate). When the next request arrives, the DO wakes in <1ms and SQLite data is immediately available. This is the key insight: you get persistent storage with on-demand compute. Cost of a sleeping DO: $0.

**Q: Why did you use two DO classes instead of one combined agent?**
A: Context isolation. If I put account research and sales coaching in one DO class, conversation history from a "Research Stripe" thread would be in the same SQLite as a "How does Workers compare to Lambda" thread. The LLM would see cross-contaminated context. Separate DOs keep separate contexts clean. The trade-off is that they can't share state natively — I solved that by putting long-term memory in KV, which is accessible from any Worker or DO.

**Q: Walk me through the request flow from HTTP to DO.**
A: HTTP POST arrives at the Worker (a Hono router). Middleware extracts the JWT and builds a UserContext. Rate limit check hits KV. Then `env.ACCOUNT_AGENT.idFromName(userId)` gets a unique DO identifier for this user — the same userId always maps to the same DO instance. `env.ACCOUNT_AGENT.get(doId)` gets a stub (a proxy object). `stub.fetch()` forwards the request to that specific DO. Inside the DO, `handleChat()` loads history from SQLite, dispatches tools, calls Workers AI, persists the new turns, and returns the response.

---

# Chapter 3 — The Auth System

## The Concept

### What is a JWT?

A JSON Web Token is a string with three parts separated by dots:

```
eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSIsInJvbGUiOiJzZSJ9.K7gNU3sdo-OL0wNhqoVWhr3g

Part 1: HEADER    → {"alg": "HS256", "typ": "JWT"}
Part 2: PAYLOAD   → {"sub": "alice", "role": "se", "exp": 1720000000}
Part 3: SIGNATURE → HMAC-SHA256(header + "." + payload, secret)
```

Each part is **base64url encoded** — not encrypted. Anyone can decode Parts 1 and 2
and read them. The signature (Part 3) is what proves the token hasn't been tampered with.

### What is HS256?

HS256 = **HMAC-SHA256**. It's a symmetric signing algorithm:

1. Take the header and payload: `"eyJhbG...eyJzdW..."`
2. Hash it with a secret key using SHA-256
3. The result is the signature

To **verify**: re-compute the hash with the same secret. If your computed signature
matches Part 3 of the token, the token is authentic. If even one character of the
payload was changed, the signatures won't match.

**Symmetric** means the same secret signs and verifies. If the secret leaks,
anyone can forge tokens. That's why it's stored as a Wrangler secret (`wrangler secret put JWT_SECRET`),
never in code or config files.

### Why No npm JWT Library?

The Workers runtime has the **WebCrypto API** built in — `crypto.subtle` gives you
HMAC, SHA-256, AES, RSA, and more. JWT verification is ~40 lines of code with WebCrypto.
Adding `jsonwebtoken` (npm) would pull in Node.js dependencies that may not work in
the Workers V8 runtime and would add bundle size for something the platform already provides.

## What We Built

### JWT verification using the WebCrypto API

```javascript
async function verifyToken(token, secret) {
  // Split the JWT into its 3 parts
  const [headerB64, payloadB64, signatureB64] = token.split(".")

  // Import the secret as a cryptographic key
  // "raw" = the key is raw bytes, not wrapped in a key format
  // ["verify"] = this key can ONLY verify, not sign — principle of least privilege
  const key = await crypto.subtle.importKey(
    "raw",
    encode(secret),           // TextEncoder converts string → bytes
    { name: "HMAC", hash: "SHA-256" },
    false,                    // not extractable — can't read the key material back out
    ["verify"]
  )

  // Re-sign header.payload and compare to the signature in the token
  // This is a constant-time comparison — prevents timing attacks
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(signatureB64),     // the signature FROM the token
    encode(`${headerB64}.${payloadB64}`) // what we're checking it against
  )

  if (!valid) return null // token was forged or tampered with

  // Decode the payload and check if it's expired
  const claims = JSON.parse(atob(payloadB64))
  if (claims.exp < Math.floor(Date.now() / 1000)) return null // expired

  return claims // { sub: "alice", role: "se", name: "Alice Chen", ... }
}
```
`📄 src/auth/context.ts:51-90`

### Two auth paths — production vs portfolio

```javascript
async function extractUserContext(request, env) {

  // PATH 1: Cloudflare Access (production)
  // Access validates the JWT BEFORE the request reaches our Worker.
  // We just parse the already-verified token — no signature check needed.
  const accessJwt = request.headers.get("cf-access-jwt-assertion")
  if (accessJwt) {
    const claims = parsePayload(accessJwt) // decode only, no verify
    return { userId: claims.sub, role: claims["custom:role"], ... }
  }

  // PATH 2: Our own HS256 tokens (portfolio / demo)
  // We issued these tokens via /dev/token, so WE verify the signature.
  const bearer = request.headers.get("Authorization")
  if (bearer?.startsWith("Bearer ")) {
    const claims = await verifyHs256Jwt(bearer.slice(7), env.JWT_SECRET)
    return { userId: claims.sub, role: claims.role, ... }
  }

  // PATH 3: Dev headers (local development only)
  // NEVER trusted in portfolio or production — only when ENVIRONMENT === "development"
  if (env.ENVIRONMENT === "development") {
    return buildFromDevHeaders(request)
  }

  return null // no valid auth found → 401
}
```
`📄 src/auth/context.ts:100-170`

### Defense in depth — the tool re-checks role

The JWT tells us WHO the user is. But the **tool** enforces WHAT they can access:

```javascript
// In the kb-search tool — called by the agent during processing
// The router already verified the JWT, but we check the role AGAIN here.
// Why? If a bug in the agent code passes the wrong role, this catches it.

const allowedNamespaces = ROLE_KB_ACCESS[role]
// ae  → ["public"]                        — product info only
// se  → ["public", "se_only"]             — plus technical deep-dives
// mgr → ["public", "se_only", "manager_only"] — plus pricing/deal strategy

if (requestedNamespace && !allowedNamespaces.includes(requestedNamespace)) {
  console.warn(`Role ${role} tried to access ${requestedNamespace} — denied`)
  return null  // silently deny — don't reveal the namespace exists
}
```
`📄 src/tools/kb-search.ts:54-62`

## Why We Built It This Way

**Why WebCrypto instead of an npm JWT library?**
- `crypto.subtle` is built into every Worker runtime — no dependencies to install or update
- npm's `jsonwebtoken` package relies on Node.js APIs (`Buffer`, `crypto` module) that may not work in V8 isolates
- JWT verification is simple: import key, verify signature, check expiry. 40 lines vs a dependency tree
- Smaller bundle size = faster Worker startup

**Why two auth paths instead of one?**
- Production uses Cloudflare Access (SSO) — the JWT is validated at the network edge before your code runs. Your Worker just parses claims.
- Portfolio uses self-issued HS256 tokens — lets anyone demo the system without an SSO setup. The `/dev/token` endpoint is disabled in production.
- Same codebase, same deployment. The `ENVIRONMENT` variable gates which path is active.

**Why defense in depth (router + tool both check role)?**
- The router is responsible for **identity** — who is this person?
- The tool is responsible for **authorization** — what can this person access?
- If a bug in the agent orchestration passes the wrong UserContext to a tool, the tool's own check catches it
- This is standard security practice: never trust your caller, even if your caller is your own code

## What We Rejected and Why

| Alternative | Why We Rejected It |
|------------|-------------------|
| **npm `jsonwebtoken` library** | Node.js dependency. May not work in Workers V8 runtime. WebCrypto does the same thing natively. |
| **API keys instead of JWTs** | API keys don't carry claims (role, org, name). You'd need a database lookup per request to determine identity. JWTs are self-contained. |
| **Only router-level RBAC** | A single point of enforcement. If it has a bug, the entire KB is exposed. Defense in depth = the tool is the last line. |
| **Cloudflare Access for portfolio too** | Requires SSO setup, domain ownership, Access policies. Overkill for a public demo — self-issued tokens are simpler. |

---

### Interview Questions — Chapter 3

**Q: How does authentication work in your system?**
A: Two paths. In production, Cloudflare Access validates the JWT at the network edge — before my code runs. My Worker just parses the already-verified `cf-access-jwt-assertion` header and extracts claims. In the portfolio environment, I issue HS256 JWTs from a `/dev/token` endpoint, and the Worker verifies the signature using the WebCrypto API's `crypto.subtle.verify()`. Both paths produce the same `UserContext` object — userId, role, orgId, name — which is passed to the Durable Object.

**Q: What is defense in depth and how did you implement it?**
A: Defense in depth means multiple independent layers of security, so a failure in one layer doesn't compromise the system. In SE Intel, the router layer validates the JWT and determines the user's identity. The tool layer (kb-search, news, web-search) independently re-checks the user's role before executing. If a bug in the agent code passes the wrong role to a tool, the tool itself denies access. The principle: the router identifies WHO you are, the tool enforces WHAT you can do.

**Q: Why did you use WebCrypto instead of an npm JWT library?**
A: Workers run on V8 isolates, not Node.js. npm's `jsonwebtoken` relies on Node.js-specific APIs like `Buffer` and the `crypto` module, which may not be available or may behave differently in the Workers runtime. `crypto.subtle` is built into every V8 isolate — it provides HMAC-SHA256, constant-time verification, and key management natively. JWT verification is simple enough (import key, verify signature, check expiry) that a library adds dependency risk without meaningful benefit.

**Q: What happens if someone tampers with the payload of a JWT?**
A: The signature won't match. The signature is HMAC-SHA256 of the header plus payload, using a secret key. If you change even one character of the payload (e.g., changing `role: "ae"` to `role: "sales_manager"`), the re-computed hash won't match the signature in the token. `crypto.subtle.verify()` returns `false`, and the request is rejected with a 401.

---

# Chapter 4 — The Rate Limiter

## The Concept

### Three Rate Limiting Strategies

Every API needs rate limiting. There are three common approaches:

**Fixed Window:**
Divide time into fixed buckets (e.g., every minute starting at :00). Count requests per bucket.
- Problem: "reset gaming" — a user sends 20 requests at 11:59:58, limit resets at 12:00:00, they send 20 more at 12:00:02. 40 requests in 4 seconds.

**Sliding Window (what we use):**
Each request's window is the 60 seconds before it. No fixed reset points.
- Prevents reset gaming — there's no moment where the counter drops to zero.
- Simpler than token bucket, good enough for per-user API rate limiting.

**Token Bucket:**
A bucket fills with tokens at a steady rate. Each request consumes a token. If the bucket is empty, the request is rejected.
- Most flexible — allows bursts while maintaining an average rate.
- More complex to implement. Overkill for our use case.

```
FIXED WINDOW — the reset gaming problem:
═════════════════════════════════════════
  11:59:58  Alice sends 20 requests → hits limit
  12:00:00  Counter resets to 0
  12:00:02  Alice sends 20 more → succeeds
  Result:   40 requests in 4 seconds. The "20 per minute" limit is meaningless.

SLIDING WINDOW — no gaming possible:
═════════════════════════════════════
  11:59:58  Alice sends 20 requests → hits limit
  12:00:02  Alice tries again → system looks at last 60 seconds → still 20 → denied
  12:00:58  Oldest requests fall out of the window → counter drops → Alice can send again
```

## What We Built

```javascript
// Role-based limits — managers get more for bulk operations
const LIMITS = {
  ae: 20,            // 20 requests per minute
  csm: 20,
  se: 30,            // SEs do more research
  tam: 30,
  sales_manager: 50  // managers reviewing multiple accounts
}

async function checkRateLimit(userId, role, env) {
  const limit = LIMITS[role]

  // Bucket = which 1-minute window we're in right now
  // At 12:05:30 → bucket = Math.floor(Date.now() / 60000) = some large integer
  // This changes every 60 seconds — each minute gets a new bucket number
  const bucket = Math.floor(Date.now() / 60000)
  const key = `rl:${userId}:${bucket}`

  // How many requests has this user made in the current minute?
  const current = await env.RATE_LIMIT_KV.get(key)
  const count = current ? parseInt(current) : 0

  if (count >= limit) {
    return { allowed: false, remaining: 0 }
  }

  // Increment the counter. TTL=120s means the key auto-deletes after 2 minutes.
  // This is free cleanup — no background job needed.
  await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: 120 })

  return { allowed: true, remaining: limit - (count + 1) }
}
```
`📄 src/auth/ratelimit.ts:16-52`

## Why We Built It This Way

**Why sliding window?**
Prevents reset gaming. Simple to implement with KV. Good enough for per-user API limiting.

**Why KV for the counter instead of a Durable Object?**
KV is globally distributed and fast for simple get/put. A DO would be more accurate
(guaranteed serial execution), but it's overkill for rate limiting where occasional
over-counting by 1-2 requests is acceptable.

**Why role-based limits?**
Different roles have different usage patterns. A sales manager reviewing 10 accounts
before a pipeline review needs more requests than an AE checking one account before a call.

## The Known Weakness

KV is **eventually consistent**. In practice, this means:

```
Request A reads count = 19 (limit is 20)
Request B reads count = 19 (KV hasn't propagated A's write yet)
Both increment to 20 → both succeed
Result: 21 requests allowed instead of 20
```

This is a minor over-count, not a security vulnerability. For a sales tool, allowing
21 requests instead of 20 is acceptable. For a billing-critical API, you'd replace KV
with a Durable Object counter (guaranteed serial reads/writes).

---

### Interview Questions — Chapter 4

**Q: What rate limiting strategy did you use and why?**
A: Sliding window using KV counters. Each user gets a key like `rl:alice:1234505` where the number is `Math.floor(Date.now() / 60000)` — a new key every minute. I chose sliding window over fixed window to prevent reset gaming, where a user sends a burst of requests right before the counter resets. The limits are role-based: AEs get 20/min, SEs get 30/min, managers get 50/min.

**Q: What's the weakness in your rate limiter?**
A: KV is eventually consistent. Two concurrent requests can both read the same count and both succeed when only one should. In practice, this means the limit might be exceeded by 1-2 requests during a burst. For a sales tool this is acceptable — the rate limit is a guardrail, not a billing meter. If I needed exact enforcement, I'd use a Durable Object as the counter, since DOs guarantee serial execution.

**Q: When would you use a token bucket instead?**
A: When you need to allow bursts while maintaining an average rate. For example, a real-time API where a client might send 10 requests at once but averages 2/second. Token bucket lets the burst through (if the bucket has tokens) while the refill rate prevents sustained abuse. For SE Intel, users send one request at a time and wait for the response — no burst pattern to accommodate.

---

# Chapter 5 — The RAG System

## The Concept

### What is RAG?

RAG stands for **Retrieval-Augmented Generation**. It solves the hallucination problem.

Without RAG:
```
User: "What's Cloudflare's pricing for Workers?"
LLM:  "Workers costs $5 per million requests" ← HALLUCINATED. The real number is $0.15.
```

With RAG:
```
User: "What's Cloudflare's pricing for Workers?"
Step 1: Search a knowledge base for "Cloudflare Workers pricing"
Step 2: Retrieve: "Workers Paid plan: $0.15/million requests, $12.50/million ms CPU time"
Step 3: Inject that text into the LLM's context as a system message
Step 4: LLM reads the retrieved text and uses it in the response
Result: "Workers costs $0.15 per million requests" ← GROUNDED in real data
```

RAG doesn't change the model. It changes **what the model sees** before answering.

### What are Embeddings?

An embedding is a **numerical representation of meaning**. The model converts text into
a vector (a list of numbers) that captures semantic meaning:

```
"Cloudflare Workers serverless"  → [0.12, -0.45, 0.78, 0.03, ... 768 numbers]
"AWS Lambda functions"           → [0.11, -0.42, 0.76, 0.05, ... 768 numbers]
"Italian pizza recipe"           → [0.89, 0.23, -0.67, 0.41, ... 768 numbers]

Workers and Lambda are CLOSE in vector space (similar meaning).
Pizza is FAR from both (different topic entirely).
```

**768 dimensions** means each text gets converted into 768 numbers. More dimensions =
more nuanced representation, but slower to compute and store. 768 (from the BGE-base
model) is a good balance: enough for accurate semantic matching, small enough to
embed in real-time per request (<100ms).

### What is Cosine Similarity?

Cosine similarity measures the **angle** between two vectors, not the distance.
Values range from -1 (opposite) to 1 (identical). We use a threshold of 0.5 —
anything below that is probably not relevant.

Why angle instead of distance? Because text length doesn't matter. A long document
and a short query about the same topic will point in the same direction (small angle,
high cosine similarity), even though the long document's vector has a larger magnitude.

## What We Built

### The RAG pipeline — 5 steps from query to grounded context

```javascript
async function kbSearch(query, role, env, toolCalls) {
  // STEP 1: Check permissions — which namespaces can this role access?
  const allowedNamespaces = ROLE_KB_ACCESS[role]
  // ae  → ["public"]
  // se  → ["public", "se_only"]
  // mgr → ["public", "se_only", "manager_only"]

  // STEP 2: Convert the query into a 768-dimensional embedding vector
  const embedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [query]  // can embed multiple texts in one call — we just need one
  })
  const queryVector = embedding.data[0]  // [0.12, -0.45, ... 768 numbers]

  // STEP 3: Search each allowed namespace in parallel
  const results = await Promise.all(
    allowedNamespaces.map(ns =>
      env.VECTORIZE.query(queryVector, {
        topK: 5,                          // return the 5 most similar chunks
        filter: { namespace: ns },        // RBAC enforced at the DB level
        returnMetadata: "all"             // include the original text content
      })
    )
  )

  // STEP 4: Filter by quality (cosine similarity >= 0.5)
  const goodResults = results.flat()
    .filter(match => match.score >= 0.5)  // 0.5 = minimum relevance threshold
    .sort((a, b) => b.score - a.score)    // best matches first
    .slice(0, 5)                          // cap at 5 total

  // STEP 5: Format for injection into the LLM's context
  return goodResults.map((r, i) =>
    `${i+1}. [${r.metadata.productName}] (relevance: ${r.score * 100}%)\n${r.metadata.content}`
  ).join("\n\n")
}
```
`📄 src/tools/kb-search.ts:44-139`

### How tool results get injected into the LLM context

```javascript
// In base-agent.ts — the core agent loop

// Build the message array for the LLM
const messages = [
  { role: "system", content: systemPrompt },      // who you are, how to behave
  ...history,                                       // previous conversation turns
  { role: "user", content: userMessage }            // what the user just asked
]

// Dispatch tools — KB search, web search, news
const toolResults = await this.dispatchTools(message, userContext, toolCalls)

// INJECT tool results as a system message RIGHT BEFORE the user message
// This is the "augmentation" in Retrieval-Augmented Generation
if (toolResults) {
  messages.splice(messages.length - 1, 0, {
    role: "system",
    content: `[Tool Results]\n${toolResults}`
  })
}

// Now the LLM sees: system prompt → history → [Tool Results] → user question
// It uses the tool results to ground its answer in real data
const response = await env.AI.run(MODEL, { messages })
```
`📄 src/agents/base-agent.ts:96-131`

### The knowledge base — 3 namespaces, 102 chunks

```
NAMESPACE: "public" (80 chunks)
  └── Product overviews, pricing, competitor comparisons
  └── Available to: ALL roles (ae, se, csm, tam, manager)

NAMESPACE: "se_only" (12 chunks)
  └── POC patterns, architecture guides, technical objection handling
  └── Available to: se, tam, sales_manager

NAMESPACE: "manager_only" (10 chunks)
  └── Discount approval tiers, deal strategy, champion building
  └── Available to: sales_manager ONLY
```

All 102 chunks live in **one Vectorize index**. Namespace separation is done via metadata
filtering (`filter: { namespace: "se_only" }`), not separate indexes.

## Why We Built It This Way

**Why one Vectorize index with metadata filters instead of 3 separate indexes?**
- One index = one seed script, one wrangler binding, one place to update content
- Metadata filtering is done at the database level by Vectorize — not in application code
- Separate indexes would mean 3x configuration, 3x seed management, 3x wrangler bindings
- Trade-off: a bug in the filter logic could expose wrong-namespace chunks. That's why we enforce RBAC at the tool layer too (defense in depth from Chapter 3).

**Why cosine similarity with a 0.5 threshold?**
- Below 0.5 = probably not semantically related, would add noise to the LLM context
- Too high (0.8+) = only near-exact matches, misses useful paraphrased content
- 0.5 is a practical balance. Tuned through the eval harness (Chapter 8) — lower thresholds increased hallucination, higher thresholds reduced recall.

**Why inject tool results as a system message instead of using function calling?**
- Workers AI (Llama 3.3 70B) doesn't reliably support OpenAI-style function calling in streaming mode
- Injecting as a system message is more reliable: the LLM always sees the KB content
- This is "eager tool calling" — tools run BEFORE the LLM, not called BY the LLM. More predictable, slightly more latency.

---

### Interview Questions — Chapter 5

**Q: What is RAG and why did you use it?**
A: Retrieval-Augmented Generation. Instead of relying on the LLM's training data (which can hallucinate), I search a curated knowledge base for relevant content, then inject that content into the LLM's context before it generates a response. The LLM reads the retrieved text and grounds its answer in real data. This is critical for a sales tool — a rep using hallucinated pricing in a customer call is a deal-killer.

**Q: Walk me through the RAG pipeline in your system.**
A: Five steps. (1) Check the user's role to determine which Vectorize namespaces they can query. (2) Convert the user's question into a 768-dimensional embedding vector using BGE-base-en-v1.5. (3) Query Vectorize in parallel across all allowed namespaces, requesting the 5 most similar chunks with a metadata filter for namespace. (4) Filter results by cosine similarity >= 0.5 and take the top 5. (5) Format the chunks into a string and inject it as a system message right before the user's question in the LLM context.

**Q: What is cosine similarity and why did you choose it over other distance metrics?**
A: Cosine similarity measures the angle between two vectors, not the magnitude. It ranges from -1 (opposite meaning) to 1 (identical meaning). I chose it because text length doesn't matter — a short query and a long document about the same topic will have high cosine similarity because they point in the same direction, even though the document's vector is "longer." This is better than Euclidean distance for semantic search where query and document lengths differ significantly.

**Q: What happens if the knowledge base returns nothing relevant?**
A: The `kbSearch` function returns `null`. The agent then falls back to web search (DuckDuckGo). If web search also returns nothing, the LLM answers from its training data — but the system prompt instructs it to flag when it's not grounding in specific sources. This cascading fallback (KB → web → training data) maximizes answer quality while handling edge cases.

**Q: Why is the score threshold 0.5 and not higher or lower?**
A: Tuned through the eval harness. At 0.3, too much irrelevant content got injected — the LLM would cite tangentially related chunks and produce unfocused responses (groundedness score dropped). At 0.8, too few chunks matched — the LLM fell back to training data more often (hallucination increased). 0.5 was the practical balance where retrieved content was relevant enough to improve answers without adding noise.

---

# Chapter 6 — The Two-Tier Memory System

## The Concept

SE Intel has two kinds of memory, serving two different purposes:

| | Short-Term Memory | Long-Term Memory |
|---|---|---|
| **What it stores** | Conversation messages (user said X, agent said Y) | Personal facts about the user ("prefers bullets", "working on Stripe deal") |
| **Scope** | One thread in one agent | Shared across ALL agents and ALL threads |
| **Storage** | DO SQLite (co-located with compute) | Workers KV (globally accessible) |
| **Lifetime** | Last 20 turns per thread, then trimmed | Up to 50 facts per user, oldest evicted |
| **Why this storage?** | Needs serial access (race conditions), needs to be fast | Needs to be accessible from multiple DO classes |

### The Cross-Agent Sharing Problem

This is the key insight that drives the architecture:

```
AccountIntelAgent DO (Alice's instance)
  └── SQLite: Alice's account research conversations
  └── CAN'T read from EnablementAgent's SQLite ← this is the problem

EnablementAgent DO (Alice's instance)
  └── SQLite: Alice's enablement conversations
  └── CAN'T read from AccountIntelAgent's SQLite

Solution: Put shared memory in KV (accessible from everywhere)

Workers KV
  └── ltm:alice:fact-001 → "Working on Stripe deal, Series C"
  └── ltm:alice:fact-002 → "Prefers responses without bullet points"
  └── Both DOs can read and write to this ✓
```

DO SQLite is scoped to one DO class. You can't reach into another DO's storage.
KV is a global key-value store accessible from any Worker or DO in your account.

## What We Built

### Short-term memory — SQLite in the Durable Object

```javascript
class ShortTermMemory {
  constructor(storage) {
    // storage.sql is the SQLite interface on a Durable Object
    this.db = storage.sql

    // Create the table if it doesn't exist
    // This runs every time the DO wakes up — CREATE IF NOT EXISTS is idempotent
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id        TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role      TEXT NOT NULL,       -- 'user' or 'assistant'
        content   TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `)
  }

  // Save a message and trim old ones
  async append(threadId, message) {
    this.db.exec("INSERT INTO messages ...", message)

    // Keep only the last 20 messages per thread
    // Why 20? Enough context for multi-turn conversations,
    // small enough to fit in the LLM's context window without waste
    this.db.exec(`
      DELETE FROM messages
      WHERE thread_id = ?
        AND id NOT IN (
          SELECT id FROM messages WHERE thread_id = ? ORDER BY timestamp DESC LIMIT 20
        )
    `, threadId, threadId)
  }

  // Get history oldest-first (LLMs expect chronological order)
  getHistory(threadId) {
    return this.db.exec(
      "SELECT * FROM messages WHERE thread_id = ? ORDER BY timestamp ASC LIMIT 20",
      threadId
    )
  }
}
```
`📄 src/memory/short-term.ts:25-105`

### Long-term memory — fact extraction + KV storage

```javascript
class LongTermMemory {
  constructor(userId, env) {
    this.userId = userId
    this.kv = env.USER_MEMORY_KV
  }

  // Store a fact. Evict the oldest if we're at the 50-fact limit.
  async remember(fact) {
    // Load the index (list of all fact IDs for this user)
    const index = JSON.parse(await this.kv.get(`ltm:${userId}:__index`)) || []

    // FIFO eviction — oldest fact gets deleted when at limit
    if (index.length >= 50) {
      const oldest = index.shift()  // remove first (oldest) ID
      await this.kv.delete(`ltm:${userId}:${oldest}`)
    }

    // Store the new fact with a 1-year TTL
    index.push(fact.id)
    await this.kv.put(`ltm:${userId}:${fact.id}`, JSON.stringify(fact), {
      expirationTtl: 365 * 24 * 60 * 60  // auto-delete after 1 year
    })
    await this.kv.put(`ltm:${userId}:__index`, JSON.stringify(index))
  }

  // Format facts for injection into the system prompt
  async formatForPrompt() {
    const facts = await this.recall()
    if (facts.length === 0) return ""

    // Only inject the 10 most recent facts — saves context window tokens
    const lines = facts.slice(0, 10).map(f => `- ${f.content}`)
    return `\n\nWhat I know about you from previous conversations:\n${lines.join("\n")}`
  }
}
```
`📄 src/memory/long-term.ts:44-131`

### The `state.waitUntil()` pattern — the most important detail

After the agent returns a response to the user, we need to:
1. Save the conversation to SQLite
2. Write an audit event to D1
3. Extract personal facts and save them to KV

All three are async operations. Here's the critical bug and fix:

```javascript
// THE BUG — this silently fails
// After returning the HTTP Response, the DO isolate gets recycled.
// The LTM extraction call (a second LLM call!) gets killed mid-flight.
// No error is thrown. The fact just never gets saved. Silent data loss.
ltmWriter.extractAndRemember(message, response, env).catch(() => {})

// THE FIX — state.waitUntil() keeps the DO alive
// This tells the runtime: "I've returned the Response, but DON'T recycle me
// until this promise settles." The LTM extraction runs to completion.
this.state.waitUntil(
  ltmWriter.extractAndRemember(message, response, env)
    .catch(err => console.error("[ltm] extract error:", err))
)

// Same pattern for audit logging
this.state.waitUntil(
  this.writeAuditEvent({ userId, role, agentType, latencyMs, ... })
    .catch(err => console.error("[audit] D1 write error:", err))
)
```
`📄 src/agents/base-agent.ts:160-185`

### The extraction prompt — how facts are pulled from conversations

```javascript
async extractAndRemember(userMessage, agentResponse, env) {
  // Skip short exchanges — "Got it" / "Sure" won't contain useful facts
  if (userMessage.length + agentResponse.length < 80) return

  const prompt = `Extract 0-2 short facts about the USER from this exchange.

  USER MESSAGE: "${userMessage.slice(0, 400)}"
  AGENT RESPONSE: "${agentResponse.slice(0, 300)}"

  GOOD facts (extract these):
  - "Working on Stripe deal, Series C, ~200 engineers"
  - "Has QBR with Notion on June 15"
  - "Champion at Datadog is VP Eng named Sarah"

  BAD facts (do NOT extract these):
  - "Asked about Workers vs Lambda"  ← question, not a personal fact
  - "Cloudflare has zero cold starts" ← product info, not about the user

  Return ONLY valid JSON: {"facts": ["fact 1", "fact 2"]} or {"facts": []}`

  const result = await env.AI.run(MODEL, {
    messages: [{ role: "user", content: prompt }],
    max_tokens: 150,
    temperature: 0.1  // low temperature = consistent structured output
  })

  // Parse and store each fact (max 2 per turn)
  const parsed = JSON.parse(result.response)
  for (const fact of parsed.facts.slice(0, 2)) {
    await this.remember({ content: fact, source: "agent_inferred" })
  }
}
```
`📄 src/memory/long-term.ts:151-254`

## Why We Built It This Way

**Why DO SQLite for short-term and KV for long-term?**
- Short-term memory is per-agent, per-thread. It lives inside the DO that owns that conversation — no sharing needed, co-located for speed.
- Long-term memory must be shared across agents. When Alice tells the AccountIntelAgent she's "working on the Stripe deal," the EnablementAgent should know that too. DOs can't access each other's SQLite — KV is the shared layer.

**Why temperature 0.1 for extraction?**
- Extraction is a structured task: input conversation → output JSON with facts. You want consistent, deterministic output.
- Higher temperature = more creative = more varied JSON formats = more parse failures.
- 0.1 (not 0) allows tiny variation to prevent the model from getting stuck in loops.

**Why cap at 2 facts per turn and 50 facts per user?**
- 2 per turn: prevents noise accumulation. Most exchanges contain 0-1 memorable facts. Allowing more leads to low-quality extractions.
- 50 per user: KV doesn't have native "get oldest" — we maintain a separate index key. 50 is practical before you'd need pagination or a more sophisticated eviction strategy.
- Only the 10 most recent facts go into the prompt. All 50 are stored but injecting all 50 wastes context window tokens on stale information.

**Why `state.waitUntil()` and not just `await`?**
- If you `await` the extraction, the user waits an extra 2-3 seconds for a second LLM call before seeing their response. Bad UX.
- `waitUntil()` returns the response immediately and does the extraction in the background. The user sees their answer fast; the fact gets saved eventually.
- Without `waitUntil()`, the DO isolate gets recycled after the response — the background work gets killed silently.

---

### Interview Questions — Chapter 6

**Q: Explain the two-tier memory system.**
A: Short-term memory is conversation history stored in each Durable Object's embedded SQLite — per-user, per-agent, last 20 turns. Long-term memory is personal facts stored in Workers KV — per-user, shared across all agents. The split exists because DO SQLite can't be shared across DO classes, but long-term memory needs to be accessible from both the AccountIntelAgent and EnablementAgent.

**Q: What is `state.waitUntil()` and why is it critical?**
A: After a Durable Object returns an HTTP Response, the runtime may recycle the isolate. Any in-flight async work — like the LTM extraction LLM call or the D1 audit log write — gets killed silently. `state.waitUntil(promise)` tells the runtime: keep this isolate alive until this promise settles. Without it, we had a bug where memory extraction was silently failing — no error thrown, facts just never saved.

**Q: How does the memory extraction work?**
A: After every agent response, a second LLM call runs in the background (anchored by `state.waitUntil()`). The prompt asks the model to extract 0-2 personal facts about the user from the conversation exchange. Temperature is 0.1 for consistent JSON output. Facts are stored in KV with a 1-year TTL, capped at 50 per user with FIFO eviction. On the next conversation, the 10 most recent facts are injected into the system prompt as "What I know about you from previous conversations."

**Q: Why not use a database for long-term memory instead of KV?**
A: The access pattern is simple: read all facts for a user, write individual facts. KV is globally distributed and fast for this — sub-10ms reads, no schema to manage. A database (D1, Postgres) would add a network hop, require schema migrations, and be overkill for what's essentially a list of 50 strings per user. KV's eventual consistency is acceptable here — if a fact takes 1 second to propagate globally, that's fine.

---

# Chapter 7 — The Streaming Architecture

## The Concept

### SSE vs WebSockets

**Server-Sent Events (SSE) — what we use:**
- One-directional: server → client only
- Simple: just HTTP with `Content-Type: text/event-stream`
- Auto-reconnects if the connection drops
- Each event is a line starting with `data: `
- Best for: AI token streaming, live feeds, notifications

**WebSockets:**
- Bidirectional: server ↔ client
- More complex: upgrade handshake, frame management, ping/pong
- Doesn't auto-reconnect
- Best for: chat apps, multiplayer games, anything needing client→server messages during the connection

We chose SSE because token streaming is **one-directional** — the server pushes tokens
to the client. The client doesn't need to send messages during the stream. SSE is simpler,
works through proxies and CDNs, and auto-reconnects.

### How Workers AI Streaming Works

When you call `env.AI.run(MODEL, { messages, stream: true })`, Workers AI returns a
`ReadableStream`. Internally, it sends SSE:

```
data: {"response": "Workers"}
data: {"response": " uses"}
data: {"response": " V8"}
data: {"response": " isolates"}
data: [DONE]
```

Each `data:` line contains one token. Your code reads these chunks, parses them,
and re-emits them as your own SSE events to the client.

## What We Built

### The TransformStream pattern — don't buffer, pass through

```javascript
async handleStream(request) {
  const start = Date.now()

  // Parse the request (message, threadId, userContext)
  const { message, threadId, userContext } = await request.json()

  // Build the LLM prompt (same as non-streaming)
  const messages = [systemPrompt, ...history, userMessage]

  // Dispatch tools BEFORE streaming — they feed the prompt
  // Tools MUST complete before the LLM starts generating
  const toolResults = await this.dispatchTools(message, userContext)
  if (toolResults) messages.splice(-1, 0, { role: "system", content: toolResults })

  // Create a TransformStream — a pipe with a writable end and a readable end
  // We write SSE events to the writable end
  // The client reads from the readable end
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  // Helper: send one SSE event
  const sse = (obj) => writer.write(encode("data: " + JSON.stringify(obj) + "\n\n"))

  // Start streaming in the background — NOT awaited
  // This is critical: we return the Response immediately so the client
  // starts receiving events as soon as the first token is generated
  const streamWork = async () => {
    // Tell the client which tools were used (before first token)
    if (toolCalls.length > 0) {
      await sse({ type: "tools", toolsUsed: ["kb_search", "web_search"] })
    }

    // Call Workers AI with stream: true → returns a ReadableStream
    const aiStream = await env.AI.run(MODEL, { messages, stream: true })
    const reader = aiStream.getReader()

    let fullText = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Parse Workers AI's internal SSE format
      const chunk = decode(value)
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue
        if (line.includes("[DONE]")) break

        const token = JSON.parse(line.slice(6)).response
        if (token) {
          fullText += token
          await sse({ type: "token", text: token })  // forward to client
        }
      }
    }

    await sse({ type: "done", latencyMs: Date.now() - start })
    await writer.close()

    // Background work: save memory + audit (waitUntil keeps DO alive)
    this.state.waitUntil(this.saveAndAudit(message, fullText, threadId, userContext))
  }

  streamWork()  // fire and forget — don't await

  // Return the readable end immediately — client starts receiving events
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no"  // tell nginx: don't buffer this response
    }
  })
}
```
`📄 src/agents/base-agent.ts:208-376`

### The SSE event protocol

```
Event 1 (before first token):
  data: {"type":"tools","toolsUsed":["kb_search","web_search"]}
  ← Client shows: "Searching knowledge base..."

Event 2-N (one per token):
  data: {"type":"token","text":"Workers"}
  data: {"type":"token","text":" uses"}
  data: {"type":"token","text":" V8"}
  ← Client appends each token to the response area

Event N+1 (stream complete):
  data: {"type":"done","latencyMs":5381,"toolsUsed":["kb_search"]}
  ← Client shows: "Response complete (5.4s)"

On error:
  data: {"type":"error","message":"Generation failed. Please retry."}
  ← Client shows error state
```

### The Worker passthrough — zero buffering

```javascript
// In the Hono router (index.ts) — the Worker passes the DO's stream
// straight to the client WITHOUT buffering. No intermediate processing.

const doResp = await stub.fetch(new Request("https://do-internal/stream", { ... }))

// Return the DO's ReadableStream directly as the HTTP response body
// This is what makes TTFB (time to first byte) < 100ms
return new Response(doResp.body, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"  // nginx: don't buffer this
  }
})
```
`📄 src/index.ts:250-268`

## Why We Built It This Way

**Why dispatch tools BEFORE streaming instead of letting the LLM call tools?**
- Workers AI (Llama 3.3 70B) doesn't reliably support function calling during streaming
- "Eager dispatch" means tools always run, even when the LLM might not need them. Trade-off: ~500ms extra latency for tool calls vs guaranteed grounded context.
- No round-trips: the LLM generates in one pass with all context present. Function calling would require LLM → tool → LLM round-trips, adding seconds.

**Why `streamWork()` is NOT awaited:**
- If you `await streamWork()`, the Response isn't returned until the entire stream is done — defeating the purpose of streaming.
- By calling `streamWork()` without await, the function starts writing to the `writable` end of the TransformStream while the Response (holding the `readable` end) is returned immediately. Data flows through the pipe as tokens arrive.

**Why `X-Accel-Buffering: no`?**
- If the Worker sits behind an nginx reverse proxy (common in production), nginx will buffer the entire response before sending it to the client. This turns streaming into a single burst — the user waits for everything, then sees it all at once. `X-Accel-Buffering: no` tells nginx to disable this behavior.

---

### Interview Questions — Chapter 7

**Q: How does your streaming architecture work?**
A: I use Server-Sent Events (SSE) over HTTP. When a request comes in, I dispatch tools first (KB search, web search), then call Workers AI with `stream: true`, which returns a `ReadableStream`. I create a `TransformStream` — writing parsed SSE events to the writable end, and returning the readable end as the HTTP response immediately (without awaiting). The client receives three event types: `tools` (before first token — shows what was retrieved), `token` (one per word), and `done` (latency metadata). TTFB is under 100ms because the Worker passes the stream straight through without buffering.

**Q: Why SSE instead of WebSockets?**
A: Token streaming is one-directional — server pushes to client. SSE is simpler (just HTTP, no upgrade handshake), auto-reconnects on connection drop, and works through CDNs and proxies. WebSockets would be needed if the client needed to send messages during the stream — for example, a "stop generating" button. For SE Intel, the client sends one request and receives one stream. SSE is the right tool.

**Q: Why do tools run before the stream starts?**
A: Eager dispatch. Tools (KB search, web search, news) must complete before the LLM starts generating, because their results feed the prompt. This adds ~500ms of latency before the first token, but it means the LLM has all context in one pass — no LLM → tool → LLM round-trips. Workers AI doesn't reliably support function calling during streaming anyway, so this is both a practical necessity and a design choice.

---

# Chapter 8 — The Evaluation Harness

## The Concept

### Why You Can't Use Unit Tests for LLM Quality

Traditional testing: `assert(output === expected)`. This doesn't work for LLMs because:

- There's no single correct answer: "How does Workers compare to Lambda?" has many valid responses
- Quality is subjective: appropriate depth for an SE is different from an AE
- You need to evaluate multiple dimensions: Is it factual? Relevant? Appropriate for the role? Usable in a sales call?

**LLM-as-judge** solves this: a second LLM reads the test case, the response, and a rubric,
then scores the response on specific dimensions.

### The Four Scoring Dimensions

Each dimension catches a **different failure mode**:

| Dimension | What It Catches | Score 0 Example | Score 3 Example |
|-----------|----------------|-----------------|-----------------|
| **Groundedness** | Hallucination | "Workers costs $5/million" (wrong price) | Cites correct pricing from KB |
| **Relevance** | Wrong answer | Responds about CDN when asked about Workers | Directly addresses the question AND the underlying need |
| **Role-appropriateness** | System prompt failure | CLI tutorial for an AE (too technical) | Business framing for AE, technical depth for SE |
| **Actionability** | Unusable output | Academic essay about serverless | Talking points a rep can use in a call TODAY |

**Pass threshold: 8/12.** This means you can score 2/3 on every dimension and still pass.
A 3 means excellent. A 2 means good. A 1 means flawed but acceptable. A 0 means failing.

## What We Built

### The three-script pipeline

```
Step 1: runner.py
  → Loads test cases from cases/*.json
  → Gets a JWT for each role needed
  → Calls the live API for each case
  → Records: response text, latency, tools used, HTTP status
  → Writes: eval/results/run_{timestamp}.json

Step 2: judge.py
  → Reads the raw results file
  → For each case, builds a scoring prompt with the rubric
  → Calls Workers AI REST API (Llama 3.3 70B) as the judge
  → Parses JSON scores, writes them back into the results file
  → Reports: pass/fail per case, pass rate

Step 3: report.py
  → Reads the scored results
  → Aggregates: overall pass rate, per-dimension averages
  → Compares to previous run (regression detection)
```

### The judge prompt — structured scoring

```python
# This is the prompt sent to the judge LLM for each test case

prompt = f"""You are a rigorous evaluator for an AI sales assistant.
Score this response on four dimensions. Be critical — 3 means excellent, not just OK.

=== TEST CASE ===
Agent: {result['agent']}       # "account" or "enablement"
User role: {result['role']}     # "ae", "se", "sales_manager", etc.
Question: {result['input']}     # what the user asked

=== RUBRIC ===
{result['rubric']}              # case-specific evaluation criteria

=== ACTUAL RESPONSE ===
{result['response']}            # what the agent returned

=== SCORING ===
1. GROUNDEDNESS (0-3): Does it cite real products/prices from the KB, or hallucinate?
2. RELEVANCE (0-3): Does it answer what was actually asked?
3. ROLE_APPROPRIATENESS (0-3): Is the depth right for this role?
4. ACTIONABILITY (0-3): Can a sales rep use this in a customer call today?

Return ONLY valid JSON:
{{"groundedness": 2, "relevance": 3, "role_appropriateness": 2, "actionability": 3,
  "total": 10, "passed": true, "reasoning": "Explanation..."}}"""
```
`📄 evaluation-harness/eval/judge.py:67-134`

### Paired test cases — the clever design

```json
// cases/account-intel.json

// acc-001: SE asking for competitive positioning
{
  "id": "acc-001",
  "agent": "account",
  "role": "se",
  "input": "Research Stripe. What's their tech stack and our competitive angle?",
  "rubric": "Should include specific technical differentiators..."
}

// acc-006: AE asking the SAME QUESTION
{
  "id": "acc-006",
  "agent": "account",
  "role": "ae",
  "input": "Research Stripe. What's their tech stack and our competitive angle?",
  "rubric": "Should focus on business outcomes, NOT technical implementation..."
}

// These two cases test:
// 1. Does RBAC work? (AE shouldn't get se_only KB content)
// 2. Is the system prompt calibrated? (AE answer should be business-focused)
// 3. The judge penalizes technical deep-dives for AEs
//    and shallow business-speak for SEs
```

### Score progression — what changed each iteration

```
Iteration 1: 67% pass rate (10/15 cases passed)
  Problem: Groundedness failures — agent was giving vague competitive claims
           like "Cloudflare is better" instead of specific facts
  Fix:     Added CRITICAL RULE to system prompt:
           "Use the specific facts from [Tool Results] — named products,
            specific features, real pricing. Do not give vague statements."

Iteration 2: 73% pass rate (11/15 cases passed)
  Problem: Role-appropriateness failures — manager role getting product education
           instead of deal strategy
  Fix:     Added role-specific DEPTH RULE:
           "Manager role: lead with specific actions to unstick a deal,
            not with product education. Keep product explanation to 1 sentence."

Iteration 3: 87% pass rate (13/15 cases passed)
  Problem: Two remaining failures are edge cases — very short queries that
           don't trigger the right tools
  Status:  Acceptable for v1. The two failures are documented.
```

## Why We Built It This Way

**Why LLM-as-judge instead of human evaluation?**
- Speed: 15 test cases scored in ~3 minutes. Human scoring takes 30+ minutes.
- Consistency: the same rubric + low temperature (0.1) produces consistent scores across runs.
- Regression detection: you can re-run the harness after every prompt change to see if scores improved or regressed.
- Trade-off: self-grading bias (using the same model as agent and judge).

**Why these 4 dimensions?**
- Each one catches a different class of failure. Groundedness catches hallucination. Relevance catches wrong-topic answers. Role-appropriateness catches system prompt bugs. Actionability is the business metric — can someone actually use this?
- If you only had one score ("quality 0-10"), you wouldn't know WHERE the failure is. Is it hallucinating? Or is it accurate but wrong depth? The 4 dimensions tell you.

**Why 8/12 as the pass threshold?**
- 8/12 means you can score 2 (good) on every dimension and pass. A 2 means "good with minor issues."
- Lower threshold (6/12) would pass responses that are barely acceptable on most dimensions.
- Higher threshold (10/12) would fail responses that are genuinely useful but not perfect.

### The Self-Grading Bias Problem

The agent uses Llama 3.3 70B. The judge also uses Llama 3.3 70B. This is a known problem:

```
Agent generates response in style X (how Llama "thinks")
Judge evaluates response → recognizes style X as natural → gives higher scores
Result: inflated scores that don't reflect real quality

Fix: Use a DIFFERENT model as judge (e.g., Claude via Anthropic API)
     A different model applies different standards → more honest evaluation
```

This is documented in the README as a known limitation and planned improvement.

---

### Interview Questions — Chapter 8

**Q: How do you evaluate the quality of your AI agents?**
A: LLM-as-judge. A Python eval harness runs 15 test cases against the live API, then sends each response to a second LLM call with a structured scoring prompt. The judge scores 4 dimensions (0-3 each): groundedness, relevance, role-appropriateness, and actionability. Pass threshold is 8/12. I run this after every prompt change to detect regressions. Score progression: 67% → 73% → 87% across 3 iterations.

**Q: What are the 4 evaluation dimensions and why those specific ones?**
A: Each catches a different failure mode. Groundedness catches hallucination — the most dangerous failure for a sales tool. Relevance catches answering the wrong question. Role-appropriateness catches system prompt calibration failures — like giving a CLI tutorial to an Account Executive. Actionability is the business test — can a rep use this verbatim in a customer call today? If you only had a single "quality" score, you wouldn't know where the problem is.

**Q: What is self-grading bias and how would you fix it?**
A: When the same model generates responses and judges them, the judge is biased toward responses that match its own style. Llama 3.3 70B evaluating Llama 3.3 70B will give higher scores than an independent evaluator would. The fix: use a different model as judge — Claude via the Anthropic API. Different training data and style means more honest evaluation. This is a known limitation I documented and planned to address.

**Q: How did you improve from 67% to 87% pass rate?**
A: Iteration-driven prompt engineering. At 67%, the main failure was groundedness — the agent gave vague competitive claims. I added a "CRITICAL RULE" to the system prompt requiring specific facts from the KB. That got us to 73%. The next failure was role-appropriateness — the manager role got product education instead of deal strategy. I added role-specific DEPTH RULES to the prompt. That got us to 87%. The two remaining failures are documented edge cases with very short queries.

---

# Chapter 9 — The MCP Server

## The Concept

### What is MCP?

**Model Context Protocol (MCP)** is an open standard created by Anthropic for connecting
LLM clients (like Claude Desktop, Cursor, Continue.dev) to external tools and data sources.

Before MCP, every AI tool integration was custom — different APIs, different auth, different
formats. MCP standardizes it:

```
Without MCP:
  Claude Desktop → custom plugin → your API
  Cursor         → different custom plugin → your API
  Continue.dev   → yet another plugin → your API
  (3 integrations to maintain)

With MCP:
  Claude Desktop → MCP protocol → your MCP server → your API
  Cursor         → MCP protocol → your MCP server → your API
  Continue.dev   → MCP protocol → your MCP server → your API
  (1 server, all clients work automatically)
```

### How MCP Works

MCP uses **stdio transport** — JSON-RPC messages over stdin/stdout:

```
Claude Desktop                    MCP Server (Node.js process)
     |                                 |
     | --- stdin: "list tools" ------> |
     |                                 | → returns tool schemas
     | <-- stdout: [research_account,  |
     |              get_enablement,    |
     |              get_memory]        |
     |                                 |
     | --- stdin: "call research_account |
     |     with {company: 'Stripe'}" --> |
     |                                 | → calls SE Intel API over HTTPS
     |                                 | ← gets response from Workers
     | <-- stdout: "Stripe uses..."    |
```

Claude Desktop starts the MCP server as a child process. Communication happens through
stdin/stdout pipes. No HTTP server needed — it's process-to-process.

## What We Built

### A thin bridge — all intelligence stays in the Worker

```javascript
// The MCP server is ~300 lines. It does THREE things:
// 1. Gets a JWT from the SE Intel Worker
// 2. Forwards tool calls to the Worker API
// 3. Returns the response in MCP format
// ALL intelligence (RAG, streaming, memory, RBAC) lives in the Worker.

const server = new McpServer({ name: "se-intel", version: "1.0.0" })

// Register a tool — Zod schema defines the parameters Claude Desktop sees
server.registerTool("research_account", {
  description: "Research a prospect company for a pre-call brief...",
  inputSchema: {
    company: z.string().describe("Company name or tech stack description"),
    role: z.enum(["ae", "se", "csm", "tam", "sales_manager"]).default("se"),
    threadId: z.string().optional()
  }
}, async ({ company, role, threadId }) => {
  // Get a JWT (cached per role — don't fetch a new one every call)
  const token = await getToken(role)

  // Call the SE Intel Worker — the exact same API the web UI uses
  const resp = await fetch(`${BASE_URL}/api/v1/account`, {
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: company, threadId })
  })

  const data = await resp.json()
  return { content: [{ type: "text", text: data.response }] }
})
```
`📄 projects/se-intel-mcp/src/index.ts:131-175`

### Token caching — don't re-authenticate every call

```javascript
// Simple cache: one token per role
let cachedToken = null
let tokenRole = null

async function getToken(role) {
  // Reuse if role hasn't changed
  if (cachedToken && tokenRole === role) return cachedToken

  // Otherwise, get a fresh token from the Worker's /dev/token endpoint
  const resp = await fetch(`${BASE_URL}/dev/token`, {
    method: "POST",
    body: JSON.stringify({ userId: `mcp-${role}-${Date.now()}`, role, name: "MCP User" })
  })
  const data = await resp.json()

  cachedToken = data.token
  tokenRole = role
  return cachedToken
}
```
`📄 projects/se-intel-mcp/src/index.ts:42-69`

## Why We Built It This Way

**Why a thin bridge instead of putting agent logic in the MCP server?**
- Single source of truth: all RAG, RBAC, streaming, memory logic lives in the Worker. The MCP server is just a protocol adapter.
- If you update the Worker (new KB chunks, new prompt), the MCP server picks it up automatically — no MCP server redeployment needed.
- The same Worker serves the web UI, the REST API, and the MCP server. One codebase, three interfaces.

**Why stdio transport instead of HTTP?**
- MCP clients (Claude Desktop) expect stdio — they start the server as a child process and communicate over stdin/stdout pipes.
- No port conflicts, no CORS, no firewall issues. The server is local to the client machine.
- HTTP transport exists in MCP but is primarily for remote servers. For local tools, stdio is the standard.

### Current Status

Built and compiled. `build/index.js` exists. The README has the Claude Desktop config.
**Not yet connected** — the `claude_desktop_config.json` edit hasn't been made. This is
a 5-minute task: paste the config, restart Claude Desktop, verify tools appear.

---

### Interview Questions — Chapter 9

**Q: What is MCP and why did you build an MCP server?**
A: Model Context Protocol is an open standard from Anthropic for exposing tools to LLM clients. I built an MCP server so SE Intel's agents are accessible from Claude Desktop, Cursor, and any MCP-compatible client — not just the web UI. The server is a thin bridge: it handles MCP protocol (JSON-RPC over stdio), token management, and error formatting. All intelligence (RAG, memory, RBAC) stays in the Cloudflare Worker.

**Q: How does the MCP server communicate with Claude Desktop?**
A: stdio transport. Claude Desktop starts the MCP server as a child process. Communication happens over stdin/stdout pipes using JSON-RPC. The client sends tool discovery requests and tool call requests. The server responds with tool schemas and results. No HTTP server, no ports, no CORS. When the user closes Claude Desktop, the child process dies.

**Q: Why is the MCP server a "thin bridge" instead of a full agent?**
A: Single source of truth. All RAG, RBAC, streaming, and memory logic lives in the Cloudflare Worker. The MCP server just converts MCP protocol to HTTP calls against the Worker API. If I update the Worker (new KB content, better prompts), the MCP server picks it up automatically with zero redeployment. Same Worker, three interfaces: web UI, REST API, and MCP.

---

# Chapter 10 — Failure Modes and Trade-offs

This chapter is pure interview prep. Study this as a table, then practice answering
"what happens when X fails?" from memory.

## Component Failure Map

| Component | What Can Fail | What Happens | User Impact | How to Fix |
|-----------|--------------|--------------|-------------|-----------|
| **Vectorize** | Index unavailable or query timeout | `kbSearch()` returns null | Agent falls back to web search, then training data. Response less grounded. | Retry with exponential backoff. Circuit breaker after 3 failures. |
| **Workers AI** | Model timeout (>30s) or 500 error | Non-streaming: error response returned. Streaming: `{type: "error"}` SSE event sent. | User sees "Generation failed. Please retry." | Client retries with same `threadId` (conversation context preserved). |
| **KV (rate limit)** | Eventually consistent reads | Two concurrent requests both read count=19, both succeed. 21 requests allowed instead of 20. | Slight over-limit. No user impact. | Replace with DO-based counter for exact enforcement. Acceptable trade-off for this use case. |
| **KV (long-term memory)** | Eventually consistent propagation | Fact saved in one region not immediately visible in another. | User says "you should remember X" — agent might not see it for 1-2 seconds. | Acceptable. LTM is best-effort. User's next request will see it. |
| **DO SQLite** | DO evicted from memory | SQLite data persists — it's durable. DO reloads state on next request. | Slight latency increase on first request after eviction (~50ms). No data loss. | No action needed. This is designed behavior. |
| **JWT secret rotated** | All existing tokens become invalid | All authenticated requests fail with 401. | Users must re-authenticate. | `/dev/token` issues new tokens. In production, Cloudflare Access handles this transparently. |
| **D1 (audit log)** | Database write fails | `writeAuditEvent()` is wrapped in `.catch()` — error logged, not thrown. | Zero user impact. Audit gap for that request. | Audit writes are fire-and-forget by design. Alert on error rate, batch-retry from logs. |
| **News API** | External API down or rate limited | `fetchNews()` returns null. Agent skips news context. | Response missing recent news. KB and web search still work. | Graceful degradation by design. No single tool failure blocks the response. |
| **LTM extraction** | LLM returns invalid JSON or fails | `extractAndRemember()` is wrapped in `.catch()` — error logged, silently ignored. | Fact not saved for this turn. Future turns still work. | Best-effort by design. One missed extraction is acceptable. |

## Design Trade-offs — When You'd Choose Differently

| Decision We Made | Trade-off Accepted | When We'd Choose Differently |
|-----------------|-------------------|------------------------------|
| **Eager tool dispatch** (tools before LLM) | ~500ms extra latency even when tools aren't needed | If Workers AI supported reliable function calling in streaming mode |
| **Same model as agent and judge** | Self-grading bias inflates eval scores | For production evals: Claude as judge via Anthropic API |
| **KV for rate limiting** | Eventual consistency allows slight over-count | For billing-critical APIs: DO-based counter |
| **One Vectorize index with namespace filters** | A filter bug could expose wrong-namespace data | For regulated data (PII, financial): separate indexes per access level |
| **HS256 symmetric JWT** | Secret must be shared between issuer and verifier | For multi-service architectures: RS256 (asymmetric) — public key verification without sharing the private key |
| **20-turn conversation limit** | Older context is lost | For long-running research sessions: summarize old turns instead of deleting them |
| **50-fact LTM limit with FIFO** | Old facts evicted even if still relevant | For power users: importance-weighted eviction or user-managed fact lists |

---

### Interview Questions — Chapter 10

**Q: What happens if Vectorize goes down?**
A: The `kbSearch()` function returns null. The AccountIntelAgent falls back to web search (DuckDuckGo). The EnablementAgent attempts web search with a "Cloudflare" prefix. If that also fails, the LLM answers from training data, but the system prompt instructs it to flag when it's not grounding in specific sources. No single tool failure blocks the response — that's graceful degradation by design.

**Q: What's the biggest weakness in your system?**
A: Self-grading bias in the eval harness. The agent and the judge both use Llama 3.3 70B. The judge is biased toward responses that match its own style, so eval scores are likely inflated compared to what a human or independent model would score. The fix is straightforward — use Claude as the judge via the Anthropic API — but I haven't implemented it yet.

**Q: Your rate limiter uses KV, which is eventually consistent. Is that a problem?**
A: For this use case, no. Eventual consistency means two concurrent requests might both succeed when only one should, resulting in 21 requests instead of the 20-per-minute limit. That's a guardrail, not a billing meter. For a payment API or a metered billing endpoint, I'd replace KV with a Durable Object counter — DOs guarantee serial execution, so the count is always exact.

**Q: What would you change if you rebuilt this from scratch?**
A: Four things. (1) Use a different model as eval judge (Claude via Anthropic API) to eliminate self-grading bias. (2) Add reranking — a cross-encoder pass after Vectorize retrieval to improve chunk relevance for short queries. (3) Summarize old conversation turns instead of deleting them — preserves context for long research sessions. (4) Make the LTM extraction prompt more aggressive on deal context — it's currently too conservative and misses useful information like deal size and timeline.

---

# Chapter 11 — The Behavioral Story

This chapter is not about technology. It's about how to **tell the story** of what
you built in an interview.

## The 60-Second Pitch

> "I built a multi-agent intelligence platform for sales teams on Cloudflare's edge network.
> Three AI agents — account research, sales coaching, and transcript analysis — each running
> as a Durable Object with per-user conversation history and role-based access control.
> The system uses RAG with a curated knowledge base, streaming SSE for real-time token delivery,
> and a two-tier memory system that extracts personal facts from conversations and remembers
> them across sessions. I built an eval harness with LLM-as-judge scoring that improved
> pass rates from 67% to 87% across three prompt engineering iterations. It's deployed
> live on Cloudflare Workers at zero infrastructure cost."

Use this when someone asks "what have you built recently?" or "tell me about a project."

## The 5-Minute Deep Dive

Use this when an interviewer says "walk me through the architecture":

**Minute 1 — The problem:**
"Sales reps waste 30-60 minutes per call doing manual research. They search the web,
check Salesforce, review competitor docs, and still miss things. I built an AI system
that does this in seconds, grounded in a curated knowledge base so it doesn't hallucinate."

**Minute 2 — The architecture:**
"Three agents, each a Durable Object. A Hono router handles JWT auth and rate limiting,
then dispatches to the right DO. Each DO has embedded SQLite for conversation history.
Tools — KB search via Vectorize, web search, news API — run before the LLM generates.
Results stream back as SSE events."

**Minute 3 — The hard problem you solved:**
"The hardest problem was the two-tier memory system. Short-term memory (conversation history)
lives in DO SQLite because it needs serialized access. But long-term memory (user facts)
needs to be shared across agents — and DOs can't access each other's storage. So long-term
memory lives in KV. After every response, a background LLM call extracts personal facts and
saves them. I hit a real bug where the DO isolate was getting recycled before the extraction
finished — `state.waitUntil()` was the fix."

**Minute 4 — The eval story:**
"I built a Python eval harness with LLM-as-judge scoring. Four dimensions: groundedness,
relevance, role-appropriateness, and actionability. Started at 67% pass rate. The main
failure was groundedness — vague competitive claims instead of specific product facts.
After three prompt engineering iterations, got to 87%. I know there's self-grading bias
because the agent and judge use the same model — Claude as judge is the planned fix."

**Minute 5 — What you'd change:**
"Add reranking after Vectorize retrieval, use Claude as the eval judge, and summarize
old conversation turns instead of deleting them. I also built an MCP server that exposes
these agents as tools for Claude Desktop — it's protocol-verified but not yet connected."

## Mapping Chapters to Anthropic Screening Questions

**"Have you personally built and deployed a production LLM-powered application?"**
→ Chapters 2, 5, 6, 7. Deployed at `se-intel-portfolio.stephenmack96.workers.dev`.
Three agents, real auth, real rate limiting, real audit trails. Not a demo.

**"Have you built AI agents with tool use capabilities?"**
→ Chapters 5, 7. AccountIntelAgent dispatches 3 tools (news, KB search, web search)
based on message intent. Tool results injected into context before LLM generation.
Tool calls recorded in audit log. RBAC enforced at tool execution time.

**"Describe experience with LLMs creating complex or interactive functionality."**
→ Chapters 5, 6, 7, 8. Multi-agent system with streaming delivery, cross-session
memory, role-calibrated prompts, and an eval harness with score progression.

**"Do you have expertise coding in Python?"**
→ Chapter 8. The eval harness is Python — runner.py, judge.py, report.py.
Uses httpx, dotenv, argparse. Calls the Workers AI REST API directly.

**"Do you have experience working with startup engineering teams?"**
→ Chapter 11 (your current SE role). You build and demo prototypes for startups daily.
SE Intel is the AI specialization on top of that experience.

## The "What I'd Change" Answers

These show self-awareness. Interviewers love when you can critique your own work:

1. **Reranking:** A cross-encoder pass after Vectorize retrieval. At 102 chunks it's not critical, but at 1,000+ chunks, short queries would return more relevant results with reranking.

2. **Claude as eval judge:** Eliminates the self-grading bias from using the same model as agent and judge. Different model = more honest evaluation.

3. **Conversation summarization:** Instead of deleting messages beyond the 20-turn limit, summarize them into a 2-3 sentence recap. Preserves context for long research sessions.

4. **LTM extraction tuning:** The extraction prompt is too conservative on deal context. Adding explicit examples of deal-related facts would improve recall.

---

## Daily Study Schedule

| Day | Chapter | Time | Focus |
|-----|---------|------|-------|
| Day 1 | Chapter 1 — The Problem | 20 min | Understand the 5 hard problems |
| Day 2 | Chapter 2 — Workers + DOs | 30 min | Race condition scenario, DO lifecycle |
| Day 3 | Chapter 3 — Auth | 30 min | JWT anatomy, WebCrypto, defense in depth |
| Day 4 | Chapter 4 — Rate Limiter | 20 min | Sliding window vs fixed window vs token bucket |
| Day 5 | Chapter 5 — RAG | 30 min | Embedding pipeline, cosine similarity, RBAC |
| Day 6 | Chapter 6 — Memory | 30 min | Two-tier split, waitUntil bug, extraction prompt |
| Day 7 | Chapter 7 — Streaming | 30 min | TransformStream, SSE events, eager dispatch |
| Day 8 | Chapter 8 — Evals | 30 min | 4 dimensions, self-grading bias, score progression |
| Day 9 | Chapter 9 — MCP | 20 min | Protocol, stdio, thin bridge pattern |
| Day 10 | Chapter 10 — Failure Modes | 30 min | Component failure map, trade-offs table |
| Day 11 | Chapter 11 — Behavioral | 20 min | 60s pitch, 5min deep dive, screening answers |
| Day 12+ | Review | 20 min | Re-read interview questions, practice answers aloud |

---

*Built by studying the code at `/Users/smack/ai-dev/projects/se-intel/`.
Every concept explained through what we actually built — not abstract theory.*
