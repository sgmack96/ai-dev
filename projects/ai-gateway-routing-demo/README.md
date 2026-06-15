# AI Gateway Dynamic Routing Demo Lab

**Concept:** Metadata-driven model routing for enterprise engineering teams.  
**Approach:** Documentation-first proof of concept — run it with cURL, understand it from the dashboard.  
**Time to demo:** ~15 minutes end-to-end.

---

## The Problem

Engineering teams use AI for many different workflows. Not all of them need a frontier model.

| Workflow | Current behavior | What it should be |
|---|---|---|
| Code review | GPT-4.1 every time | GPT-4.1 — reasoning matters |
| Meeting prep | GPT-4.1 every time | GPT-4o-mini — summarization is cheap |
| Incident triage | GPT-4.1 every time | GPT-4.1 — accuracy matters |
| Slack summary | GPT-4.1 every time | Llama 8B — nobody's life depends on it |

Without routing, you pay frontier prices for every request. The delta between GPT-4.1 and GPT-4o-mini is roughly **30x on output tokens**. For summarization tasks that make up the majority of daily AI usage, that's pure waste.

### The Current Alternative: Hardcode It in Application Code

This project started from the Golf Betting Agent's `gateway.js`:

```javascript
// gateway.js — before
getRoutingConfig(taskType) {
  const configs = {
    'intent-classification': { model: '@cf/meta/llama-3.1-8b-instruct' },
    'betting-sheet':         { model: '@cf/meta/llama-3.1-70b-instruct' },
    'complex-analysis':      { model: '@cf/meta/llama-3.1-70b-instruct' },
  };
  return configs[taskType] || configs['intent-classification'];
}
```

This works, but:
- Routing logic is buried in application code
- Changing which model handles what requires a redeployment
- No budget enforcement — spend is uncapped
- No dashboard visibility into cost per workflow
- No fallback chain if a model fails

**AI Gateway Dynamic Routes solves all of this without touching application code.**

---

## The Solution

Pass a `cf-aig-metadata` header with every AI request tagging the workflow type, team, and user. A Dynamic Route in AI Gateway evaluates that metadata and routes to the appropriate model — with budget limits and fallback chains — entirely in configuration.

```
Your App
  │
  │  POST /chat/completions
  │  model: "dynamic/engineering"
  │  cf-aig-metadata: { "team": "eng", "workflow": "code_review", "userId": "smack" }
  │
  ▼
AI Gateway: dynamic/engineering route
  │
  ├─ workflow == "code_review"     → OpenAI gpt-4.1         ($0.030/1K out)
  ├─ workflow == "meeting_prep"    → OpenAI gpt-4o-mini      ($0.001/1K out)
  ├─ workflow == "incident_triage" → OpenAI gpt-4.1         ($0.030/1K out)
  ├─ workflow == "slack_summary"   → Workers AI llama-3.1-8b ($0.00001/1K out)
  └─ [over budget]                 → OpenAI gpt-4o-mini (graceful degradation)
```

The application sends one header. All routing logic lives in the dashboard.

---

## Prerequisites

- Cloudflare account with AI Gateway enabled
- OpenAI API key (stored as BYOK in AI Gateway)
- Workers AI enabled (no BYOK needed — billed to your Cloudflare account)
- AI Gateway authentication turned on (required for Dynamic Routes)

---

## Step 1 — Store Provider Keys (BYOK)

In the AI Gateway dashboard:

1. Go to your gateway → **Settings** → **Provider Keys**
2. Add OpenAI key: name it `openai-key`, paste your `sk-...` key
3. Workers AI uses your Cloudflare account automatically — no key needed

---

## Step 2 — Create the Dynamic Route

In the AI Gateway dashboard:

1. Go to your gateway → **Dynamic Routes** → **Add Route**
2. Name it: `engineering`
3. Open the **Editor**

Build this flow (or import `route-config.json` via the API):

```
[Start]
    ↓
[Conditional] metadata.workflow == "code_review"
    ├─ true  → [Model] openai / gpt-4.1
    │               ↓ success → [End]
    │               ↓ fallback → [Model] openai / gpt-4o-mini → [End]
    └─ false → [Conditional] metadata.workflow == "meeting_prep"
                    ├─ true  → [Model] openai / gpt-4o-mini → [End]
                    └─ false → [Conditional] metadata.workflow == "incident_triage"
                                    ├─ true  → [Model] openai / gpt-4.1 → [End]
                                    └─ false → [Budget Limit] key: metadata.team
                                                    ├─ under budget → [Model] workers-ai / @cf/meta/llama-3.1-8b-instruct → [End]
                                                    └─ over budget  → [Model] openai / gpt-4o-mini → [End]
```

