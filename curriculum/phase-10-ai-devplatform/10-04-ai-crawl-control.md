# Module 10.4 — AI Crawl Control
> Dashboard Location: macksportreport.com → Security → Bots → AI Crawl Control | Estimated Time: 45 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

AI Crawl Control lets you decide, at the WAF level, which AI bots are allowed to crawl your website. This is a direct response to the explosion of AI companies training models by scraping the public web — and publishers, content creators, and enterprises wanting control over their data.

**The context:** When OpenAI, Anthropic, Cohere, or Common Crawl train a model, they need text. That text comes from the public web. Your blog posts, your product documentation, your pricing pages, your proprietary content — all of it is potentially scraped and ingested into training datasets.

**Why customers care:**
- **Publishers and media companies:** Their journalism is being ingested to train models that compete with them
- **SaaS companies:** Their documentation and pricing structure is being fed into AI assistants that competitors can query
- **Legal services:** Training data use may implicate copyright or data protection obligations (EU AI Act, GDPR)
- **E-commerce:** Product descriptions and pricing are scraped for competitive intelligence
- **Any site with valuable original content:** The content that makes you rank on Google is also what makes you valuable training data

**The traditional approach — robots.txt — is advisory only.** Search engines respect it. Many AI crawlers ignore it entirely, or claim to respect it but don't verify compliance. Cloudflare AI Crawl Control enforces at the WAF layer — requests from blocked crawlers never reach your origin.

---

## Deep Dive (Architect-Level)

### How Cloudflare Identifies AI Crawlers

Cloudflare uses two mechanisms to identify bot traffic:

1. **User-Agent string matching:** Known AI crawlers announce themselves in their User-Agent header
   - `GPTBot/1.0` (OpenAI)
   - `ClaudeBot/1.0` (Anthropic)
   - `CCBot/2.0` (Common Crawl, used by many orgs)
   - `Bytespider` (ByteDance)
   - `Diffbot` (Diffbot)
   - `PerplexityBot` (Perplexity AI)
   - `ImagesiftBot` (various AI image training)
   - `FacebookBot` (Meta AI)

2. **IP verification (Verified Bots):** For crawlers that claim to be legitimate, Cloudflare performs reverse DNS + forward DNS lookups to confirm the IP actually belongs to the claimed organization. This is the "verified" status — Google does this, and Cloudflare has extended it to AI crawlers.

**Verified vs Unverified:**
- **Verified:** IP confirmed via rDNS/fDNS to belong to the stated crawler (e.g., Cloudflare has confirmed this IP is genuinely GPTBot, not someone spoofing the UA)
- **Unverified:** Claims to be a bot but IP hasn't been confirmed

This distinction matters: blocking by User-Agent alone can be bypassed by anyone. Verified bot blocking is harder to spoof because it's IP-based after DNS confirmation.

### Enforcement Mechanism

