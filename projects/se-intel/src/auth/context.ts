/**
 * auth/context.ts
 *
 * JWT validation and UserContext construction.
 *
 * In the portfolio environment we use a simple HS256 JWT signed with
 * JWT_SECRET (set via wrangler secret). This lets us demo the multi-user
 * RBAC story without requiring Cloudflare Access SSO setup.
 *
 * In production, Cloudflare Access validates the JWT before the request
 * hits the Worker — we just parse the already-verified cf-access-jwt-assertion
 * header and extract claims. No signature verification needed at the Worker
 * layer because Access has already done it.
 *
 * Security note: RBAC is enforced at tool execution time (in each tool's
 * handler), NOT just at this layer. This layer determines identity.
 * Tool-level enforcement is what actually prevents privilege escalation.
 */

import type { UserContext, Role, Env } from "../types/index.js";

const VALID_ROLES: Role[] = ["ae", "se", "csm", "tam", "sales_manager"];

function isValidRole(r: string): r is Role {
  return (VALID_ROLES as string[]).includes(r);
}

/**
 * Parse a base64url-encoded JWT segment without signature verification.
 * Used for the Access JWT path where the signature was already verified
 * by Cloudflare's infrastructure.
 */
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // base64url → base64 → decode
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Verify an HS256 JWT using the Workers SubtleCrypto API.
 * Used for the portfolio/dev environment where we issue our own tokens.
 */
async function verifyHs256Jwt(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const enc = new TextEncoder();
    const keyData = enc.encode(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Reconstruct the signed content
    const signingInput = enc.encode(`${parts[0]}.${parts[1]}`);

    // Decode the signature from base64url
    const sigB64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    const sigPadded = sigB64 + "=".repeat((4 - (sigB64.length % 4)) % 4);
    const sigBytes = Uint8Array.from(atob(sigPadded), (c) => c.charCodeAt(0));

    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, signingInput);
    if (!valid) return null;

    // Verify expiry
    const payload = parseJwtPayload(token);
    if (!payload) return null;
    const exp = payload["exp"] as number | undefined;
    if (exp && exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract UserContext from an incoming request.
 *
 * Priority order:
 * 1. cf-access-jwt-assertion header (production — Access-verified)
 * 2. Authorization: Bearer <token> (portfolio — our own HS256 tokens)
 * 3. X-Dev-User-* headers (local wrangler dev only)
 */
export async function extractUserContext(
  request: Request,
  env: Env
): Promise<UserContext | null> {
  // ── Path 1: Cloudflare Access (production) ─────────────────────────────────
  const accessJwt = request.headers.get("cf-access-jwt-assertion");
  if (accessJwt) {
    const payload = parseJwtPayload(accessJwt);
    if (!payload) return null;

    const role = (payload["custom:role"] as string) ?? "ae";
    if (!isValidRole(role)) return null;

    return {
      userId: (payload["sub"] as string) ?? "unknown",
      role,
      orgId: (payload["custom:org_id"] as string) ?? "cloudflare",
      name: (payload["name"] as string) ?? "Unknown User",
      email: (payload["email"] as string) ?? "",
    };
  }

  // ── Path 2: Bearer token (portfolio — HS256) ───────────────────────────────
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const secret = env.JWT_SECRET;

    if (!secret) {
      // No secret configured — reject in production, warn in dev
      if (env.ENVIRONMENT === "portfolio") {
        console.warn("[auth] JWT_SECRET not set — rejecting Bearer token");
      }
      return null;
    }

    const payload = await verifyHs256Jwt(token, secret);
    if (!payload) return null;

    const role = (payload["role"] as string) ?? "ae";
    if (!isValidRole(role)) return null;

    return {
      userId: (payload["sub"] as string) ?? "unknown",
      role,
      orgId: (payload["org_id"] as string) ?? "portfolio-org",
      name: (payload["name"] as string) ?? "Portfolio User",
      email: (payload["email"] as string) ?? "",
    };
  }

  // ── Path 3: Dev headers (local wrangler dev only) ──────────────────────────
  // NEVER trust these in portfolio or production environments.
  if (env.ENVIRONMENT === "development") {
    const devUserId = request.headers.get("X-Dev-User-Id");
    const devRole = request.headers.get("X-Dev-User-Role");
    const devName = request.headers.get("X-Dev-User-Name");

    if (devUserId && devRole && isValidRole(devRole)) {
      return {
        userId: devUserId,
        role: devRole,
        orgId: "dev-org",
        name: devName ?? devUserId,
        email: `${devUserId}@dev.local`,
      };
    }
  }

  return null;
}

/**
 * Generate a test JWT for the portfolio environment.
 * Called by the /dev/token endpoint (disabled in production).
 *
 * Usage:
 *   curl -X POST https://se-intel-portfolio.workers.dev/dev/token \
 *     -H "Content-Type: application/json" \
 *     -d '{"userId":"alice","role":"se","name":"Alice Chen"}'
 */
export async function generateDevToken(
  userId: string,
  role: Role,
  name: string,
  orgId: string,
  secret: string
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    role,
    name,
    email: `${userId}@portfolio.dev`,
    org_id: orgId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400, // 24h
  };

  const enc = new TextEncoder();
  const toB64Url = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

  const headerB64 = toB64Url(header);
  const payloadB64 = toB64Url(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  const sigB64Url = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return `${signingInput}.${sigB64Url}`;
}
