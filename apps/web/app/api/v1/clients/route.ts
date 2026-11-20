import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { clients } from "@openpims/db";
import { db } from "@openpims/db/client";
import { authenticateApiKey } from "@/lib/api-auth";
import { assertActivePractice } from "@/lib/compat/shared/active-practice";
import { withErrorHandling } from "@/lib/compat/shared/errors";
import { paginated, parsePagination } from "@/lib/compat/shared/pagination";
import { toApiClient } from "@/lib/compat/openvpm";

export const dynamic = "force-dynamic";

// GET /api/v1/clients — list clients for the authenticated practice.
export async function GET(req: Request) {
  const auth = await authenticateApiKey(req, "clients:read");
  if (!auth.ok) return auth.response;

  return withErrorHandling(async () => {
    const activePractice = await assertActivePractice(db, auth.ctx.practiceId);
    if (!activePractice.ok) return activePractice.response;

    const { searchParams } = new URL(req.url);
    const { limit, offset } = parsePagination(searchParams);
    const where = and(
      eq(clients.practiceId, auth.ctx.practiceId),
      isNull(clients.deletedAt),
    );

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(clients)
        .where(where)
        .orderBy(desc(clients.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(clients).where(where),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    return NextResponse.json(
      paginated(rows.map(toApiClient), { limit, offset }, total),
    );
  });
}