AI Crawl Control rules are implemented as WAF rules. When a request matches an identified AI crawler:
- **Allow:** Request passes through to origin normally
- **Block:** Cloudflare returns 403 Forbidden; origin never sees the request
- **Challenge:** CAPTCHA or JS challenge (less common for bots that don't execute JavaScript)

### robots.txt Integration

AI Crawl Control includes a robots.txt manager. From the dashboard you can:
- View your current robots.txt
- Add `User-agent: GPTBot` → `Disallow: /` directives
- This creates a layered approach: robots.txt as the polite advisory, WAF rules as the hard enforcement

Note: Cloudflare does not automatically sync robots.txt disallow rules to WAF rules. They are separately managed but visible in the same interface.

### Legal and Regulatory Context

The EU AI Act (effective 2025) requires AI model providers to disclose what training data they used and to respect opt-out mechanisms. The robots.txt standard for AI training opt-out is being formalized. Courts in the US (New York Times v. OpenAI, Getty Images v. Stability AI) are establishing precedent around web scraping for training data.

**SE talking point:** "Cloudflare AI Crawl Control doesn't resolve the legal question — but it gives your customers actual technical enforcement, not just a robots.txt entry that may or may not be respected."

### Metrics Available

From the dashboard you can see:
- Total AI crawler requests per day/week
- Requests blocked vs allowed per crawler
- Top crawlers hitting your site
- Traffic volume trends

---

## Dashboard Walkthrough

**Step 1: Find AI Crawl Control**
1. Log in to Cloudflare dashboard
2. Select `macksportreport.com` zone
3. Navigate to Security → Bots → AI Crawl Control

**Step 2: Review the Crawler List**
- The dashboard shows all known AI crawlers CF tracks
- Each has: Name, Operator, Verified status (yes/no), current Action (Allow/Block)
- Sort by "Requests" to see which crawlers are most active on your site

**Step 3: Block All AI Crawlers**
1. Click "Block All AI Crawlers" toggle at the top
2. Confirm — this sets every listed crawler to Block immediately
3. Review for any crawlers you want to allow selectively (e.g., if you have a partnership with a specific AI company)

**Step 4: Granular Control**
1. Click a specific crawler (e.g., GPTBot)
2. Set action: Allow, Block, or Custom WAF rule
3. See: last seen timestamp, total requests, verified status

**Step 5: Review robots.txt**
1. Scroll to "robots.txt" section
2. Click "Add Rule" to add User-agent disallow directives
3. Review current robots.txt content

**Step 6: View Analytics**
1. Click "Analytics" tab
2. See blocked requests over time
3. Break down by crawler name

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ZONE_ID="your-zone-id-for-macksportreport-com"
export CF_API_TOKEN="your-cf-api-token"
```

### Lab 1: List Bot Management Settings via API
```bash
curl "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/bot_management" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 2: Check Current WAF Rules for AI Crawlers
```bash
# List firewall rules to see any AI crawler blocks already in place
curl "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/firewall/rules?description=AI+crawler" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 3: Create a WAF Rule to Block GPTBot
```bash
# Step 1: Create a filter
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/filters" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "expression": "(http.user_agent contains \"GPTBot\")",
    "description": "Match OpenAI GPTBot crawler"
  }'

# Step 2: Note the filter ID from the response, then create the rule
FILTER_ID="your-filter-id-from-above"

curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/firewall/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "[{
    \"filter\": {\"id\": \"${FILTER_ID}\"},
    \"action\": \"block\",
    \"description\": \"Block OpenAI GPTBot\"
  }]"
```

### Lab 4: Block Multiple AI Crawlers with a Single Rule
```bash
# Create a combined filter for multiple AI crawlers
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/filters" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "expression": "(http.user_agent contains \"GPTBot\") or (http.user_agent contains \"ClaudeBot\") or (http.user_agent contains \"CCBot\") or (http.user_agent contains \"Bytespider\") or (http.user_agent contains \"PerplexityBot\") or (http.user_agent contains \"Diffbot\")",
    "description": "All known AI training crawlers"
  }'
```

### Lab 5: Simulate an AI Crawler Request (for testing)
```bash
# Test what your site returns to GPTBot (should be 403 if blocked)
curl -v -A "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)" \
  https://macksportreport.com/ 2>&1 | grep -E "HTTP|< HTTP|403|200"

# Compare to normal browser request
curl -v -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  https://macksportreport.com/ 2>&1 | grep -E "HTTP|< HTTP|403|200"
```

### Lab 6: Add robots.txt Disallow for AI Bots (belt-and-suspenders approach)
```bash
# Check current robots.txt
curl https://macksportreport.com/robots.txt

