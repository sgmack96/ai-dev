# Module 9.10 — Trace (Request Tracing)
> Dashboard Location: macksportreport.com → Investigate → Trace
> Estimated Time: 40 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare Trace simulates a request through Cloudflare's processing stack and returns a step-by-step trace of what would happen — which rules would match, what actions would be taken, what the cache decision would be, and which Workers would execute. Critically, this is a simulation — it does not send a real request to your origin server.

### Why Trace Exists

Cloudflare's request processing pipeline is complex. A single request passes through multiple layers:

1. DDoS mitigation
2. IP reputation checks
3. Bot Management scoring
4. WAF Custom Rules (evaluated in order)
5. WAF Managed Rules (OWASP + Cloudflare rulesets)
6. Rate Limiting rules
7. Cache Rules (determine cache eligibility)
8. Workers (if a route matches)
9. Transform Rules (URL rewrites, header modifications)
10. Origin routing

When something goes wrong — a request is blocked, a redirect fails, cache isn't working — the problem could be in any layer. Without Trace, you'd have to:
- Check each rule set manually
- Make live requests and watch logs
- Make changes and wait to see if they fixed it

Trace lets you diagnose in seconds by simulating the request and showing exactly what happened at each layer.

### What Trace Shows

For each request you simulate, Trace returns:

| Information | Details |
|-------------|---------|
| **Rule matches** | Which specific WAF rules, rate limit rules, or Cache Rules matched |
| **Rule evaluation order** | The exact sequence in which rules were checked |
| **Rule actions** | What action each matching rule would take (block, challenge, bypass, rewrite) |
| **Final action** | The terminal action applied to the request |
| **Cache decision** | HIT/MISS/BYPASS/DYNAMIC and the reason for the decision |
| **Worker execution** | Whether a Worker script would execute and which one |
| **Transform Rule results** | Header additions/removals, URL rewrites that would be applied |
| **Security score** | Bot Management score assigned to the simulated request |

### What Trace Does NOT Do

- Send the request to your origin server
- Affect any metrics or logs in analytics
- Consume any rate limit counters
- Change any cached content
- Appear in Logpush or Log Explorer data

Because the trace is a simulation, it has complete fidelity for rule-based decisions but cannot test origin server behavior.

---

## Deep Dive (Architect-Level)

### The Trace Input Model

When you initiate a trace in the dashboard or API, you provide:

**Required:**
- URL (the full URL to simulate, e.g., `https://macksportreport.com/api/scores`)
- HTTP method (GET, POST, PUT, etc.)

**Optional (but diagnostic gold):**
- Request headers (simulate different clients, auth tokens, custom headers)
- Request body (for POST/PUT traces)
- Client IP address (test geo-based rules)
- Client country (override for geo-targeting tests)
- Bot score override (test bot management rules at specific scores)
- Worker environment (production vs staging)

### Reading a Trace Output

A trace output is a JSON document with a `steps` array. Each step is a layer of the processing pipeline:

```json
{
  "result": "blocked",
  "steps": [
    {
      "action": "skip",
      "description": "DDoS L7 mitigation",
      "outcome": "pass",
      "matched": false
    },
    {
      "action": "skip",
      "description": "IP reputation check",
      "outcome": "pass",
      "matched": false,
      "data": {
        "score": 0
      }
    },
    {
      "action": "block",
      "description": "WAF Custom Rule: Block SQL injection attempts",
      "rule_id": "abc123def456",
      "outcome": "blocked",
      "matched": true,
      "match_details": {
        "matched_expression": "http.request.uri.query contains \"UNION SELECT\"",
        "matched_value": "?id=1+UNION+SELECT+1,2,3--"
      }
    },
    {
      "action": "skip",
      "description": "Rate Limiting",
      "outcome": "not_evaluated",
      "note": "Evaluation stopped after block action"
    }
  ]
}
```

