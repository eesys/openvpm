import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { clients } from "@openpims/db";
import { db } from "@openpims/db/client";
import { toApiClient } from "@/lib/compat/openvpm";
import { paginated, parsePagination } from "@/lib/compat/shared/pagination";
import { authenticateApiKey } from "@/lib/api-auth";
import { withTenant } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req, "clients:read");
  if (!auth.ok) return auth.response;

  try {
    const { limit, offset } = parsePagination(new URL(req.url).searchParams);
    const where = and(
      eq(clients.practiceId, auth.ctx.practiceId),
      isNull(clients.deletedAt),
    );
    const { rows, total } = await withTenant(db, auth.ctx.practiceId, async (tx) => {
      const [found, countResult] = await Promise.all([
        tx
          .select()
          .from(clients)
          .where(where)
          .orderBy(desc(clients.createdAt))
          .limit(limit)
          .offset(offset),
        tx.select({ count: sql<number>`count(*)` }).from(clients).where(where),
      ]);
      return { rows: found, total: Number(countResult[0]?.count ?? 0) };
    });
    return NextResponse.json(paginated(rows.map(toApiClient), { limit, offset }, total));
  } catch (error) {
    console.error("GET /api/v1/clients failed", error);
    return NextResponse.json({ error: { message: "Internal error" } }, { status: 500 });
  }
}