# If you manage your own robots.txt, you'd add:
cat << 'EOF'
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: PerplexityBot
Disallow: /
EOF
# Add this content to your robots.txt file in your site's public directory
```

### Lab 7: Verify Blocked Request in Dashboard
1. After running Lab 5 with the GPTBot user-agent, navigate to:
   Security → Events (Firewall Events)
2. Filter by Rule Description: "AI crawler"
3. You should see the blocked request with source IP, UA, timestamp

---

## Demo Script (2 Minutes)

**Audience:** Marketing manager, publisher, or content-heavy SaaS company

**Opening (15 seconds):**
"Do you know how many times AI companies have crawled your website this month to train their models?"

**Act 1 — Show the traffic (30 seconds):**
"Let me show you. [Navigate to Security → Bots → AI Crawl Control] This is your site. GPTBot has hit it 4,300 times this month. ClaudeBot, 1,100 times. Bytespider — that's ByteDance — 800 times. All of them ingesting your content."

**Act 2 — Show the enforcement (30 seconds):**
"The typical response is to add them to robots.txt. But robots.txt is a handshake agreement. Cloudflare actually blocks them at the network level. One click. [Toggle block on GPTBot.] Done. They get a 403. Your content stays yours."

**Act 3 — Show the verification distinction (20 seconds):**
"See this 'Verified' badge? That means Cloudflare has confirmed via DNS that this IP genuinely belongs to OpenAI. You're not just blocking based on a User-Agent string someone could fake — you're blocking confirmed infrastructure."

**Close (25 seconds):**
"There's a real debate right now about whether web scraping for AI training is legal. Courts are still deciding. But while that plays out, this gives you actual technical control over who accesses your content. It's included with your Cloudflare plan — no add-on needed."

---

## Competitive Context

| Feature | Cloudflare AI Crawl Control | Manual robots.txt | Cloudflare WAF Custom Rules | Competitor Bot Solutions |
|---|---|---|---|---|
| **Enforcement type** | WAF-level (hard block) | Advisory (can be ignored) | WAF-level (hard block) | Varies |
| **Pre-built crawler list** | Yes (20+ known AI bots) | No (manual UA research) | No (write rules yourself) | Some |
| **Verified bot detection** | Yes (rDNS/fDNS confirmed) | No | No | Some |
| **One-click block all** | Yes | No | No | Sometimes |
| **Granular per-crawler** | Yes | Yes (per UA block) | Yes (per filter rule) | Varies |
| **Traffic analytics** | Yes (per crawler counts) | No | Limited | Yes |
| **robots.txt management** | Integrated in dashboard | Separate file management | No | No |
| **Cost** | Included (Bot Fight Mode) | Free | Included | $$/month extra |
| **Origin protection** | Yes (origin never sees blocked request) | No | Yes | Depends |

**Key differentiator:** robots.txt is a convention. Cloudflare's AI Crawl Control is enforcement. For any customer who's serious about content protection — not just compliance theater — this distinction is the entire sale.

---

## Self-Check Questions

**Question 1:** A content publisher asks: "We already have GPTBot in our robots.txt. Why do we need AI Crawl Control?" How do you explain the technical difference?

```
Your answer:




```

**Question 2:** What is the difference between a "verified" AI crawler and an "unverified" one in Cloudflare's system? Why does this distinction matter for blocking effectiveness?

```
Your answer:




```

**Question 3:** A customer says: "We actually want OpenAI to crawl our site — we're building a ChatGPT plugin and want our content to appear in answers." How do you configure AI Crawl Control to allow GPTBot while blocking all other AI crawlers?

```
Your answer:




```

**Question 4:** Where does AI Crawl Control enforcement happen in the Cloudflare request pipeline? Does a blocked AI crawler request ever touch your origin server?

```
Your answer:




```

**Question 5:** Describe a scenario where an attacker could bypass User-Agent-based blocking but NOT IP-based verified bot blocking. Why does this make verified status important?

```
Your answer:




```

---

## Sources

- [Cloudflare AI Crawl Control Documentation](https://developers.cloudflare.com/bots/concepts/bot/#ai-scrapers-and-crawlers)
- [Cloudflare Bot Management](https://developers.cloudflare.com/bots/)
- [Verified Bots List](https://developers.cloudflare.com/bots/concepts/bot/#verified-bots)
- [robots.txt for AI Training Opt-Out](https://developers.cloudflare.com/bots/troubleshooting/verified-bots/)
- [Cloudflare Blog: Block AI Bots with One Click](https://blog.cloudflare.com/declare-your-aindependence-block-ai-bots-scrapers-and-crawlers-with-a-single-click/)
- [EU AI Act Text](https://artificialintelligenceact.eu/)
- [Getty Images v. Stability AI complaint (copyright precedent)](https://fingfx.thomsonreuters.com/gfx/legaldocs/gdvzykdxopw/GETTY-STABILITY-AI-lawsuit.pdf)
