/**
 * tools/kb-search.ts
 *
 * Vectorize RAG search tool — the core knowledge retrieval layer.
 *
 * Access control:
 * - ROLE_KB_ACCESS (from types/index.ts) defines which namespaces each role can query.
 * - Enforcement happens HERE at execution time, not just at the router layer.
 *   This means even if a bug in the orchestrator passes the wrong role,
 *   the tool itself will reject the query.
 *
 * Flow:
 *   1. Embed the query using Workers AI BGE embeddings
 *   2. Search Vectorize with a namespace filter (role-gated)
 *   3. Return top-K chunks formatted for prompt injection
 *
 * Fallback:
 *   If Vectorize returns no results, returns null so the caller
 *   can fall back to web search or answer from model knowledge.
 */

import type { Env, KBNamespace, Role, ToolCall } from "../types/index.js";
import { ROLE_KB_ACCESS } from "../types/index.js";

const TOP_K = 5;
const MIN_SCORE = 0.5; // cosine similarity threshold

export interface KBSearchResult {
  namespace: KBNamespace;
  content: string;
  score: number;
  productName?: string | undefined;
}

/**
 * Search the knowledge base for chunks relevant to a query.
 *
 * @param query     - Natural language query from the agent
 * @param role      - User's role — used to gate namespace access
 * @param env       - Worker bindings
 * @param toolCalls - Audit array to append this tool call to
 * @param namespace - Optional: restrict to a specific namespace
 */
export async function kbSearch(
  query: string,
  role: Role,
  env: Env,
  toolCalls: ToolCall[],
  namespace?: KBNamespace
): Promise<string | null> {
  const start = Date.now();

  // Determine which namespaces this role is allowed to query
  const allowedNamespaces = ROLE_KB_ACCESS[role];

  // If a specific namespace was requested, verify access
  if (namespace && !allowedNamespaces.includes(namespace)) {
    console.warn(
      `[kb-search] Role ${role} attempted to access namespace ${namespace} — denied`
    );
    return null;
  }

  // Query all allowed namespaces (or just the requested one)
  const namespacesToQuery = namespace ? [namespace] : allowedNamespaces;

  let allResults: KBSearchResult[] = [];

  try {
    // Embed the query
    const embedResponse = await env.AI.run(
      "@cf/baai/bge-base-en-v1.5" as "@cf/baai/bge-base-en-v1.5",
      { text: [query] }
    );

    const queryVector = (embedResponse as { data?: number[][] }).data?.[0];

    if (!queryVector || queryVector.length === 0) {
      console.error("[kb-search] Embedding returned empty vector");
      return null;
    }

    // Query each allowed namespace in parallel
    const searchPromises = namespacesToQuery.map(async (ns) => {
      try {
        const results = await env.VECTORIZE.query(queryVector, {
          topK: TOP_K,
          filter: { namespace: ns },
          returnMetadata: "all",
        });

        return results.matches
          .filter((m) => m.score >= MIN_SCORE)
          .map((m): KBSearchResult => ({
            namespace: ns,
            content: (m.metadata?.["content"] as string) ?? "",
            score: m.score,
            productName: (m.metadata?.["productName"] as string | undefined) ?? undefined,
          }));
      } catch (err) {
        console.error(`[kb-search] Vectorize query failed for namespace ${ns}:`, err);
        return [];
      }
    });

    const perNamespaceResults = await Promise.all(searchPromises);
    allResults = perNamespaceResults.flat();
  } catch (err) {
    console.error("[kb-search] Embedding error:", err);
    return null;
  }

  const durationMs = Date.now() - start;

  // Sort by score descending, cap at TOP_K total
  allResults.sort((a, b) => b.score - a.score);
  const topResults = allResults.slice(0, TOP_K);

  // Record tool call for audit log
  toolCalls.push({
    toolName: "kb_search",
    args: { query, role, namespace: namespace ?? "all_allowed" },
    result: { count: topResults.length, topScore: topResults[0]?.score ?? 0 },
    durationMs,
  });

  if (topResults.length === 0) {
    return null; // Signal to caller: fall back to web search
  }

  // Format results for injection into the system prompt
  const formatted = topResults
    .map((r, i) => {
      const label = r.productName ? `[${r.productName}]` : `[KB:${r.namespace}]`;
      return `${i + 1}. ${label} (relevance: ${(r.score * 100).toFixed(0)}%)\n${r.content}`;
    })
    .join("\n\n");

  return `Knowledge Base Results (${topResults.length} chunks from ${namespacesToQuery.join(", ")} namespace${namespacesToQuery.length > 1 ? "s" : ""}):\n\n${formatted}`;
}
