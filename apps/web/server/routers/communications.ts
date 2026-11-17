import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, communications, practices, users } from "@openpims/db";
import {
  COMMUNICATION_CONTENT_MAX_LENGTH,
  COMMUNICATION_SUBJECT_MAX_LENGTH,
  SMS_COMMUNICATION_CONTENT_MAX_LENGTH,
} from "@/lib/communications/policy";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const inboxStaffProcedure = protectedProcedure.use(
  requireRole("admin", "veterinarian", "technician", "front_desk"),
);

function activePracticePredicate(practiceId: string) {
  return sql`exists (
    select 1
    from ${practices}
    where ${practices.id} = ${practiceId}
      and ${practices.deletedAt} is null
  )`;
}

const createCommunicationInput = z
  .object({
    clientId: z.string().guid(),
    channel: z.enum(["phone", "sms", "email", "portal"]),
    direction: z.enum(["inbound", "outbound"]),
    subject: z.string().trim().max(COMMUNICATION_SUBJECT_MAX_LENGTH).optional(),
    content: z
      .string()
      .trim()
      .min(1, "Message content is required")
      .max(
        COMMUNICATION_CONTENT_MAX_LENGTH,
        `Message content must be at most ${COMMUNICATION_CONTENT_MAX_LENGTH} characters.`,
      ),
    status: z
      .enum(["pending", "sent", "delivered", "read", "failed"])
      .optional(),
    requestId: z.string().guid().optional(),
  })
  .superRefine((input, ctx) => {
    if (
      input.channel === "sms" &&
      input.content.length > SMS_COMMUNICATION_CONTENT_MAX_LENGTH
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: `SMS messages must be at most ${SMS_COMMUNICATION_CONTENT_MAX_LENGTH} characters.`,
      });
    }
    if (
      (input.channel === "sms" || input.channel === "email") &&
      input.direction === "outbound" &&
      !input.requestId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requestId"],
        message: "A stable request ID is required to send an external message.",
      });
    }
  });

export const communicationsRouter = createRouter({
  getByClient: protectedProcedure
    .input(z.object({ clientId: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: communications.id,
          channel: communications.channel,
          direction: communications.direction,
          subject: communications.subject,
          content: communications.content,
          status: communications.status,
          assignedTo: communications.assignedTo,
          assignedToName: users.name,
          readAt: communications.readAt,
          createdAt: communications.createdAt,
        })
        .from(communications)
        .innerJoin(
          clients,
          and(
            eq(communications.clientId, clients.id),
            eq(clients.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .leftJoin(
          users,
          and(
            eq(communications.assignedTo, users.id),
            eq(users.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(users.deletedAt),
          ),
        )
        .where(
          and(
            eq(communications.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            eq(communications.clientId, input.clientId),
            isNull(communications.deletedAt),
          ),
        )
        .orderBy(desc(communications.createdAt));
    }),

  create: inboxStaffProcedure
    .input(createCommunicationInput)
    .mutation(async ({ ctx, input }) => {
      const content = input.content.trim();
      const [client] = await ctx.db
        .select({
          id: clients.id,
          email: clients.email,
          phone: clients.phone,
        })
        .from(clients)
        .where(
          and(
            eq(clients.id, input.clientId),
            eq(clients.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .limit(1);
      if (!client) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      }

      if (input.direction === "outbound" && input.channel === "sms") {
        if (!client.phone) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Client does not have a phone number on file",
          });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Set up an active texting number before sending SMS from the inbox",
        });
      }
      if (input.direction === "outbound" && input.channel === "email") {
        if (!client.email?.trim()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Client does not have an email address on file",
          });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Email provider is not configured for hosted sending.",
        });
      }

      const [latestAssignment] = await ctx.db
        .select({ assignedTo: communications.assignedTo })
        .from(communications)
        .where(
          and(
            eq(communications.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            eq(communications.clientId, input.clientId),
            isNotNull(communications.assignedTo),
            isNull(communications.deletedAt),
          ),
        )
        .orderBy(desc(communications.createdAt))
        .limit(1);

      const [communication] = await ctx.db
        .insert(communications)
        .values({
          practiceId: ctx.practiceId,
          clientId: input.clientId,
          channel: input.channel,
          direction: input.direction,
          subject: input.subject?.trim() || null,
          content,
          assignedTo: latestAssignment?.assignedTo ?? ctx.user.id,
          readAt: input.status === "read" ? new Date() : null,
          status:
            input.status ??
            (input.direction === "outbound"
              ? input.channel === "portal"
                ? "delivered"
                : "sent"
              : "pending"),
        })
        .returning();
      if (!communication) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not create communication",
        });
      }
      return communication;
    }),
});
