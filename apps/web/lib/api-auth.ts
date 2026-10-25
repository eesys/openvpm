import { randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apiKeys, practices } from "@openpims/db";
import { db } from "@openpims/db/client";
import { withSystem } from "@/lib/tenant-db";

export const API_KEY_PREFIX = "ovpm_";
const LOOKUP_PREFIX_LENGTH = 12;
const API_KEY_MAX_LENGTH = 128;
const API_KEY_HASH_COST = 12;
const API_KEY_BODY_PATTERN = /^[A-Za-z0-9_-]+$/;

export const API_SCOPES = [
  "clients:read",
  "patients:read",
  "appointments:read",
  "appointments:write",
  "records:write",
  "*",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export type ApiKeyContext = {
  practiceId: string;
  apiKeyId: string;
  scopes: string[];
};

export type AuthResult =
  | { ok: true; ctx: ApiKeyContext }
  | { ok: false; response: NextResponse };

export async function generateApiKey(): Promise<{
  raw: string;
  prefix: string;
  keyHash: string;
}> {
  const raw = API_KEY_PREFIX + randomBytes(24).toString("base64url");
  const prefix = raw.slice(0, LOOKUP_PREFIX_LENGTH);
  const keyHash = await hash(raw, API_KEY_HASH_COST);
  return { raw, prefix, keyHash };
}

export function extractApiKey(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const bearer = authorization.slice("Bearer ".length).trim();
    return bearer || null;
  }
  const headerKey = headers.get("x-api-key")?.trim();
  return headerKey || null;
}

export function hasScope(scopes: string[], required: string): boolean {
  return scopes.includes("*") || scopes.includes(required);
}

function hasApiKeyShape(raw: string): boolean {
  if (!raw.startsWith(API_KEY_PREFIX)) return false;
  if (raw.length <= LOOKUP_PREFIX_LENGTH || raw.length > API_KEY_MAX_LENGTH) return false;
  return API_KEY_BODY_PATTERN.test(raw.slice(API_KEY_PREFIX.length));
}

function unauthorized(message: string, status: number): AuthResult {
  return {
    ok: false,
    response: NextResponse.json({ error: { message } }, { status }),
  };
}

export async function authenticateApiKey(
  req: Request,
  requiredScope: string,
): Promise<AuthResult> {
  const raw = extractApiKey(req.headers);
  if (!raw) {
    return unauthorized(
      "Missing API key. Send 'Authorization: Bearer <key>' or 'X-API-Key'.",
      401,
    );
  }
  if (!hasApiKeyShape(raw)) {
    return unauthorized("Invalid API key.", 401);
  }

  const prefix = raw.slice(0, LOOKUP_PREFIX_LENGTH);
  let candidates;
  try {
    candidates = await withSystem(db, (tx) =>
      tx
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.deletedAt))),
    );
  } catch (error) {
    console.error("API key lookup failed", error);
    return unauthorized("Internal error", 500);
  }

  let matched: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (await compare(raw, candidate.keyHash)) {
      matched = candidate;
      break;
    }
  }
  if (!matched) return unauthorized("Invalid API key.", 401);

  const [practice] = await withSystem(db, (tx) =>
    tx
      .select({ id: practices.id })
      .from(practices)
      .where(and(eq(practices.id, matched.practiceId), isNull(practices.deletedAt)))
      .limit(1),
  );
  if (!practice) return unauthorized("Invalid API key.", 401);

  const scopes = Array.isArray(matched.scopes) ? matched.scopes : [];
  if (!hasScope(scopes, requiredScope)) {
    return unauthorized(`API key missing required scope: ${requiredScope}`, 403);
  }

  try {
    await withSystem(db, (tx) =>
      tx
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(and(eq(apiKeys.id, matched.id), isNull(apiKeys.deletedAt))),
    );
  } catch (error) {
    console.error("API key lastUsedAt update failed", error);
  }

  return {
    ok: true,
    ctx: { practiceId: matched.practiceId, apiKeyId: matched.id, scopes },
  };
}
