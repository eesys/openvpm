import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@openpims/db/client";
import { usageRecords } from "@openpims/db";
import { billingEnforced } from "./plans";

export type UsageKind = "sms" | "ai_run";

/** Current billing period as YYYY-MM (UTC). */
export function currentPeriodMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Record a metered usage event. No-op on self-host (billing not enforced).
 * Caller-safe: logs failures internally and never throws into the user workflow.
 */
export async function recordUsage(opts: {
  practiceId: string;
  kind: UsageKind;
  quantity?: number;
  now?: Date;
}): Promise<void> {
  if (!billingEnforced()) return; // self-host never meters
  try {
    await db.insert(usageRecords).values({
      practiceId: opts.practiceId,
      kind: opts.kind,
      quantity: opts.quantity ?? 1,
      periodMonth: currentPeriodMonth(opts.now),
    });
  } catch (error) {
    console.error("[usage] failed to record", opts.kind, error);
  }
}

/** Sum a practice's usage of one kind in a period (defaults to current month). */
export async function usageForPractice(
  practiceId: string,
  kind: UsageKind,
  periodMonth: string = currentPeriodMonth(),
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${usageRecords.quantity}), 0)::int`,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.practiceId, practiceId),
        eq(usageRecords.kind, kind),
        eq(usageRecords.periodMonth, periodMonth),
        isNull(usageRecords.deletedAt),
      ),
    );
  return Number(row?.total ?? 0);
}
