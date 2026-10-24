import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { practices, webhooks } from "@openpims/db";
import { z } from "zod";
import { createRouter, protectedProcedure, requireRole } from "../trpc";
import { isWebhookDeliveryUrl, WEBHOOK_URL_MAX_LENGTH } from "../webhook-dispatch";

const webhookEventValues = ["appointment.created"] as const;

const adminProcedure = protectedProcedure.use(requireRole("admin"));

const webhookUrlInput = z
  .string()
  .trim()
  .min(1, "Webhook URL is required.")
  .max(
    WEBHOOK_URL_MAX_LENGTH,
    `Webhook URL must be at most ${WEBHOOK_URL_MAX_LENGTH} characters.`,
  )
  .superRefine((value, ctx) => {
    if (isWebhookDeliveryUrl(value)) return;
    let parsed = false;
    try {
      parsed = Boolean(new URL(value));
    } catch {
      parsed = false;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: parsed
        ? "Webhook URL must use the HTTP or HTTPS scheme."
        : "Webhook URL must be a valid URL.",
    });
  });

const publicWebhook = {
  id: webhooks.id,
  url: webhooks.url,
  events: webhooks.events,
  active: webhooks.active,
  createdAt: webhooks.createdAt,
};

export const webhooksRouter = createRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select(publicWebhook)
      .from(webhooks)
      .where(and(eq(webhooks.practiceId, ctx.practiceId), isNull(webhooks.deletedAt)))
      .orderBy(desc(webhooks.createdAt));
  }),

  create: adminProcedure
    .input(
      z.object({
        url: webhookUrlInput,
        events: z.array(z.enum(webhookEventValues)).min(1).max(webhookEventValues.length),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [practice] = await ctx.db
        .select({ id: practices.id })
        .from(practices)
        .where(and(eq(practices.id, ctx.practiceId), isNull(practices.deletedAt)))
        .limit(1);
      if (!practice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
      }

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
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ active: webhooks.active })
        .from(webhooks)
        .where(
          and(
            eq(webhooks.id, input.id),
            eq(webhooks.practiceId, ctx.practiceId),
            isNull(webhooks.deletedAt),
          ),
        )
        .limit(1);
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
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .update(webhooks)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(webhooks.id, input.id),
            eq(webhooks.practiceId, ctx.practiceId),
            isNull(webhooks.deletedAt),
          ),
        )
        .returning({ id: webhooks.id });
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
      }
      return { success: true as const };
    }),
});
