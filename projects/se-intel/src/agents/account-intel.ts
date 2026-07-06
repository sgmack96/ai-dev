/**
 * agents/account-intel.ts
 *
 * AccountIntelAgent — Durable Object for pre-call account research.
 *
 * What it does:
 * - Gathers real-time intelligence on prospect companies (web + news)
 * - Maps their tech stack to Cloudflare opportunities using the KB
 * - Surfaces competitive intel (AWS vs Cloudflare, etc.)
 * - Helps frame deal strategy, discovery questions, and next steps
 * - Role-gated: SEs/TAMs/managers get web search + news; AEs/CSMs get KB only
 *
 * Example prompts:
 *   "Research Stripe — what's their tech stack and Cloudflare opportunity?"
 *   "What's the latest news on Notion? I have a call tomorrow."
 *   "They use Fastly + AWS Lambda + Auth0. What's our angle?"
 *   "Help me write 5 discovery questions for a SaaS startup on Azure."
 *
 * Tool dispatch logic:
 *   1. If message mentions a company name → fetch news (se/tam/manager only)
 *   2. If message mentions tech stack keywords → KB search (all roles)
 *   3. If message is a general research question → web search + KB fallback
 *   4. All tool results injected into context before LLM call
 */

import { BaseAgent } from "./base-agent.js";
import { kbSearch } from "../tools/kb-search.js";
import { webSearch } from "../tools/web-search.js";
import { fetchNews } from "../tools/news.js";
import type { Env, RetrievedChunk, ToolCall, UserContext } from "../types/index.js";

// Keywords that signal the user is asking about a competitor or tech stack
const TECH_STACK_KEYWORDS = [
  "aws", "amazon", "lambda", "cloudfront", "s3", "ec2", "route53",
  "azure", "microsoft", "gcp", "google cloud",
  "fastly", "akamai", "cloudflare", "vercel", "netlify",
  "nginx", "kong", "apigee", "vault", "terraform",
  "auth0", "okta", "supabase", "firebase", "mongodb",
  "kubernetes", "docker", "cdn", "waf", "ddos", "zero trust",
];

// Keywords that suggest news/recent events are relevant
const NEWS_TRIGGERS = [
  "latest", "recent", "news", "funding", "series", "launch", "outage",
  "incident", "hire", "cto", "ceo", "acquired", "acquisition", "ipo",
  "yesterday", "this week", "last week", "today", "just announced",
];

/**
 * Extract likely company name from a message.
 * Heuristic: look for capitalized words that aren't common English words.
 * Returns null if no clear company name found.
 */