**Budget Limit settings:**
- Type: `cost`
- Key: `metadata.team`
- Limit: `10` (dollars)
- Window: `86400` (24 hours)

4. Click **Save**, then **Deploy**

---

## Step 3 — Run the Demo

Set your variables:

```bash
export ACCOUNT_ID="your-cloudflare-account-id"
export GATEWAY_ID="your-gateway-id"
export CF_AIG_TOKEN="your-ai-gateway-token"
```

Then run `demo-requests.sh` (see file), or execute each request individually:

### Request 1 — Code Review (should route to gpt-4.1)

```bash
curl -X POST "https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/compat/chat/completions" \
  --header "cf-aig-authorization: Bearer ${CF_AIG_TOKEN}" \
  --header "Content-Type: application/json" \
  --header 'cf-aig-metadata: {"team":"engineering","workflow":"code_review","userId":"smack"}' \
  --data '{
    "model": "dynamic/engineering",
    "messages": [
      {
        "role": "user",
        "content": "Review this TypeScript function for edge cases and potential bugs:\n\nfunction divide(a: number, b: number): number {\n  return a / b;\n}"
      }
    ]
  }' \
  --include | grep -E "cf-aig-model|cf-aig-provider|HTTP/"
```

**Expected response headers:**
```
HTTP/2 200
cf-aig-model: gpt-4.1
cf-aig-provider: openai
```

---

### Request 2 — Meeting Prep (should route to gpt-4o-mini)

```bash
curl -X POST "https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/compat/chat/completions" \
  --header "cf-aig-authorization: Bearer ${CF_AIG_TOKEN}" \
  --header "Content-Type: application/json" \
  --header 'cf-aig-metadata: {"team":"engineering","workflow":"meeting_prep","userId":"smack"}' \
  --data '{
    "model": "dynamic/engineering",
    "messages": [
      {
        "role": "user",
        "content": "Summarize these meeting notes into 3 bullet points:\n\nWe discussed the Q3 roadmap. Sarah raised concerns about timeline. Tom suggested we deprioritize the mobile feature. Decision: push mobile to Q4, focus on API stability."
      }
    ]
  }' \
  --include | grep -E "cf-aig-model|cf-aig-provider|HTTP/"
```

**Expected response headers:**
```
HTTP/2 200
cf-aig-model: gpt-4o-mini
cf-aig-provider: openai
```

---

### Request 3 — Incident Triage (should route to gpt-4.1)

```bash
curl -X POST "https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/compat/chat/completions" \
  --header "cf-aig-authorization: Bearer ${CF_AIG_TOKEN}" \
  --header "Content-Type: application/json" \
  --header 'cf-aig-metadata: {"team":"engineering","workflow":"incident_triage","userId":"smack"}' \
  --data '{
    "model": "dynamic/engineering",
    "messages": [
      {
        "role": "user",
        "content": "Our API is returning 503s. Error logs show: connection timeout to db-primary:5432. Redis cache hit rate dropped from 94% to 12%. What are the likely causes and immediate remediation steps?"
      }
    ]
  }' \
  --include | grep -E "cf-aig-model|cf-aig-provider|HTTP/"
```

**Expected response headers:**
```
HTTP/2 200
cf-aig-model: gpt-4.1
cf-aig-provider: openai
```

---

### Request 4 — Slack Summary (should route to Workers AI llama-3.1-8b)

```bash
curl -X POST "https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/compat/chat/completions" \
  --header "cf-aig-authorization: Bearer ${CF_AIG_TOKEN}" \
  --header "Content-Type: application/json" \
  --header 'cf-aig-metadata: {"team":"engineering","workflow":"slack_summary","userId":"smack"}' \
  --data '{
    "model": "dynamic/engineering",
    "messages": [
      {
        "role": "user",
        "content": "Summarize this Slack thread in one sentence:\n\nAlex: anyone know why staging is slow?\nJordan: probably the new deploy\nAlex: yeah just rolled back, should be fine\nJordan: confirmed, back to normal"
      }
    ]
  }' \
  --include | grep -E "cf-aig-model|cf-aig-provider|HTTP/"
```

