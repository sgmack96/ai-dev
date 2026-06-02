/**
 * tools/web-search.ts
 *
 * Real-time web search via DuckDuckGo Instant Answer API.
 * Falls back to KB search if web search returns nothing useful.
 *
 * Why DuckDuckGo?
 * - No API key required — no secrets to manage, no cost
 * - Works from Workers (no CORS issues server-side)
 * - Returns structured Instant Answer + Related Topics
 * - Sufficient for company research, recent news summaries
 *
 * Limitations:
 * - Instant Answer API is not a full-text crawler — thin results for obscure queries
 * - That's fine: the RAG fallback handles depth, web search handles recency
 *
 * Tool access: se, tam, sales_manager only (not ae/csm — they use KB only)
 * Enforcement is at the agent's dispatchTools level, not here, because
 * web search has no inherent secrets — restriction is business policy, not security.
 */

import type { Env, Role, ToolCall } from "../types/index.js";
import { kbSearch } from "./kb-search.js";

// Roles allowed to use real-time web search
const WEB_SEARCH_ROLES: Role[] = ["se", "tam", "sales_manager"];

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
  source: "web" | "kb_fallback";
}

/**
 * DuckDuckGo Instant Answer search.
 * Returns null on network error or empty results.
 */
async function duckDuckGoSearch(query: string): Promise<WebSearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

  const resp = await fetch(url, {
    headers: { "User-Agent": "se-intel-agent/1.0" },
    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) return [];

  // DuckDuckGo can return HTML if something goes wrong — check content type
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return [];

  const data = (await resp.json()) as {
    Abstract?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    RelatedTopics?: Array<{
      Text?: string;
      FirstURL?: string;
      Topics?: Array<{ Text?: string; FirstURL?: string }>;
    }>;
    Results?: Array<{ Text?: string; FirstURL?: string }>;
  };

  const results: WebSearchResult[] = [];

  // Abstract (top result)
  if (data.Abstract && data.AbstractURL) {
    results.push({
      title: data.AbstractSource ?? "Abstract",
      snippet: data.Abstract,
      url: data.AbstractURL,
      source: "web",
    });
  }

  // Related topics (next best)
  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics.slice(0, 4)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.FirstURL,
          snippet: topic.Text,
          url: topic.FirstURL,
          source: "web",
        });
      }
      // Handle nested Topics
      if (topic.Topics) {
        for (const sub of topic.Topics.slice(0, 2)) {
          if (sub.Text && sub.FirstURL) {
            results.push({
              title: sub.FirstURL,
              snippet: sub.Text,
              url: sub.FirstURL,
              source: "web",
            });
          }
        }
      }
    }
  }

  // Direct Results
  if (data.Results) {
    for (const r of data.Results.slice(0, 2)) {
      if (r.Text && r.FirstURL) {
        results.push({
          title: r.FirstURL,
          snippet: r.Text,
          url: r.FirstURL,
          source: "web",
        });
      }
    }
  }

  return results;
}

/**
 * Web search with automatic KB fallback.
 *
 * If the user's role doesn't have web access, go straight to KB.
 * If web search returns results, return them.
 * If web search returns nothing useful, fall back to KB.
 * If both fail, return null.
 */
export async function webSearch(
  query: string,
  role: Role,
  env: Env,
  toolCalls: ToolCall[]
): Promise<string | null> {
  const start = Date.now();
  const hasWebAccess = WEB_SEARCH_ROLES.includes(role);

  // ── Attempt web search (if role allows) ─────────────────────────────────────
  if (hasWebAccess) {
    try {
      const webResults = await duckDuckGoSearch(query);

      if (webResults.length > 0) {
        const durationMs = Date.now() - start;
        toolCalls.push({
          toolName: "web_search",
          args: { query, role },
          result: { count: webResults.length, source: "duckduckgo" },
          durationMs,
        });

        const formatted = webResults
          .slice(0, 4)
          .map(
            (r, i) =>
              `${i + 1}. ${r.snippet}${r.url ? `\n   Source: ${r.url}` : ""}`
          )
          .join("\n\n");

        return `Web Search Results for "${query}":\n\n${formatted}`;
      }
    } catch (err) {
      console.warn("[web-search] DuckDuckGo failed, falling back to KB:", err);
    }
  }

  // ── KB fallback ──────────────────────────────────────────────────────────────
  // Either no web access, or web search returned nothing.
  const kbResult = await kbSearch(query, role, env, toolCalls);
  if (kbResult) {
    return `[Web search unavailable — using knowledge base]\n\n${kbResult}`;
  }

  return null;
}
