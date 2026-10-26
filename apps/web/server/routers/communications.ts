import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  clients,
  commChannelValues,
  commDirectionValues,
  commStatusValues,
  communications,
  practices,
} from "@openpims/db";
import { z } from "zod";
import { normalizeE164 } from "@/lib/messaging/phone";
import { isQuietHours } from "@/lib/messaging/reminders";
import { sendSms } from "@/lib/sms";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const CONTENT_MAX = 5000;
const SMS_CONTENT_MAX = 1600;
const SUBJECT_MAX = 255;

const staffWrite = protectedProcedure.use(
  requireRole("admin", "veterinarian", "technician", "front_desk"),
);

const createInput = z
  .object({
    clientId: z.string().uuid(),
    channel: z.enum(commChannelValues),
    direction: z.enum(commDirectionValues),
    subject: z
      .string()
      .trim()
      .max(SUBJECT_MAX)
      .optional()
      .transform((value) => (value ? value : undefined)),
    content: z
      .string()
      .trim()
      .min(1, "Message content is required")
      .max(CONTENT_MAX, `Message content must be at most ${CONTENT_MAX} characters.`),
    status: z.enum(commStatusValues).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.channel === "sms" && input.content.length > SMS_CONTENT_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: `SMS messages must be at most ${SMS_CONTENT_MAX} characters.`,
      });
    }
  });

export const communicationsRouter = createRouter({
  getByClient: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [practice] = await ctx.db
        .select({ timezone: practices.timezone })
        .from(practices)
        .where(and(eq(practices.id, ctx.practiceId), isNull(practices.deletedAt)))
        .limit(1);
      if (!practice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
      }

      const items = await ctx.db
        .select({
          id: communications.id,
          channel: communications.channel,
          direction: communications.direction,
          subject: communications.subject,
          content: communications.content,
          status: communications.status,
          readAt: communications.readAt,
          createdAt: communications.createdAt,
        })
        .from(communications)
        .innerJoin(
          clients,
          and(
            eq(communications.clientId, clients.id),
            eq(clients.practiceId, ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .where(
          and(
            eq(communications.practiceId, ctx.practiceId),
            eq(communications.clientId, input.clientId),
            isNull(communications.deletedAt),
          ),
        )
        .orderBy(desc(communications.createdAt));

      return { timezone: practice.timezone, items };
    }),

  create: staffWrite.input(createInput).mutation(async ({ ctx, input }) => {
    const [client] = await ctx.db
      .select({
        id: clients.id,
        phone: clients.phone,
        smsConsent: clients.smsConsent,
      })
      .from(clients)
      .where(
        and(
          eq(clients.id, input.clientId),
          eq(clients.practiceId, ctx.practiceId),
          isNull(clients.deletedAt),
        ),
      )
      .limit(1);
    if (!client) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
    }

    const [practice] = await ctx.db
      .select({ name: practices.name, timezone: practices.timezone })
      .from(practices)
      .where(and(eq(practices.id, ctx.practiceId), isNull(practices.deletedAt)))
      .limit(1);
    if (!practice) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
    }

    const practiceName = practice.name?.trim() || "OpenVPM";
    const subject =
      input.channel === "email"
        ? input.subject || `Message from ${practiceName}`
        : input.subject;

    if (input.direction === "outbound" && input.channel === "sms") {
      if (!client.phone) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Client does not have a phone number on file",
        });
      }
      if (!client.smsConsent) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Client has not consented to SMS messages",
        });
      }
      if (isQuietHours(new Date(), practice.timezone)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "SMS sending is blocked during quiet hours",
        });
      }
      const to = normalizeE164(client.phone);
      if (!to) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Client phone number must be a valid E.164 or US/CA number",
        });
      }

      const [pending] = await ctx.db
        .insert(communications)
        .values({
          practiceId: ctx.practiceId,
          clientId: input.clientId,
          channel: "sms",
          direction: "outbound",
          subject,
          content: input.content,
          status: "pending",
          assignedTo: ctx.session.user.id,
        })
        .returning();
      if (!pending) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Communication could not be recorded",
        });
      }

      const delivery = await sendSms({
        to,
        body: input.content,
        practiceId: ctx.practiceId,
      });
      const [updated] = await ctx.db
        .update(communications)
        .set({
          status: delivery.success ? "sent" : "failed",
          providerMessageId: delivery.success ? delivery.sid : null,
        })
        .where(
          and(
            eq(communications.id, pending.id),
            eq(communications.practiceId, ctx.practiceId),
            eq(communications.status, "pending"),
            isNull(communications.deletedAt),
          ),
        )
        .returning();
      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: delivery.success
            ? "Message was delivered, but the inbox status could not be updated. Refresh before sending again."
            : delivery.error,
        });
      }
      if (!delivery.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: delivery.error,
        });
      }
      return updated;
    }

    // Outbound email stays pending until an email channel ships; every other
    // recorded channel takes the provided or implied status.
    const status =
      input.direction === "outbound" && input.channel === "email"
        ? ("pending" as const)
        : (input.status ??
          (input.direction === "outbound"
            ? input.channel === "portal"
              ? ("delivered" as const)
              : ("sent" as const)
            : ("pending" as const)));

    const [communication] = await ctx.db
      .insert(communications)
      .values({
        practiceId: ctx.practiceId,
        clientId: input.clientId,
        channel: input.channel,
        direction: input.direction,
        subject,
        content: input.content,
        status,
        assignedTo: ctx.session.user.id,
        readAt: status === "read" ? new Date() : undefined,
      })
      .returning();
    if (!communication) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Communication could not be recorded",
      });
    }
    return communication;
  }),
});
