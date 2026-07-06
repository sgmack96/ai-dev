/**
 * memory/long-term.ts
 *
 * Cross-session user memory stored in Workers KV.
 *
 * Unlike short-term memory (conversation history in DO SQLite which resets
 * conceptually per session), long-term memory persists facts about the user
 * across ALL their conversations forever.
 *
 * Examples of what goes here:
 * - "Prefers responses without bullet points"
 * - "Working on Stripe account (Series C, 200 engineers)"
 * - "Has an upcoming QBR with Notion on June 15"
 *
 * Key format: `ltm:{orgId}:{userId}:{factId}`
 * We cap at MAX_FACTS per user — oldest facts are evicted when limit is reached.
 *
 * Why KV and not DO SQLite?
 * Long-term memory needs to be accessible from BOTH agent DOs (account agent
 * and enablement agent share the same user memory). A DO is scoped to one
 * class — you can't easily share DO storage across classes. KV is global and
 * accessible from any Worker context, making it the right layer for
 * cross-agent shared state.
 */

import type { Env } from "../types/index.js";

export const MAX_FACTS = 50; // per user

// Extraction model — small and fast, we don't need 70B for this task
const EXTRACT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Minimum characters in a response before we bother trying to extract facts.
// Short responses ("Got it", "Sure") won't contain useful facts.
const MIN_RESPONSE_LENGTH = 80;

export interface MemoryFact {
  id: string;
  content: string;
  timestamp: number;
  source: "user_stated" | "agent_inferred";
}

export class LongTermMemory {
  private userId: string;
  private orgId: string;
  private kv: KVNamespace;

  constructor(userId: string, orgId: string, env: Env) {
    this.userId = userId;
    this.orgId = orgId;
    this.kv = env.USER_MEMORY_KV;
  }

  private indexKey(): string {
    return `ltm:${this.orgId}:${this.userId}:__index`;
  }

  private factKey(factId: string): string {
    return `ltm:${this.orgId}:${this.userId}:${factId}`;
  }

  /**
   * Store a new memory fact.
   * Evicts the oldest fact if we're at the limit.
   */
  async remember(fact: Omit<MemoryFact, "id" | "timestamp">): Promise<MemoryFact> {
    const stored: MemoryFact = {
      ...fact,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };

    // Load current index
    const indexRaw = await this.kv.get(this.indexKey());
    const index: string[] = indexRaw ? (JSON.parse(indexRaw) as string[]) : [];

    // Evict oldest if at limit
    if (index.length >= MAX_FACTS) {
      const oldest = index.shift()!;
      await this.kv.delete(this.factKey(oldest));
    }

    // Store fact + update index
    index.push(stored.id);
    await Promise.all([
      this.kv.put(this.factKey(stored.id), JSON.stringify(stored), {
        expirationTtl: 60 * 60 * 24 * 365, // 1 year
      }),
      this.kv.put(this.indexKey(), JSON.stringify(index), {
        expirationTtl: 60 * 60 * 24 * 365,
      }),
    ]);

    return stored;
  }

