import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { practices } from "@openpims/db";
import {
  PLAN_ORDER,
  PLANS,
  billingEnforced,
  hasHostedFullAccess,
} from "@/lib/billing/plans";
import { currentPeriodMonth, usageForPractice } from "@/lib/billing/usage";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const adminProcedure = protectedProcedure.use(requireRole("admin"));

export const subscriptionRouter = createRouter({
  /** Current plan + status, plus the catalog for display. */
  get: adminProcedure.query(async ({ ctx }) => {
    const [practice] = await ctx.db
      .select({
        tier: practices.subscriptionTier,
        billingStatus: practices.billingStatus,
        trialEndsAt: practices.trialEndsAt,
      })
      .from(practices)
      .where(and(eq(practices.id, ctx.practiceId), isNull(practices.deletedAt)))
      .limit(1);
    if (!practice) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
    }

    const enforced = billingEnforced();
    const period = currentPeriodMonth();
    const [smsUsed, aiUsed] = enforced
      ? await Promise.all([
          usageForPractice(ctx.practiceId, "sms", period),
          usageForPractice(ctx.practiceId, "ai_run", period),
        ])
      : [0, 0];

    return {
      tier: practice.tier,
      billingStatus: practice.billingStatus,
      trialEndsAt: practice.trialEndsAt ?? null,
      billingEnforced: enforced,
      hasFullAccess: hasHostedFullAccess(
        practice.tier,
        practice.billingStatus,
        practice.trialEndsAt,
      ),
      usage: { period, sms: smsUsed, aiRuns: aiUsed },
      plans: PLAN_ORDER.map((tier) => PLANS[tier]),
    };
  }),
});
