# Module 10.2 — AI Gateway
> Dashboard Location: Account Home → AI → AI Gateway | Estimated Time: 75 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

AI Gateway is a proxy layer that sits between your application and any AI provider — OpenAI, Anthropic, Cohere, HuggingFace, Workers AI, Mistral, Azure OpenAI, Google Vertex, and others. Instead of calling the provider's API directly, you route every request through a Cloudflare endpoint first.

**Why this matters for your customers:**

Most companies calling LLM APIs have no centralized visibility into what's being sent, what it costs, or whether the same prompt is being run 500 times per day. AI Gateway solves this immediately, without changing your application logic — just swap one URL.

**Core value propositions:**
1. **Unified observability** — see every prompt, completion, token count, latency, and cost in one dashboard regardless of provider
2. **Semantic caching** — cache similar (not just identical) prompts using cosine similarity; dramatically reduces cost for repetitive queries
3. **Rate limiting** — protect your AI budget from runaway scripts or abusive users
4. **Cost analytics** — track spend per provider, per model, over time; catch billing surprises before they hit your card
5. **Fallback routing** — if OpenAI returns a 429 or 5xx, automatically retry with Anthropic or Workers AI
6. **Streaming support** — SSE/chunked responses work transparently through the gateway

**Who buys this:** Any developer or enterprise calling LLM APIs. The typical "aha moment" is showing a customer their monthly OpenAI bill and then showing the same workload with 40% cache hit rate.

---

## Deep Dive (Architect-Level)

### How the Request Flow Works

```
Your App
   │
   │  POST https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_name}/openai
   │  Authorization: Bearer YOUR_OPENAI_KEY (forwarded unchanged)
   ▼
Cloudflare AI Gateway Edge Node (nearest PoP)
   │
   ├─ Log request metadata (timestamp, prompt hash, model, token estimate)
   ├─ Check semantic cache (if enabled): cosine similarity against cached prompts
   │     ├─ Cache HIT → return cached response immediately (no provider call)
   │     └─ Cache MISS → continue
   ├─ Apply rate limit policy (count per IP, per custom key, per minute/hour)
   │     └─ Limit exceeded → return 429
   ├─ Forward request to target provider (OpenAI, Anthropic, etc.)
   │     └─ Provider error (5xx, 429) → check fallback chain
   ├─ Log response metadata (tokens used, latency, cost estimate)
   └─ Return response to your app (streaming supported via SSE pass-through)
```

### Semantic Caching Architecture

Traditional caching: exact string match on the prompt. Semantic caching: embed both the incoming prompt and all cached prompts, then return a cached response if cosine similarity exceeds a configurable threshold (default ~0.95).

- Embedding model runs inside Cloudflare (low latency, no external call)
- Cache TTL is configurable (default 4 hours)
- Cache key includes: model name, prompt text
- System prompts and temperature settings are included in cache key by default (configurable)
- Cache can be purged via API or dashboard

This means: "What's the capital of France?" and "Tell me the capital city of France" can hit the same cache entry.

### Fallback Chain Configuration

```json
{
  "strategy": "sequential",
  "providers": [
    { "provider": "openai", "model": "gpt-4o" },
    { "provider": "anthropic", "model": "claude-3-5-sonnet-20241022" },
    { "provider": "workers-ai", "model": "@cf/meta/llama-3.3-70b-instruct" }
  ]
}
```

