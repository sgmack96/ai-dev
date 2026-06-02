/**
 * auth/ratelimit.ts
 *
 * Per-user rate limiting using Workers KV.
 *
 * Strategy: sliding window counter with a 1-minute bucket.
 * Key format: `rl:{userId}:{bucket}` where bucket = Math.floor(now / 60000)
 *
 * Limits by role — managers get higher limits for bulk operations,
 * standard reps get conservative defaults to prevent runaway costs.
 */

import type { Role, RateLimitResult, Env } from "../types/index.js";

// Requests per minute per role
const RATE_LIMITS: Record<Role, number> = {
  ae:            20,
  csm:           20,
  se:            30,
  tam:           30,
  sales_manager: 50,
};

const WINDOW_MS = 60_000; // 1 minute

export async function checkRateLimit(
  userId: string,
  role: Role,
  env: Env
): Promise<RateLimitResult> {
  const limit = RATE_LIMITS[role];
  const now = Date.now();
  const bucket = Math.floor(now / WINDOW_MS);
  const key = `rl:${userId}:${bucket}`;
  const resetAt = (bucket + 1) * WINDOW_MS;

  // Read current count
  const current = await env.RATE_LIMIT_KV.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  // Increment — TTL of 2 minutes so keys clean themselves up
  await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: 120 });

  return {
    allowed: true,
    remaining: limit - (count + 1),
    resetAt,
  };
}