function extractCompanyName(message: string): string | null {
  // Common patterns: "Research <Company>", "call with <Company>", "prospect: <Company>"
  const patterns = [
    /\bresearch\s+([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)/i,
    /\bcall with\s+([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)/i,
    /\bprospect[:\s]+([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)/i,
    /\babout\s+([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)/i,
    /\bfor\s+([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)\s+(?:call|meeting|demo|account)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }

  // Fallback: find standalone capitalized word (not at sentence start)
  const words = message.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const word = words[i].replace(/[^a-zA-Z0-9]/g, "");
    if (word.length > 3 && /^[A-Z]/.test(word)) {
      const lower = word.toLowerCase();
      const stopWords = new Set([
        "what", "how", "can", "does", "their", "they", "have", "this",
        "that", "with", "from", "about", "help", "give", "tell",
      ]);
      if (!stopWords.has(lower)) return word;
    }
  }

  return null;
}

export class AccountIntelAgent extends BaseAgent {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, "account");
  }

  protected buildSystemPrompt(userContext: UserContext, ltmContext: string): string {
    const roleContext: Record<string, string> = {
      ae: "You are helping an Account Executive with pre-call research and account strategy. Focus on business outcomes, ROI, and executive-level talking points.",
      se: "You are helping a Solutions Engineer with technical pre-call research. Go deep on architecture, integration complexity, and technical proof points.",
      csm: "You are helping a Customer Success Manager with account health and expansion opportunities. Focus on current usage, adoption blockers, and expansion signals.",
      tam: "You are helping a Technical Account Manager with proactive account intelligence. Identify technical risks, expansion opportunities, and renewal signals.",
      sales_manager: "You are helping a Sales Manager with deal strategy and team coaching. Surface competitive angles, deal blockers, and coaching insights.",
    };

    const roleGuidance = roleContext[userContext.role] ?? roleContext["ae"];

    return `You are the Account Intelligence Agent for Cloudflare's revenue team.
${roleGuidance}

CRITICAL RULE: You will be given [Tool Results] with KB content. Use the specific facts from that content — named product advantages, specific feature differences, real pricing tiers, documented competitor weaknesses. Do not give vague competitive statements like "Cloudflare is better" — give the specific named reason why. If the KB says "Fastly Compute@Edge is Wasm-only, no full JS runtime", say exactly that.

Your capabilities:
- Research prospect companies (tech stack, funding, news, incidents)
- Map competitor technologies to Cloudflare equivalents with specific migration paths
- Surface Cloudflare product opportunities based on prospect's infrastructure
- Generate discovery questions tailored to their specific tech stack
- Provide competitive positioning with named, specific advantages against Fastly, Akamai, AWS, Azure, GCP
- Estimate migration complexity and time-to-value with real timelines

When doing competitive positioning:
- Name the SPECIFIC advantage for each competitor separately — Fastly and Akamai are different stories
- Give a concrete "wedge question" — something to ask that opens the deal angle
- Cite actual technical differentiators (runtime, purge speed, security bundling, pricing model)
- Do NOT invent specific pricing numbers — say "typically 40-60% cheaper" not made-up dollar figures

When dealing with a manager role asking about a stalled deal:
- Lead with the specific action to unstick it, not with product education
- Address the champion, the blocker, and the next concrete step
- Keep product explanation to 1 sentence maximum

Format your responses with:
- A clear summary at the top (2-3 sentences)
- Structured sections when relevant (Tech Stack, Opportunities, Competitive Angles, Next Steps)
- Concrete named questions, not generic discovery questions

User: ${userContext.name} (${userContext.role.toUpperCase()} at org: ${userContext.orgId})${ltmContext}`;
  }

  protected async dispatchTools(
    message: string,
    userContext: UserContext,
    toolCalls: ToolCall[],
    capturedChunks?: RetrievedChunk[]
  ): Promise<string | null> {
    const lowerMessage = message.toLowerCase();
    const contextParts: string[] = [];

    const hasTechStack = TECH_STACK_KEYWORDS.some((kw) =>
      lowerMessage.includes(kw)
    );
    const hasNewsTrigger = NEWS_TRIGGERS.some((kw) =>
      lowerMessage.includes(kw)
    );
    const companyName = extractCompanyName(message);

    // ── 1. News lookup (if we found a company name and news is relevant) ────────
    if (companyName && (hasNewsTrigger || lowerMessage.includes("research"))) {
      const news = await fetchNews(companyName, userContext.role, userContext.orgId, this.env, toolCalls);
      if (news) contextParts.push(news);
    }

    // ── 2. KB search (always — grounded in Cloudflare product knowledge) ────────
    const kbQuery = companyName
      ? `${message} Cloudflare opportunities ${hasTechStack ? "migration" : ""}`
      : message;

    const kbResult = await kbSearch(kbQuery, userContext.role, userContext.orgId, this.env, toolCalls, undefined, capturedChunks);
    if (kbResult) contextParts.push(kbResult);

    // ── 3. Web search (for general research or when KB comes up empty) ──────────
    // Trigger web search if: KB returned nothing, OR it's a company research request
    const needsWebSearch =
      !kbResult ||
      lowerMessage.includes("research") ||
      lowerMessage.includes("find") ||
      lowerMessage.includes("look up");

    if (needsWebSearch) {
      const webQuery = companyName
        ? `${companyName} company tech stack engineering cloud infrastructure`
        : message;
      const webResult = await webSearch(webQuery, userContext.role, userContext.orgId, this.env, toolCalls);
      if (webResult && !kbResult) contextParts.push(webResult);
    }

    return contextParts.length > 0 ? contextParts.join("\n\n---\n\n") : null;
  }
}