Fallback triggers on: 429 (rate limit), 5xx (server errors), timeout. It does NOT trigger on 4xx (bad request — those are your problem, not the provider's).

### Workers AI Integration

When your Worker uses the `env.AI` binding, it automatically routes through any AI Gateway you've configured in your account — no URL change needed:

```toml
# wrangler.toml
[ai]
binding = "AI"

# Optional: bind to specific gateway
[ai]
binding = "AI"
gateway = { id = "my-gateway-name" }
```

### Token Cost Estimation

AI Gateway uses a token estimation model to calculate costs before the provider responds (since token counts aren't known until after completion). The estimate shown in real-time metrics is a pre-response estimate; exact counts are logged post-response.

### Privacy Mode

For sensitive applications (healthcare, legal, PII-heavy), you can disable prompt/response logging while retaining aggregate metrics (token counts, latency, costs). This is a per-gateway toggle.

---

## Dashboard Walkthrough

**Step 1: Create a Gateway**
1. Navigate to Account Home → AI → AI Gateway
2. Click "Create Gateway"
3. Name it (e.g., `macksportreport-ai`)
4. Note your gateway URL: `https://gateway.ai.cloudflare.com/v1/{account_id}/macksportreport-ai/`

**Step 2: Explore the Analytics Tab**
- Requests over time (line chart)
- Token usage by model
- Cost breakdown by provider
- Cache hit rate
- Error rate by provider
- P50/P95/P99 latency

**Step 3: Configure Caching**
1. Click the gateway → Settings
2. Toggle "Cache Responses" → ON
3. Set cache TTL (default 4h, recommend 1h for dynamic use cases)
4. Set similarity threshold (0.9 = aggressive, 0.99 = conservative)

**Step 4: Configure Rate Limiting**
1. Settings → Rate Limiting
2. Set: 100 requests/minute per IP (example)
3. Or use a custom key: `cf-aig-custom-cost` header for per-user limits

**Step 5: Set Up Fallback**
1. Settings → Fallback
2. Add providers in priority order
3. Select which HTTP status codes trigger fallback

**Step 6: Review Logs**
1. Click "Logs" tab
2. Each row: timestamp, provider, model, prompt (first 100 chars), tokens, latency, cost, cache status
3. Click a row to expand full prompt and response

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ACCOUNT_ID="your-account-id"
export GATEWAY_NAME="macksportreport-ai"
export OPENAI_API_KEY="sk-your-openai-key"
export CF_API_TOKEN="your-cf-api-token"
```

### Lab 1: Create a Gateway via API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai-gateway/gateways" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "macksportreport-ai",
    "slug": "macksportreport-ai",
    "cache_invalidate_on_update": false,
    "cache_ttl": 14400,
    "collect_logs": true,
    "rate_limiting_interval": 60,
    "rate_limiting_limit": 100,
    "rate_limiting_technique": "fixed"
  }'
```

### Lab 2: Call OpenAI Through AI Gateway
```bash
# Instead of: https://api.openai.com/v1/chat/completions
# Use: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_name}/openai/chat/completions

curl -X POST "https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${GATEWAY_NAME}/openai/chat/completions" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -H "Content-Type: application/json" \
  --data '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "What is the Cloudflare edge network?"}
    ],
    "max_tokens": 200
  }'
```

### Lab 3: Call Anthropic Through AI Gateway
```bash
export ANTHROPIC_API_KEY="sk-ant-your-key"

curl -X POST "https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${GATEWAY_NAME}/anthropic/v1/messages" \
  -H "Authorization: Bearer ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  --data '{
    "model": "claude-3-haiku-20240307",
    "max_tokens": 200,
    "messages": [
      {"role": "user", "content": "What is the Cloudflare edge network?"}
    ]
  }'
```

### Lab 4: Test Semantic Cache
```bash
# First call — cache MISS
curl -s -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
  -X POST "https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${GATEWAY_NAME}/openai/chat/completions" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -H "Content-Type: application/json" \
  --data '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"What is the capital of France?"}]}'

# Second call — semantically similar, should be cache HIT
curl -s -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
  -X POST "https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${GATEWAY_NAME}/openai/chat/completions" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -H "Content-Type: application/json" \
  --data '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Tell me the capital city of France."}]}'

# Check response headers for: cf-aig-cache-status: HIT or MISS
```

### Lab 5: Workers AI via AI Gateway Binding
```typescript
// src/index.ts
interface Env {
  AI: Ai;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What are the benefits of edge computing?' }
      ]
    });

    return Response.json(response);
  }
} satisfies ExportedHandler<Env>;
```

```toml
# wrangler.toml
name = "ai-gateway-demo"
main = "src/index.ts"
compatibility_date = "2024-11-01"

[ai]
binding = "AI"
gateway = { id = "macksportreport-ai" }
```

### Lab 6: Retrieve Logs via API
```bash
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai-gateway/gateways/${GATEWAY_NAME}/logs?limit=10" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

---

## Demo Script (2 Minutes)

**Audience:** Developer or startup CTO considering OpenAI spend optimization

**Opening (20 seconds):**
"You're paying for OpenAI and you have no idea what your app is actually sending. Let me show you how to fix that in two minutes."

**Act 1 — Show the dashboard (30 seconds):**
"This is AI Gateway. Every LLM call your app makes shows up here — the full prompt, the response, the token count, the cost, and the latency. OpenAI, Anthropic, your own models — all in one place."

**Act 2 — Show caching (30 seconds):**
"Watch this. I'm going to send a question twice — slightly different wording. [Run Lab 4 commands live.] The second one came back in 12 milliseconds and cost nothing. That's semantic caching. Your docs chatbot? Probably 60% cache-able."

**Act 3 — Show fallback (20 seconds):**
"If OpenAI goes down — and it does — this fallback chain automatically tries Anthropic, then your Workers AI model. Your app never sees the error."

**Close (20 seconds):**
"This is free to use. You just change one URL. Who handles your AI infrastructure decisions — is it you or your team?"

---

## Competitive Context

| Feature | Cloudflare AI Gateway | AWS Bedrock Gateway | LangSmith | Portkey | Helicone |
|---|---|---|---|---|---|
| **Provider support** | 15+ (OpenAI, Anthropic, CF, GCP, Azure, etc.) | AWS Bedrock models only | OpenAI/Anthropic focused | 250+ | 30+ |
| **Semantic caching** | Yes (configurable threshold) | No | No | Yes | Yes |
| **Fallback routing** | Yes (sequential/random) | No native | No | Yes | No |
| **Rate limiting** | Yes (per IP, custom key) | IAM-based only | No | Yes | Limited |
| **Log retention** | Configurable (up to 7 days dashboard) | CloudWatch (paid) | 30 days | 30 days | 30 days |
| **Streaming support** | Yes (SSE pass-through) | Yes | Yes | Yes | Yes |
| **Cost** | Free (included with Workers) | Free, but egress costs | $20/month+ | $49/month+ | Free tier, paid |
| **Workers AI integration** | Native binding (no URL change) | No | No | No | No |
| **Edge deployment** | Yes (300+ PoP locations) | Specific regions | Single region | Single region | Single region |
| **Privacy/no-log mode** | Yes (toggle per gateway) | Partial | No | Yes | Limited |

**Positioning:** AI Gateway is the only solution where your caching, routing, and observability infrastructure runs at the same global edge as your Workers application — no round-trip to a centralized service. For latency-sensitive applications, this is a meaningful architectural advantage.

---

## Self-Check Questions

**Question 1:** A customer's chatbot sends the same "how do I reset my password" question 10,000 times per day. How would AI Gateway semantic caching help, and what setting would you tune to maximize savings without sacrificing answer quality?

```
Your answer:




```

**Question 2:** Explain the difference between the AI Gateway URL for OpenAI vs the URL for Anthropic. What part of the URL is identical and what part changes?

```
Your answer:




```

**Question 3:** A customer asks: "What happens to my requests if Cloudflare's AI Gateway has an outage?" How do you answer this, and what fallback configuration would you recommend?

```
Your answer:




```

**Question 4:** A healthcare company wants unified AI observability but cannot log patient-related prompts due to HIPAA. Can they use AI Gateway? What specific setting do they need?

```
Your answer:




```

**Question 5:** A customer is currently using Helicone for $49/month. Make the case for switching to AI Gateway. What three advantages would you lead with?

```
Your answer:




```

---

## Sources

- [Cloudflare AI Gateway Documentation](https://developers.cloudflare.com/ai-gateway/)
- [AI Gateway Supported Providers](https://developers.cloudflare.com/ai-gateway/providers/)
- [AI Gateway Caching](https://developers.cloudflare.com/ai-gateway/configuration/caching/)
- [AI Gateway Rate Limiting](https://developers.cloudflare.com/ai-gateway/configuration/rate-limiting/)
- [AI Gateway Fallback](https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/)
- [Workers AI Bindings with AI Gateway](https://developers.cloudflare.com/workers-ai/configuration/ai-gateway/)
- [Cloudflare Blog: Introducing AI Gateway](https://blog.cloudflare.com/announcing-ai-gateway/)
- [Attention Is All You Need (Transformer architecture)](https://arxiv.org/abs/1706.03762)
