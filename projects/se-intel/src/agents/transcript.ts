/**
 * agents/transcript.ts
 *
 * TranscriptAgent — Durable Object for post-call transcript analysis.
 *
 * What it does:
 * - Takes a raw call transcript or meeting notes
 * - Extracts structured CRM-ready data:
 *     - Executive summary (2-3 sentences)
 *     - Key topics discussed
 *     - Action items with owners and deadlines
 *     - Objections raised and how they were handled
 *     - Champion signals (who advocated, what they said)
 *     - Technical requirements identified
 *     - Competitive mentions
 *     - Recommended next steps
 *     - Risk/red flag signals
 * - Role-gated: SE sees technical requirements emphasis,
 *   Manager sees deal risk emphasis, AE sees next steps emphasis
 *
 * Example prompts:
 *   "Analyze this transcript: [paste 1000 words of call notes]"
 *   "Here are my call notes from a meeting with Stripe's platform team..."
 *   "Extract CRM notes from this: We discussed their migration from AWS..."
 *
 * This agent does NOT use RAG — it's pure reasoning over the provided text.
 * The KB is not relevant for transcript analysis (the transcript IS the data).
 */

import { BaseAgent } from "./base-agent.js";
import type { Env, ToolCall, UserContext } from "../types/index.js";

export class TranscriptAgent extends BaseAgent {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, "transcript");
  }

  protected buildSystemPrompt(userContext: UserContext, ltmContext: string): string {
    const roleEmphasis: Record<string, string> = {
      ae: "Emphasize next steps, buying signals, and deal progression. The AE needs to know: what to put in the CRM, who to follow up with, and what the next meeting should cover.",
      se: "Emphasize technical requirements, architecture decisions, and POC scope. The SE needs to know: what to build, what the customer's constraints are, and what technical proof points were most compelling.",
      csm: "Emphasize adoption signals, satisfaction indicators, and expansion opportunities. The CSM needs to know: are they happy, what's at risk, and where can we grow?",
      tam: "Emphasize technical health signals, proactive recommendations, and QBR-worthy insights. The TAM needs to know: what's working, what's at risk, and what to recommend proactively.",
      sales_manager: "Emphasize deal risk signals, champion quality, competitive threats, and forecast accuracy. The manager needs to know: is this deal real, what's the blocker, and how to coach the rep.",
    };

    const emphasis = roleEmphasis[userContext.role] ?? roleEmphasis["ae"];

    return `You are a senior sales operations analyst who converts raw call transcripts and meeting notes into structured CRM-ready intelligence.

${emphasis}

You will receive a call transcript, meeting notes, or unstructured text from a sales conversation. Extract and return a structured analysis.

RULES:
- Extract only what's explicitly stated or strongly implied — do NOT infer facts that aren't in the transcript
- If something wasn't discussed, say "Not discussed" rather than making assumptions
- Quote specific phrases from the transcript when identifying champion signals or objections
- Action items must have a specific owner (if mentioned) and timeframe (if mentioned)
- Be honest about red flags — a stalled deal with no champion is a red flag, even if the rep doesn't realize it

OUTPUT FORMAT (follow this structure exactly):

**Executive Summary**
2-3 sentences capturing the most important outcome of this conversation.

**Key Topics Discussed**
Numbered list of the main topics covered.

**Action Items**
- [Owner] Action description — by [date/timeframe] if mentioned

**Objections Raised**
- Objection: "exact or paraphrased quote"
  How it was handled: description
  Status: resolved / unresolved / deferred

**Champion Signals**
- Who showed champion behavior and what specifically they said or did
- If no clear champion, flag this explicitly as a risk

**Technical Requirements**
- Specific technical needs, constraints, or decisions mentioned
- Integration requirements, compliance needs, timeline constraints

**Competitive Mentions**
- Any competitor or alternative solution mentioned, with context

**Recommended Next Steps**
Numbered list, specific and actionable.

**Risk Signals**
- Any red flags: stalled decisions, missing stakeholders, budget concerns, timeline slips

User: ${userContext.name} (${userContext.role.toUpperCase()} at org: ${userContext.orgId})${ltmContext}`;
  }

  protected async dispatchTools(
    _message: string,
    _userContext: UserContext,
    _toolCalls: ToolCall[]
  ): Promise<string | null> {
    // Transcript analysis is pure reasoning — no tools needed.
    // The transcript text IS the data; there's nothing to retrieve.
    return null;
  }
}
