import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { clients } from "@openpims/db";
import { db } from "@openpims/db/client";
import { toApiClient } from "@/lib/compat/openvpm";
import { paginated, parsePagination } from "@/lib/compat/shared/pagination";
import { authenticateApiKey } from "@/lib/api-auth";

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
    return NextResponse.json(paginated(rows.map(toApiClient), { limit, offset }, total));
  } catch (error) {
    console.error("GET /api/v1/clients failed", error);
    return NextResponse.json({ error: { message: "Internal error" } }, { status: 500 });
  }
}
