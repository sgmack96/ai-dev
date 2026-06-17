/**
 * scripts/seed-kb.ts
 *
 * Seeds the Vectorize index with all KB chunks across 3 namespaces.
 *
 * Run after deployment:
 *   npx wrangler d1 execute se-intel-portfolio-db --file=schema.sql --remote
 *   curl -X POST https://se-intel-portfolio.workers.dev/admin/seed
 *
 * Or run locally against remote Vectorize:
 *   npx tsx scripts/seed-kb.ts
 *
 * This script is called by the Worker's /admin/seed endpoint.
 * It can also be run as a standalone script using the Cloudflare REST API.
 *
 * Architecture:
 * - Reads all chunks from knowledge-base/ directories
 * - Embeds each chunk using Workers AI BGE-base-en-v1.5 (768 dims)
 * - Upserts into Vectorize with namespace metadata for role-gated filtering
 * - Batches requests (max 100 vectors per upsert per Vectorize limit)
 */

// This module is imported by the Worker's admin route.
// The actual embedding + upsert happens via Worker bindings.

export interface SeedChunk {
  id: string;
  text: string;
  namespace: "public" | "se_only" | "manager_only";
  metadata: Record<string, string>;
}

/**
 * All KB chunks across all namespaces.
 * Imported by the Worker's /admin/seed endpoint.
 */
export async function getAllChunks(): Promise<SeedChunk[]> {
  const chunks: SeedChunk[] = [];

  // ── Public namespace (reused from ai-sales-copilot) ──────────────────────────
  const { cloudflareProductChunks } = await import(
    "../knowledge-base/public/cloudflare-docs.js"
  );
  for (const chunk of cloudflareProductChunks) {
    chunks.push({
      id: `public_${chunk.id}`,
      text: chunk.text,
      namespace: "public",
      metadata: {
        namespace: "public",
        orgId: "global", // universal product knowledge — every tenant is entitled to it
        productName: chunk.metadata.product,
        category: chunk.metadata.category,
        type: chunk.metadata.type,
        keywords: chunk.metadata.keywords,
        content: chunk.text, // stored in metadata for retrieval without separate fetch
      },
    });
  }

  // ── SE-only namespace ─────────────────────────────────────────────────────────
  const { seOnlyChunks } = await import(
    "../knowledge-base/se-only/technical-playbook.js"
  );
  for (const chunk of seOnlyChunks) {
    chunks.push({
      id: `se_only_${chunk.id}`,
      text: chunk.text,
      namespace: "se_only",
      metadata: {
        namespace: "se_only",
        orgId: "global", // universal SE knowledge — tenant-agnostic, role-gated only
        topic: chunk.metadata.topic,
        type: chunk.metadata.type,
        keywords: chunk.metadata.keywords,
        content: chunk.text,
      },
    });
  }

  // ── Manager-only namespace ────────────────────────────────────────────────────
  const { managerOnlyChunks } = await import(
    "../knowledge-base/manager-only/deal-strategy.js"
  );
  for (const chunk of managerOnlyChunks) {
    chunks.push({
      id: `manager_only_${chunk.id}`,
      text: chunk.text,
      namespace: "manager_only",
      metadata: {
        namespace: "manager_only",
        orgId: "global", // universal manager knowledge — tenant-agnostic, role-gated only
        topic: chunk.metadata.topic,
        type: chunk.metadata.type,
        keywords: chunk.metadata.keywords,
        content: chunk.text,
      },
    });
  }

  // ── Test tenant: "acme" private chunks ───────────────────────────────────────
  // Tenant-private knowledge, NOT global. Used to prove cross-org isolation:
  // a query from org "portfolio-org" must NEVER return these. namespace "public"
  // so the ROLE gate doesn't mask the test — isolation here is purely the TENANT gate.
  const acmePrivateChunks: Array<{ id: string; text: string }> = [
    {
      id: "acme_discount",
      text: "Acme Corp internal: our negotiated Cloudflare discount is 35% off list price, approved through 2027. Do not share externally.",
    },
    {
      id: "acme_deal",
      text: "Acme Corp internal: migration deadline is Q3, CTO is Jane Doe, primary blocker is a legacy Akamai contract expiring in August.",
    },
    {
      id: "acme_security",
      text: "Acme Corp internal — confidential: our last security audit flagged three open WAF gaps on the checkout service. Remediation in progress.",
    },
  ];
  for (const chunk of acmePrivateChunks) {
    chunks.push({
      id: `acme_${chunk.id}`,
      text: chunk.text,
      namespace: "public",
      metadata: {
        namespace: "public",
        orgId: "acme", // tenant-private — only org "acme" may retrieve these
        type: "tenant_private",
        keywords: "acme internal confidential",
        content: chunk.text,
      },
    });
  }

  return chunks;
}

/**
 * Seed the Vectorize index from within a Worker context.
 * Called by POST /admin/seed.
 *
 * @param env - Worker bindings (AI + VECTORIZE)
 * @returns Seed result summary
 */
export async function seedVectorize(env: {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
}): Promise<{ total: number; batches: number; errors: string[] }> {
  const BATCH_SIZE = 20; // embed 20 at a time to avoid timeout
  const UPSERT_BATCH = 100; // Vectorize max per upsert

  const chunks = await getAllChunks();
  const errors: string[] = [];
  let embeddedCount = 0;
  let batchCount = 0;

  const vectorsToUpsert: VectorizeVector[] = [];

  // Process in embedding batches
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.text);

    try {
      const embedResponse = await env.AI.run(
        "@cf/baai/bge-base-en-v1.5" as "@cf/baai/bge-base-en-v1.5",
        { text: texts }
      );
      const embeddings = (embedResponse as { data?: number[][] }).data;

      if (!embeddings || embeddings.length !== texts.length) {
        errors.push(`Batch ${batchCount}: embedding count mismatch`);
        continue;
      }

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const embedding = embeddings[j];

        if (!embedding || embedding.length === 0) {
          errors.push(`Chunk ${chunk.id}: empty embedding`);
          continue;
        }

        vectorsToUpsert.push({
          id: chunk.id,
          values: embedding,
          metadata: chunk.metadata,
        });
        embeddedCount++;
      }

      batchCount++;
      console.log(
        `[seed] Embedded batch ${batchCount}: ${batch.length} chunks (total: ${embeddedCount})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Batch ${batchCount} embedding failed: ${msg}`);
      console.error(`[seed] Batch ${batchCount} error:`, err);
    }
  }

  // Upsert into Vectorize in batches of 100
  let upsertBatches = 0;
  for (let i = 0; i < vectorsToUpsert.length; i += UPSERT_BATCH) {
    const upsertBatch = vectorsToUpsert.slice(i, i + UPSERT_BATCH);
    try {
      await env.VECTORIZE.upsert(upsertBatch);
      upsertBatches++;
      console.log(
        `[seed] Upserted batch ${upsertBatches}: ${upsertBatch.length} vectors`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Upsert batch ${upsertBatches} failed: ${msg}`);
      console.error(`[seed] Upsert error:`, err);
    }
  }

  return {
    total: embeddedCount,
    batches: batchCount,
    errors,
  };
}
