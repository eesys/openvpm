import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, portalSessions, practices } from "@openpims/db";
import { db } from "@openpims/db/client";
import { PORTAL_SESSION_COOKIE } from "@/server/trpc";

const PORTAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GENERIC_ERROR =
  "This portal link is invalid or has expired. Please ask your clinic for a new link.";

const exchangeInput = z.object({
  token: z.string().trim().min(1).max(64),
});

export async function POST(request: Request) {
  const parsed = exchangeInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const now = new Date();
  const accessTokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const rawSessionToken = randomBytes(32).toString("hex");
  const sessionTokenHash = createHash("sha256").update(rawSessionToken).digest("hex");

  const claimed = await db.transaction(async (tx) => {
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
      tokenHash: sessionTokenHash,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + PORTAL_SESSION_TTL_MS),
    });
    return true;
  });

  if (!claimed) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 404 });
  }

  const response = NextResponse.json({ redirectTo: "/portal" });
  response.cookies.set(PORTAL_SESSION_COOKIE, rawSessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(now.getTime() + PORTAL_SESSION_TTL_MS),
  });
  return response;
}
