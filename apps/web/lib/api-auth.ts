import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apiKeys, practices } from "@openpims/db";
import { db } from "@openpims/db/client";
import { API_KEY_HASH_COST } from "@/lib/auth-hashing";
import { withSystem } from "@/lib/tenant-db";

/** Public prefix for every issued key. Also used as the human-visible label. */
export const API_KEY_PREFIX = "ovpm_";
/** Length of the stored, indexed lookup prefix (e.g. "ovpm_AbC1234"). */
const LOOKUP_PREFIX_LEN = 12;
/** Hard cap for presented keys so public auth can't spend work on huge inputs. */
const API_KEY_MAX_LENGTH = 128;
const API_KEY_BODY_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface ApiKeyContext {
  practiceId: string;
  apiKeyId: string;
  scopes: string[];
}

export type AuthResult =
  | { ok: true; ctx: ApiKeyContext }
  | { ok: false; response: NextResponse };

/**
 * Generate a new API key. Returns the raw key (shown to the user exactly once),
 * the indexed lookup prefix, and the bcrypt hash to persist. The raw key is
 * never stored.
 */
export async function generateApiKey(): Promise<{
  raw: string;
  prefix: string;
  hash: string;
}> {
  const raw = API_KEY_PREFIX + randomBytes(24).toString("base64url");
  const prefix = raw.slice(0, LOOKUP_PREFIX_LEN);
  const hash = await bcrypt.hash(raw, API_KEY_HASH_COST);
  return { raw, prefix, hash };
}

/** Extract the raw key from `Authorization: Bearer` (preferred) or `X-API-Key`. */
export function extractApiKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const headerKey = headers.get("x-api-key");
  if (headerKey) return headerKey.trim();
  return null;
}

/** `*` grants everything; otherwise the exact scope must be present. */
export function hasScope(scopes: string[], required: string): boolean {
  return scopes.includes("*") || scopes.includes(required);
}

function hasApiKeyShape(raw: string): boolean {
  if (!raw.startsWith(API_KEY_PREFIX)) return false;
  if (raw.length <= LOOKUP_PREFIX_LEN) return false;
  if (raw.length > API_KEY_MAX_LENGTH) return false;
  return API_KEY_BODY_PATTERN.test(raw.slice(API_KEY_PREFIX.length));
}

function err(
  message: string,
  status: number,
): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ error: { message } }, { status }),
  };
}

/**
 * Authenticate a request via API key and assert it carries `requiredScope`.
 *
 * Flow: parse header → narrow candidates by indexed prefix → bcrypt compare →
 * active-practice check → scope check → return tenant context. The caller
 * MUST still scope every query by `ctx.practiceId`.
 */
export async function authenticateApiKey(
  req: Request,
  requiredScope: string,
): Promise<AuthResult> {
  const raw = extractApiKey(req.headers);
  if (!raw) {
    return err(
      "Missing API key. Send 'Authorization: Bearer <key>' or 'X-API-Key'.",
      401,
    );
  }

  if (!hasApiKeyShape(raw)) {
    return err("Invalid API key.", 401);
  }

  const prefix = raw.slice(0, LOOKUP_PREFIX_LEN);

  let candidates;
  try {
    candidates = await withSystem(db, (tx) =>
      tx
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.deletedAt))),
    );
  } catch (error) {
    console.error("[api-auth] key lookup failed:", error);
    return err("Internal error", 500);
  }

  let matched: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (await bcrypt.compare(raw, candidate.keyHash)) {
      matched = candidate;
      break;
    }
  }

  if (!matched) {
    return err("Invalid API key.", 401);
  }

  let practice: { id: string } | undefined;
  try {
    [practice] = await withSystem(db, (tx) =>
      tx
        .select({ id: practices.id })
        .from(practices)
        .where(
          and(eq(practices.id, matched.practiceId), isNull(practices.deletedAt)),
        )
        .limit(1),
    );
  } catch (error) {
    console.error("[api-auth] practice lookup failed:", error);
    return err("Internal error", 500);
  }

  if (!practice) {
    return err("Invalid API key.", 401);
  }

  const scopes = Array.isArray(matched.scopes) ? matched.scopes : [];
  if (!hasScope(scopes, requiredScope)) {
    return err(`API key missing required scope: ${requiredScope}`, 403);
  }

  void withSystem(db, (tx) =>
    tx
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, matched.id)),
  ).catch((error) => console.error("[api-auth] lastUsedAt update failed:", error));

  return {
    ok: true,
    ctx: { practiceId: matched.practiceId, apiKeyId: matched.id, scopes },
  };
}

/** Scopes a practice admin can grant to an API key. */
export const API_SCOPES = [
  "clients:read",
  "patients:read",
  "appointments:read",
  "appointments:write",
  "records:write",
  "agent:run",
  "agent:write",
  "*",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function apiScopesHaveValidDependencies(
  scopes: readonly ApiScope[],
): boolean {
  return (
    !scopes.includes("agent:write") ||
    scopes.includes("agent:run") ||
    scopes.includes("*")
  );
}
