/**
 * agents/enablement.ts
 *
 * EnablementAgent — Durable Object for SE/AE training and deal preparation.
 *
 * What it does:
 * - Answers product questions grounded in the KB (no hallucinations)
 * - Helps reps prep for demos, objections, and technical Q&A
 * - Explains Cloudflare pricing, competitive differentiators, and limitations
 * - Coaches on sales plays: POC scoping, architecture reviews, champion building
 * - Role-gated: all roles get public KB; se/tam/manager get se_only KB
 *
 * Example prompts:
 *   "How does Cloudflare Workers compare to AWS Lambda?"
 *   "What are the top 3 objections prospects raise about Cloudflare WAF?"
 *   "Help me prep for a demo of Zero Trust Access to a 500-person company."
 *   "What's the migration path from Fastly to Cloudflare CDN?"
 *   "A prospect asked about SOC 2 Type II — what do I say?" (manager_only KB)
 *
 * Tool dispatch logic:
 *   - Always query KB (primary source of truth for product knowledge)
 *   - KB namespace gated by role (public / se_only / manager_only)
 *   - Web search as fallback only if KB returns nothing
 *   - No news tool — enablement is about product knowledge, not current events
 */

import { BaseAgent } from "./base-agent.js";
import { kbSearch } from "../tools/kb-search.js";
import { webSearch } from "../tools/web-search.js";
import type { Env, RetrievedChunk, ToolCall, UserContext, KBNamespace } from "../types/index.js";

/**
 * Always return undefined — query all allowed namespaces for this role.
 *
 * Previous version tried to pre-select a single namespace based on keywords,
 * but this hurt recall: a manager asking about discounts would only get
 * manager_only chunks and miss public KB context; an SE asking about Auth0
 * integration might not trigger the right keywords. Vectorize cosine
 * similarity across all allowed namespaces naturally surfaces the best chunks.
 * The role-based namespace filtering in kbSearch() still enforces access
 * control — this just removes the single-namespace optimisation.
 */
function selectNamespace(
  _message: string,
  _role: string
): KBNamespace | undefined {
  return undefined; // always query all namespaces allowed for this role
}

export class EnablementAgent extends BaseAgent {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, "enablement");
  }

  protected buildSystemPrompt(userContext: UserContext, ltmContext: string): string {
    const roleContext: Record<string, string> = {
      ae: "You are coaching an Account Executive. Focus on business value, pricing positioning, and closing tactics. Keep technical explanations at the right level — high enough to be credible, accessible enough to not lose the room.",
      se: "You are coaching a Solutions Engineer. Go technically deep. Help them nail demos, architect solutions, handle hard technical objections, and run bulletproof POCs.",
      csm: "You are coaching a Customer Success Manager. Focus on onboarding, adoption, expansion conversations, and proactively surfacing risks before they become churn.",
      tam: "You are coaching a Technical Account Manager. Help them become the trusted technical advisor — proactive recommendations, deep product knowledge, QBR prep.",
      sales_manager: "You are coaching a Sales Manager. Help them coach their team, understand deal strategy, and handle escalations including pricing approvals and legal reviews.",
    };

    const roleGuidance = roleContext[userContext.role] ?? roleContext["ae"];

    // Hint about what KB namespaces this role can access
    const accessHint: Record<string, string> = {
      ae: "You have access to public product knowledge.",
      csm: "You have access to public product knowledge.",
      se: "You have access to public knowledge AND technical deep-dives in the SE knowledge base.",
      tam: "You have access to public knowledge AND technical deep-dives in the SE/TAM knowledge base.",
      sales_manager:
        "You have access to public knowledge, SE technical knowledge, AND manager-only content including pricing guidelines and deal strategy.",
    };

    return `You are the Enablement Agent for Cloudflare's revenue team — a senior Cloudflare expert who has seen every deal situation, objection, and technical challenge.

${roleGuidance}

${accessHint[userContext.role] ?? accessHint["ae"]}

CRITICAL RULE: You will be given [Tool Results] with KB content. Use the specific facts from that content — product names, pricing tiers, steps, and frameworks. Do not speak vaguely when specific information is available. A response that ignores the KB context and answers from general knowledge will fail.

GROUNDING RULE (non-negotiable): When the KB content contains a specific named fact — a standard or framework (e.g. WinterCG), a certification (e.g. SOC 2 Type II, ISO 27001), a named figure (e.g. "35% discount", "sub-5ms cold start"), or a specific product name — you MUST cite that exact named fact verbatim in your answer. Do not paraphrase a named standard into a generic concept (e.g. do not replace "WinterCG-compliant" with just "open standards"). If the KB gave you the specific term, the rep needs the specific term to use in the call. Never state a number that differs from the KB; if the KB says 35%, never say 25%.

DEPTH RULE for role "${userContext.role}": ${
  userContext.role === "ae" || userContext.role === "csm"
    ? "This is a non-technical role. Cite business-level facts (ROI, cost comparisons, product names, outcomes). Do NOT include technical configuration steps, CLI commands, or implementation details — they will confuse the user."
    : userContext.role === "sales_manager"
    ? "This is a management role asking about deal strategy. Lead with specific actions and decision frameworks. Keep product explanation to 1 sentence. Cite specific approval tiers or process steps if available in the KB."
    : "This is a technical SE/TAM role. Go deep — cite specific SAML/OIDC steps, configuration values, time estimates, and technical gotchas from the KB."
}

Your style:
- Concrete and specific — cite real product names, real pricing tiers, real feature names from the KB
- Honest about limitations — tell them when Cloudflare isn't the right fit
- Practical — give them something they can use TODAY in a call
- No corporate-speak — talk like the most helpful senior SE on the team

When answering objections, use this format:
  1. Acknowledge the concern (1 sentence)
  2. Reframe (1-2 sentences)
  3. Proof point or specific response — cite specific KB facts here (2-3 sentences)
  4. Bridge to next step (1 sentence)

When explaining integration steps or technical processes:
  - Give numbered steps if the KB has them
  - Include time estimates if available
  - Name specific configuration values, URLs, or formats if known
  - Flag gotchas explicitly (e.g. "Auth0 free tier doesn't include SAML")

When answering deal strategy questions (manager role):
  - Cite the specific approval tiers and percentages
  - Give concrete action steps, not vague advice
  - Focus on what the manager should DO next, not what Cloudflare products exist

User: ${userContext.name} (${userContext.role.toUpperCase()} at org: ${userContext.orgId})${ltmContext}`;
  }

  protected async dispatchTools(
    message: string,
    userContext: UserContext,
    toolCalls: ToolCall[],
    capturedChunks?: RetrievedChunk[]
  ): Promise<string | null> {
    const contextParts: string[] = [];

    // Select namespace hint based on message content + role
    const namespace = selectNamespace(message, userContext.role);

    // ── 1. KB search (primary tool for enablement — always try first) ──────────
    const kbResult = await kbSearch(
      message,
      userContext.role,
      userContext.orgId,
      this.env,
      toolCalls,
      namespace,
      capturedChunks
    );

    if (kbResult) {
      contextParts.push(kbResult);
    }

    // ── 2. Web search fallback (only if KB returned nothing useful) ─────────────
    // Enablement is mostly KB-driven. Web search is a last resort for very
    // recent product announcements or edge cases not in the KB yet.
    if (!kbResult) {
      const webResult = await webSearch(
        `Cloudflare ${message}`,
        userContext.role,
        userContext.orgId,
        this.env,
        toolCalls
      );
      if (webResult) contextParts.push(webResult);
    }

    return contextParts.length > 0 ? contextParts.join("\n\n---\n\n") : null;
  }
}