Key patterns in trace output:
- **`outcome: pass`** → rule or layer evaluated, no action taken
- **`outcome: blocked`** → a blocking rule matched; evaluation stops
- **`outcome: not_evaluated`** → this layer was never reached (prior layer terminated the request)
- **`matched: true`** → a rule condition matched (may or may not result in an action)

### Common Debugging Scenarios

#### Scenario 1: "Why is this request being blocked?"

**Input to Trace:**
- URL: the exact URL the user reported as blocked
- Method: as they were using
- Headers: include their `User-Agent` and any custom headers they use
- IP: their IP address if known

**What to look for:**
- Find the first step with `outcome: blocked`
- Read the `match_details` to see which expression matched
- Read the `rule_id` to find the specific rule in your WAF

**Possible findings and fixes:**
- WAF Custom Rule too broad → narrow the expression
- Bot Management score too low → adjust the action threshold or create an exception
- IP blocked → add to allow list
- Missing auth header → expected behavior (add auth to their request)

#### Scenario 2: "Why isn't cache working?"

**Input to Trace:**
- URL: the exact URL that should be caching
- Method: GET
- Headers: no auth headers (simulating a public user)

**What to look for:**
- Find the Cache Rules step
- Look for `bypass` action — means a Cache Rule is forcing bypass
- Look for `dynamic` — means content type or headers prevent caching
- Check if a Cookie or Authorization header is triggering automatic cache bypass

**Common findings:**
- Cache Rule accidentally matches this URL
- Origin is sending `Cache-Control: no-cache` or `Cache-Control: private`
- Session cookie is present in the simulated request (remove it to test unauthenticated caching)

#### Scenario 3: "Why is this URL redirect not working?"

**Input to Trace:**
- URL: the URL that should be redirected
- Method: GET

**What to look for:**
- Find Transform Rules or Redirect Rules steps
- Verify the redirect rule expression matches this URL
- Check if a higher-priority WAF rule is blocking the request before the redirect fires

#### Scenario 4: "Why isn't my Worker executing?"

**Input to Trace:**
- URL: the URL that should trigger the Worker
- Method: the method your Worker route is configured for

**What to look for:**
- Find the Workers step
- `matched: false` → the route doesn't match this URL
- `matched: true, outcome: executed` → Worker executed
- `matched: true, outcome: skipped` → Worker is disabled or has an error

### Trace vs Live Request Testing

| Aspect | Trace | Live Request |
|--------|-------|-------------|
| **Reaches origin** | No | Yes |
| **Affects rate limit counters** | No | Yes |
| **Appears in analytics** | No | Yes |
| **Tests rule logic** | Yes | Yes |
| **Tests origin server behavior** | No | Yes |
| **Safe to run in production** | Yes | Carefully |
| **Can spoof IP/Country** | Yes | No |
| **Requires actual traffic** | No | Yes |

**Best practice:** Use Trace to verify configuration logic first. Use live requests (curl with specific headers) to test end-to-end behavior including origin. Both together give you complete confidence before going to 100% traffic.

### API Access for Trace

Trace is also accessible via the API, enabling automated testing of rule configurations:

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/traces" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "url": "https://macksportreport.com/api/scores",
    "method": "GET",
    "headers": {
      "User-Agent": "Mozilla/5.0 (compatible; TestClient/1.0)",
      "Accept": "application/json"
    }
  }'
```

---

## Dashboard Walkthrough

### Step 1: Navigate to Trace

1. macksportreport.com → Investigate → Trace

### Step 2: Enter Trace Parameters

The Trace form has:

**URL field:**
Enter: `https://macksportreport.com/`

**Method dropdown:**
Select: GET

**Headers section:**
Click "Add header" to add custom headers. For example:
- `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0`

**Advanced options:**
- Client IP: leave blank (uses a default test IP)
- Body: leave empty for GET requests

### Step 3: Run the Trace

Click **Trace**. Results appear within 2-3 seconds.

