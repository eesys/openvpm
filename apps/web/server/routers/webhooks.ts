import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { practices, webhooks } from "@openpims/db";
import type { Database } from "@openpims/db/client";
import { WEBHOOK_EVENTS } from "@/lib/webhook-events";
import {
  WEBHOOK_URL_MAX_LENGTH,
  isWebhookDeliveryUrl,
} from "@/lib/webhook-urls";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const adminProcedure = protectedProcedure.use(requireRole("admin"));

const webhookUrlInput = z
  .string()
  .trim()
  .min(1, "Webhook URL is required.")
  .max(
    WEBHOOK_URL_MAX_LENGTH,
    `Webhook URL must be at most ${WEBHOOK_URL_MAX_LENGTH} characters.`,
  )
  .url("Webhook URL must be a valid URL.")
  .refine(isWebhookDeliveryUrl, "Webhook URL must use the HTTP or HTTPS scheme.");

function activePracticePredicate(practiceId: string) {
  return sql`exists (
    select 1
    from ${practices}
    where ${practices.id} = ${practiceId}
      and ${practices.deletedAt} is null
  )`;
}

async function assertActivePractice(db: Database, practiceId: string) {
  const [practice] = await db
    .select({ id: practices.id })
    .from(practices)
    .where(and(eq(practices.id, practiceId), isNull(practices.deletedAt)))
    .limit(1);
  if (!practice) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
  }
}

const publicWebhook = {
  id: webhooks.id,
  url: webhooks.url,
  events: webhooks.events,
  active: webhooks.active,
  createdAt: webhooks.createdAt,
};

export const webhooksRouter = createRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    await assertActivePractice(ctx.db, ctx.practiceId);
    return ctx.db
      .select(publicWebhook)
      .from(webhooks)
      .where(
        and(
          eq(webhooks.practiceId, ctx.practiceId),
          activePracticePredicate(ctx.practiceId),
          isNull(webhooks.deletedAt),
        ),
      );
  }),

  create: adminProcedure
    .input(
      z.object({
        url: webhookUrlInput,
        events: z
          .array(z.enum(WEBHOOK_EVENTS))
          .min(1)
          .max(WEBHOOK_EVENTS.length)
          .refine(
            (events) => new Set(events).size === events.length,
            "Webhook events must be unique.",
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertActivePractice(ctx.db, ctx.practiceId);
      const secret = randomUUID();
      const [webhook] = await ctx.db
        .insert(webhooks)
        .values({
          practiceId: ctx.practiceId,
          url: input.url,
          events: input.events,
          secret,
          active: true,
        })
        .returning(publicWebhook);
      if (!webhook) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Webhook was not created",
        });
      }
      return { ...webhook, secret };
    }),

  toggle: adminProcedure
    .input(z.object({ id: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ active: webhooks.active })
        .from(webhooks)
        .where(
          and(
            eq(webhooks.id, input.id),
            eq(webhooks.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(webhooks.deletedAt),
          ),
        );
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
      }
      const [updated] = await ctx.db
        .update(webhooks)
        .set({ active: !existing.active })
        .where(
          and(
            eq(webhooks.id, input.id),
            eq(webhooks.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(webhooks.deletedAt),
          ),
        )
        .returning(publicWebhook);
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
      }
      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .update(webhooks)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(webhooks.id, input.id),
            eq(webhooks.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(webhooks.deletedAt),
          ),
        )
        .returning({ id: webhooks.id });
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
      }
      return { success: true as const };
    }),

  events: adminProcedure.query(() => {
    return WEBHOOK_EVENTS.map((event) => ({ event }));
  }),
});
