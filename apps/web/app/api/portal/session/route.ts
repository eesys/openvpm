import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, portalSessions, practices } from "@openpims/db";
import { db } from "@openpims/db/client";
import {
  generatePortalSessionToken,
  hashPortalAccessToken,
  hashPortalRequestMetadata,
  hashPortalSessionToken,
  PORTAL_ACCESS_TOKEN_MAX_LENGTH,
} from "@/lib/portal/tokens";
import {
  portalSessionCookieName,
  portalSessionCookieOptions,
  portalSessionExpiresAt,
  portalSessionTokenFromCookie,
} from "@/lib/portal/session";

const exchangeInput = z.object({
  token: z.string().trim().min(1).max(PORTAL_ACCESS_TOKEN_MAX_LENGTH),
});
const GENERIC_ERROR =
  "This portal link is invalid or has expired. Please ask your clinic for a new link.";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try {
    return origin === new URL(`${new URL(request.url).protocol}//${host}`).origin;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: GENERIC_ERROR }, 400);
  }
  const parsed = exchangeInput.safeParse(body);
  if (!parsed.success) return json({ error: GENERIC_ERROR }, 400);

  const now = new Date();
  const rawSessionToken = generatePortalSessionToken();
  const accessTokenHash = hashPortalAccessToken(parsed.data.token);

  let claimed = false;
  try {
    claimed = await db.transaction(async (tx) => {
      const [client] = await tx
        .update(clients)
        .set({ portalAccessTokenUsedAt: now })
        .where(
          and(
            eq(clients.accessToken, accessTokenHash),
            isNull(clients.portalAccessTokenUsedAt),
            gt(clients.portalAccessTokenExpiresAt, now),
            isNull(clients.deletedAt),
            sql`exists (
              select 1 from ${practices}
              where ${practices.id} = ${clients.practiceId}
                and ${practices.deletedAt} is null
            )`,
          ),
        )
        .returning({ id: clients.id, practiceId: clients.practiceId });
      if (!client) return false;
      await tx.insert(portalSessions).values({
        practiceId: client.practiceId,
        clientId: client.id,
        tokenHash: hashPortalSessionToken(rawSessionToken),
        lastSeenAt: now,
        expiresAt: portalSessionExpiresAt(now),
        createdIpHash: hashPortalRequestMetadata(
          req.headers.get("x-forwarded-for") ?? null,
        ),
        userAgentHash: hashPortalRequestMetadata(req.headers.get("user-agent")),
      });
      return true;
    });
  } catch (error) {
    console.error("[portal-session] exchange failed", error);
    return json({ error: "Portal access is temporarily unavailable." }, 500);
  }

  if (!claimed) return json({ error: GENERIC_ERROR }, 404);

  const response = json({ redirectTo: "/portal" });
  response.cookies.set(
    portalSessionCookieName(),
    rawSessionToken,
    portalSessionCookieOptions(now),
  );
  return response;
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Invalid request origin" }, 403);
  const rawSessionToken = portalSessionTokenFromCookie(req.headers.get("cookie"));
  if (rawSessionToken) {
    await db
      .update(portalSessions)
      .set({ revokedAt: new Date(), revokedReason: "client_logout" })
      .where(
        and(
          eq(portalSessions.tokenHash, hashPortalSessionToken(rawSessionToken)),
          isNull(portalSessions.revokedAt),
        ),
      );
  }
  const response = json({ ok: true });
  response.cookies.set(portalSessionCookieName(), "", {
    ...portalSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