### Step 4: Read the Pipeline Steps

The trace shows each pipeline layer as a step:

1. **DDoS** → should show pass for normal requests
2. **IP reputation** → should show pass
3. **Bot Management** → shows the bot score assigned
4. **WAF Custom Rules** → shows if any custom rules matched
5. **WAF Managed Rules** → shows if any managed rules matched
6. **Cache Rules** → shows the cache decision
7. **Workers** → shows if a Worker would execute
8. **Redirect/Transform Rules** → shows any URL modifications

### Step 5: Test a Known WAF Rule

Simulate a request that should trigger a WAF rule:

URL: `https://macksportreport.com/search?q=test`
Header: Add `X-Forwarded-For: 1.2.3.4`
Query: Add an obvious SQL injection to the URL: `?q=1' OR '1'='1`

Run the trace and observe whether the WAF SQL injection rule fires.

---

## Hands-On Lab

### Prerequisites

- macksportreport.com on any paid plan
- At least one WAF rule, Cache Rule, or Worker deployed

### Lab 1: Basic Trace via Dashboard

1. Open macksportreport.com → Investigate → Trace
2. Enter URL: `https://macksportreport.com/`
3. Method: GET
4. Run trace
5. Document which steps showed `matched: true` vs `matched: false`

### Lab 2: Trace via API

```bash
export CF_API_TOKEN="your-api-token"
export ZONE_ID="your-zone-id"

# Basic GET request trace
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/traces" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "url": "https://macksportreport.com/",
    "method": "GET",
    "headers": {
      "User-Agent": "Mozilla/5.0 (compatible; CF-Trace-Test/1.0)"
    }
  }' | jq '.result'
```

### Lab 3: Test WAF Rule Coverage

```bash
# Simulate a SQL injection attempt
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/traces" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "url": "https://macksportreport.com/search?q=1+UNION+SELECT+1,2,3--",
    "method": "GET",
    "headers": {
      "User-Agent": "Mozilla/5.0 (compatible; SecurityTest)"
    }
  }' | jq '.result | {final_action: .action, waf_matched: [.steps[] | select(.matched == true and (.description | test("WAF"))) | {rule: .description, action: .action}]}'
```

### Lab 4: Debug Cache Bypass

```bash
# First trace: no cookies (should cache)
echo "=== Trace WITHOUT cookies ==="
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/traces" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "url": "https://macksportreport.com/static/logo.png",
    "method": "GET"
  }' | jq '.result | .steps[] | select(.description | test("[Cc]ache")) | {step: .description, action: .action, outcome: .outcome}'

# Second trace: with session cookie (may bypass cache)
echo ""
echo "=== Trace WITH session cookie ==="
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/traces" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "url": "https://macksportreport.com/static/logo.png",
    "method": "GET",
    "headers": {
      "Cookie": "session=abc123; user=testuser"
    }
  }' | jq '.result | .steps[] | select(.description | test("[Cc]ache")) | {step: .description, action: .action, outcome: .outcome}'
```

### Lab 5: Test Worker Route Matching

```bash
# Test whether a Worker route matches a URL
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/traces" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "url": "https://macksportreport.com/api/scores",
    "method": "GET",
    "headers": {
      "Accept": "application/json"
    }
  }' | jq '.result | .steps[] | select(.description | test("[Ww]orker")) | {step: .description, matched: .matched, outcome: .outcome, worker: (.data.worker_name // "N/A")}'
```

---

## Demo Script (2 Minutes)

**Setup:** Trace open in dashboard with a result showing WAF rules evaluated. Also have the API trace ready to run in terminal.

---

"Here's a scenario: your security team adds a new WAF rule on Friday afternoon to block a specific attack pattern. Monday morning, your customer calls and says they can't access their account. They think the WAF rule blocked them. You have to figure out if they're right — and whether you should roll back the rule or just add an exception.

