/**
 * tools/news.ts
 *
 * NewsAPI integration for recent news about prospect companies.
 * Used by AccountIntelAgent to surface recent funding, incidents,
 * leadership changes, and product launches before a sales call.
 *
 * Access: se, tam, sales_manager (same as web search — needs NEWS_API_KEY secret).
 * ae/csm don't need raw news — they get curated account intel from the KB.
 *
 * Free Developer plan limitation:
 * - Only returns articles from the last 30 days
 * - 100 requests/day
 * - "Everything" endpoint for full search
 *
 * Error handling:
 * - Missing API key → return null silently (not an error, just not configured)
 * - API error → return null (don't break the agent over a news lookup)
 * - No results → return null (caller falls back to web search)
 */

import type { Env, Role, ToolCall } from "../types/index.js";

const NEWS_ROLES: Role[] = ["se", "tam", "sales_manager"];
const MAX_ARTICLES = 5;
// NewsAPI free tier: articles from last 30 days
const DAYS_BACK = 30;

interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  publishedAt: string;
  source: { name: string };
}

interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsArticle[];
}

/**
 * Search for recent news about a company or topic.
 *
 * @param query     - Company name or topic (e.g. "Stripe", "Stripe funding")
 * @param role      - Checked against NEWS_ROLES
 * @param env       - Worker bindings (needs NEWS_API_KEY)
 * @param toolCalls - Audit array
 */
export async function fetchNews(
  query: string,
  role: Role,
  env: Env,
  toolCalls: ToolCall[]
): Promise<string | null> {
  const start = Date.now();

  // Role gate
  if (!NEWS_ROLES.includes(role)) {
    return null;
  }

  // API key required
  const apiKey = (env as Env & { NEWS_API_KEY?: string }).NEWS_API_KEY;
  if (!apiKey) {
    console.warn("[news] NEWS_API_KEY not configured — skipping news lookup");
    return null;
  }

  // Date range: last 30 days (free tier limit)
  const from = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const params = new URLSearchParams({
    q: query,
    from,
    sortBy: "relevancy",
    language: "en",
    pageSize: String(MAX_ARTICLES),
    apiKey,
  });

  try {
    const resp = await fetch(
      `https://newsapi.org/v2/everything?${params.toString()}`,
      {
        headers: { "User-Agent": "se-intel-agent/1.0" },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!resp.ok) {
      console.error(`[news] NewsAPI returned ${resp.status}`);
      return null;
    }

    const data = (await resp.json()) as NewsApiResponse;

    if (data.status !== "ok" || data.articles.length === 0) {
      return null;
    }

    const durationMs = Date.now() - start;
    toolCalls.push({
      toolName: "news_search",
      args: { query, role },
      result: { count: data.articles.length, totalResults: data.totalResults },
      durationMs,
    });

    const formatted = data.articles
      .slice(0, MAX_ARTICLES)
      .map((a, i) => {
        const date = new Date(a.publishedAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
        const desc = a.description ? `\n   ${a.description}` : "";
        return `${i + 1}. [${a.source.name}] ${a.title} (${date})${desc}\n   ${a.url}`;
      })
      .join("\n\n");

    return `Recent News for "${query}" (last ${DAYS_BACK} days):\n\n${formatted}`;
  } catch (err) {
    console.error("[news] Fetch error:", err);
    return null;
  }
}