**Expected response headers:**
```
HTTP/2 200
cf-aig-model: @cf/meta/llama-3.1-8b-instruct
cf-aig-provider: workers-ai
```

---

## Step 4 — Verify in the Dashboard

Open AI Gateway → **Logs**. You should see 4 requests with:

| Request | Model | Provider | Cost |
|---|---|---|---|
| Code review | gpt-4.1 | openai | ~$0.03 |
| Meeting prep | gpt-4o-mini | openai | ~$0.001 |
| Incident triage | gpt-4.1 | openai | ~$0.03 |
| Slack summary | llama-3.1-8b-instruct | workers-ai | ~$0.00001 |

You can also filter logs by `metadata.workflow` to see cost breakdown by task type. That's the visibility story.

---

## Step 5 — Demo the Budget Limit (Optional)

To show graceful degradation, exhaust the per-team budget by running the Slack summary request ~50 times:

```bash
for i in {1..50}; do
  curl -s -X POST "https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/compat/chat/completions" \
    --header "cf-aig-authorization: Bearer ${CF_AIG_TOKEN}" \
    --header "Content-Type: application/json" \
    --header '{"team":"engineering","workflow":"slack_summary","userId":"smack"}' \
    --data '{"model":"dynamic/engineering","messages":[{"role":"user","content":"Summarize: standup was fine."}]}' \
    -o /dev/null
done
```

After budget is hit, all subsequent requests — regardless of workflow — will route to `gpt-4o-mini`. No errors. No broken workflows. Just graceful degradation.

---

## Before vs. After

### Before — Golf Betting Agent `gateway.js` (hardcoded routing)

```javascript
// Routing logic in application code
// To change: edit code, redeploy Worker
getRoutingConfig(taskType) {
  const configs = {
    'intent-classification': { model: '@cf/meta/llama-3.1-8b-instruct' },
    'betting-sheet':         { model: '@cf/meta/llama-3.1-70b-instruct' },
  };
  return configs[taskType] || configs['intent-classification'];
}
```

**Problems:**
- Change routing → redeploy
- No budget enforcement
- No per-team or per-user cost tracking
- No fallback chain on model failure
- No dashboard visibility

### After — AI Gateway Dynamic Routes (metadata-driven)

```typescript
// Application code: send metadata, call dynamic route
// Routing logic: lives in the dashboard
const response = await openai.chat.completions.create(
  {
    model: "dynamic/engineering",
    messages: [{ role: "user", content: prompt }]
  },
  {
    headers: {
      "cf-aig-metadata": JSON.stringify({
        team: "engineering",
        workflow: taskType,  // "code_review" | "meeting_prep" | etc.
        userId: currentUser
      })
    }
  }
);
```

**What you get:**
- Change routing → update dashboard, no redeploy
- Per-team budget limits with automatic fallback
- Cost visible per workflow in logs
- Fallback chains on model failure
- Full observability: model used, provider, latency, cost per request

---

## The Pitch

> "You're spending $X/month on AI tokens. We can show you that 60-70% of your requests don't need a frontier model — meeting summaries, Slack digests, docs generation. AI Gateway lets your team tag each request by workflow type and automatically route cheap tasks to cheap models. Frontier models are reserved for the work that actually needs them. You set a team budget, and when it's hit, everything degrades gracefully instead of erroring. One metadata header in your application code. All routing logic managed from a dashboard — no redeployments."

---

## Files in This Project

| File | Purpose |
|---|---|
| `README.md` | This file — full demo walkthrough |
| `demo-requests.sh` | Ready-to-run cURL commands for all 4 workflows |
| `route-config.json` | Dynamic Route JSON definition (importable via API) |
| `worker-example/src/index.ts` | Minimal Worker showing application integration |
| `worker-example/wrangler.toml` | Wrangler config for the Worker example |
| `screenshots/` | Add dashboard screenshots here during demo prep |

---

## Related Projects

- **Golf Betting Agent** (`/projects/sports-betting-agent/`) — the "before" state. Code-level model routing in `src/agents/gateway.js`.
- **AI Sales Copilot** (`/projects/ai-sales-copilot/`) — uses Workers AI direct binding. AI Gateway routing would be the upgrade path.
- **SE Intel** (`/projects/se-intel/`) — multi-agent platform that could benefit from per-role model routing.