Traditionally, you'd have to wait for them to make a request, watch the logs, and hope you can correlate the log entry with the specific rule. That might take 20-30 minutes.

[Open Trace, enter the customer's URL and method]

With Trace, I enter their URL, their HTTP method, and if I know their user-agent or any custom headers they send, I add those too. Hit Trace.

[Show the result in 2 seconds]

Two seconds. I can see the full pipeline. Here — WAF Custom Rule: Block automated account creation. It matched. Here's the specific expression that matched: request body contains 'bulk_register'. Their client is sending that field and the WAF is blocking them.

Is this a false positive? I look at the rule expression. It's checking request body for 'bulk_register'. Their legitimate client sends that in a single-account registration flow for historical reasons. That's the false positive.

The fix is simple: add a WAF exception for their specific IP range. But instead of changing the rule and hoping it works, I can update the exception and run Trace again — immediately — to verify the updated rule logic would now allow their request.

Rule change validated in under 5 minutes. Customer back online. No risky live traffic testing required."

---

## Competitive Context

| Feature | Cloudflare Trace | Fastly Fiddle | AWS WAF Sampled Requests | Akamai Pragma Headers |
|---------|-----------------|---------------|--------------------------|----------------------|
| **Full pipeline simulation** | Yes | Yes (partial) | No (only sampled real traffic) | Partial |
| **No real request sent** | Yes | Yes | No | No |
| **WAF rule testing** | Yes | Yes | Limited | Yes |
| **Cache decision visibility** | Yes | Yes | No | Yes |
| **Worker/edge logic testing** | Yes | Yes (VCL) | No | Yes (EdgeWorkers) |
| **API accessible** | Yes | Yes | No | Yes |
| **Custom IP/Country spoofing** | Yes | Limited | No | No |
| **Available on all plans** | Yes | Yes | Limited | Enterprise |
| **Speed** | 2-3 seconds | 3-5 seconds | Minutes (real traffic) | Real-time only |

**Cloudflare differentiator:** Trace covers the full Cloudflare stack — DDoS, WAF, Bot Management, Cache, Workers, and Transform Rules — in a single simulated request. Competitors typically have debugging tools for individual products but not a unified pipeline trace.

---

## Self-Check Questions

**Question 1:** A customer reports that their 'Submit Order' button stopped working after you deployed a new WAF rule yesterday. They're getting a 403 error. Describe exactly how you would use Trace to diagnose this, including what you would enter as inputs.

```
Your answer:




```

---

**Question 2:** A customer is testing a new Cache Rule that should cache all responses from `/api/public/*` for 1 hour. After deploying the rule, requests to `/api/public/scores` are still showing `cf-cache-status: BYPASS`. How would you use Trace to identify why?

```
Your answer:




```

---

**Question 3:** What is the key limitation of Trace when debugging an issue where the origin server is returning 500 errors? What tool would you use in addition to Trace to fully diagnose the issue?

```
Your answer:




```

---

**Question 4:** A customer wants to test their WAF rules against a batch of 100 different attack payloads before going to production. How would you build an automated testing workflow using the Trace API?

```
Your answer:




```

---

**Question 5:** A customer's Worker should execute for all requests to `/api/*`, but the Trace shows `matched: false` for the Worker step when testing `https://macksportreport.com/api/scores`. What are three possible reasons for this?

```
Your answer:




```

---

## Sources

- [Cloudflare Trace Documentation](https://developers.cloudflare.com/fundamentals/basic-tasks/trace-request/)
- [Trace API Reference](https://developers.cloudflare.com/api/operations/zone-traces-trace)
- [WAF Custom Rules Documentation](https://developers.cloudflare.com/waf/custom-rules/)
- [Cache Rules Documentation](https://developers.cloudflare.com/cache/how-to/cache-rules/)
- [Workers Routes Documentation](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Transform Rules Documentation](https://developers.cloudflare.com/rules/transform/)