  /**
   * Retrieve all memory facts for this user, newest first.
   */
  async recall(): Promise<MemoryFact[]> {
    const indexRaw = await this.kv.get(this.indexKey());
    if (!indexRaw) return [];

    const index: string[] = JSON.parse(indexRaw) as string[];
    if (index.length === 0) return [];

    const facts = await Promise.all(
      index.map(async (id) => {
        const raw = await this.kv.get(this.factKey(id));
        return raw ? (JSON.parse(raw) as MemoryFact) : null;
      })
    );

    return facts
      .filter((f): f is MemoryFact => f !== null)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Format memory facts as a concise string for injection into the system prompt.
   * Returns empty string if no facts exist (avoids cluttering the prompt).
   */
  async formatForPrompt(): Promise<string> {
    const facts = await this.recall();
    if (facts.length === 0) return "";

    const lines = facts
      .slice(0, 10) // cap at 10 most recent for prompt injection
      .map((f) => `- ${f.content}`);

    return `\n\nWhat I know about you from previous conversations:\n${lines.join("\n")}`;
  }

  /**
   * Extract memorable facts from one conversation turn using a short LLM call,
   * then persist them to KV.
   *
   * Called fire-and-forget after every agent response — never blocks the user.
   *
   * What counts as a memorable fact:
   * - Accounts the user is working on: "Working on Stripe deal (Series C)"
   * - User preferences: "Prefers bullet-point responses"
   * - Upcoming events: "QBR with Notion on June 15"
   * - Role context: "Focused on Zero Trust expansion this quarter"
   * - Named colleagues or contacts: "Champion at Stripe is their VP Eng, James"
   *
   * What does NOT count:
   * - Generic product information (that's in the KB)
   * - Questions the user asked (not facts about them)
   * - Agent responses (we're extracting facts about the USER, not the answer)
   */
  async extractAndRemember(
    userMessage: string,
    agentResponse: string,
    env: Env
  ): Promise<void> {
    // Skip if the exchange is too short to contain useful facts
    if (
      userMessage.length + agentResponse.length < MIN_RESPONSE_LENGTH
    ) {
      return;
    }

    const prompt = `You extract memorable personal facts about a user from a sales conversation.

USER MESSAGE: "${userMessage.slice(0, 400)}"
AGENT RESPONSE (first 300 chars): "${agentResponse.slice(0, 300)}"

Extract 0-2 short facts about the USER ONLY. A fact must be:
- Specific and personal to this user (not generic product info)
- Useful context for future conversations
- About: accounts they work on, their preferences, upcoming events, named contacts, their focus areas

Examples of GOOD facts:
- "Working on Stripe deal, Series C, ~200 engineers"
- "Prefers responses without bullet points"  
- "Has QBR with Notion on June 15"
- "Champion at Datadog is VP Eng named Sarah"
- "Focused on Zero Trust expansion this quarter"

Examples of BAD facts (do not extract these):
- "Asked about Workers vs Lambda" (this is a question, not a personal fact)
- "Cloudflare Workers has zero cold starts" (product info, not personal)
- "User is an SE" (too generic, already known from their role)

If there are no memorable personal facts in this exchange, return an empty array.

Return ONLY valid JSON, nothing else:
{"facts": ["fact 1", "fact 2"]}
or
{"facts": []}`;

    try {
      const result = await env.AI.run(
        EXTRACT_MODEL as "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        {
          messages: [
            {
              role: "system",
              content: "You extract facts and return only valid JSON. No explanation, no preamble.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 150,
          temperature: 0.1,
        },
        {
          gateway: {
            id: "se-intel-gateway",
            metadata: {
              user_id: this.userId,
              org_id: this.orgId,
              call_type: "ltm_extraction",
            },
          },
        }
      );

      const responseField = (result as { response?: unknown }).response;

      // Workers AI sometimes returns the JSON object directly (not as a string)
      // when the model responds with structured JSON. Handle both cases.
      let parsed: { facts?: unknown } | null = null;

      if (responseField && typeof responseField === "object") {
        // Already parsed — model returned JSON object directly
        parsed = responseField as { facts?: unknown };
      } else if (typeof responseField === "string") {
        const raw = responseField;
        // Strip markdown fences if present
        const cleaned = raw
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        // Find the JSON object
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) return;
        try {
          parsed = JSON.parse(match[0]) as { facts?: unknown };
        } catch {
          return;
        }
      } else {
        return;
      }

      if (!parsed) return;
      const facts = parsed.facts;

      if (!Array.isArray(facts) || facts.length === 0) return;

      // Store each fact — fire and forget, errors are non-fatal
      await Promise.allSettled(
        facts
          .filter((f): f is string => typeof f === "string" && f.trim().length > 5)
          .slice(0, 2) // hard cap at 2 per turn
          .map((content) =>
            this.remember({ content: content.trim(), source: "agent_inferred" })
          )
      );
    } catch {
      // Extraction is best-effort — never throw, never block the response
    }
  }
}
