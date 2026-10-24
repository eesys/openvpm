import { TRPCError } from "@trpc/server";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { clients, contactMethodValues, patients, portalSessions } from "@openpims/db";
import { z } from "zod";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const staffWrite = protectedProcedure.use(
  requireRole("admin", "veterinarian", "technician", "front_desk"),
);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return value.length ? value : null;
    });

const optionalEmail = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value.length ? value : null;
  })
  .refine((value) => value === undefined || value === null || z.string().email().safeParse(value).success, {
    message: "Invalid email",
  });

const clientFields = {
  firstName: z.string().trim().min(1).max(128),
  lastName: z.string().trim().min(1).max(128),
  email: optionalEmail,
  phone: optionalText(32),
  address: optionalText(500),
  city: optionalText(128),
  state: optionalText(64),
  zip: optionalText(16),
  emergencyContact: optionalText(255),
  emergencyPhone: optionalText(32),
  preferredContactMethod: z.enum(contactMethodValues).optional(),
  notes: optionalText(2000),
};

const listInput = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

function searchPattern(value: string) {
  return `%${value.replace(/[%_\\]/g, "\\$&")}%`;
}

const PORTAL_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

function withoutPortalSecret<
  T extends {
    accessToken: string | null;
    portalAccessTokenExpiresAt: Date | null;
    portalAccessTokenUsedAt: Date | null;
  },
>(client: T) {
  const {
    accessToken: _accessToken,
    portalAccessTokenExpiresAt: _expiresAt,
    portalAccessTokenUsedAt: _usedAt,
    ...safe
  } = client;
  return safe;
}

export const clientsRouter = createRouter({
  list: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
    const conditions = [
      eq(clients.practiceId, ctx.practiceId),
      isNull(clients.deletedAt),
    ];
    if (input.search) {
      const pattern = searchPattern(input.search);
      conditions.push(
        or(
          ilike(clients.firstName, pattern),
          ilike(clients.lastName, pattern),
          ilike(sql`concat_ws(' ', ${clients.firstName}, ${clients.lastName})`, pattern),
          ilike(clients.email, pattern),
          ilike(clients.phone, pattern),
        )!,
      );
    }

    const where = and(...conditions);
    const [items, countResult] = await Promise.all([
      ctx.db
        .select()
        .from(clients)
        .where(where)
        .orderBy(desc(clients.createdAt))
        .limit(input.limit)
        .offset(input.offset),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(clients)
        .where(where),
    ]);

    return {
      items: items.map(withoutPortalSecret),
      total: Number(countResult[0]?.count ?? 0),
    };
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [client] = await ctx.db
        .select()
        .from(clients)
        .where(
          and(
            eq(clients.id, input.id),
            eq(clients.practiceId, ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .limit(1);
      if (!client) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      }

      const clientPatients = await ctx.db
        .select()
        .from(patients)
        .where(
          and(
            eq(patients.clientId, client.id),
            eq(patients.practiceId, ctx.practiceId),
            isNull(patients.deletedAt),
          ),
        )
        .orderBy(desc(patients.createdAt));

      return { ...withoutPortalSecret(client), patients: clientPatients };
    }),

  create: staffWrite.input(z.object(clientFields)).mutation(async ({ ctx, input }) => {
    const [client] = await ctx.db
      .insert(clients)
      .values({ ...input, practiceId: ctx.practiceId })
      .returning();
    if (!client) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Client could not be created",
      });
    }
    return withoutPortalSecret(client);
  }),

  rotatePortalAccessToken: staffWrite
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rawToken = randomBytes(32).toString("hex");
      const now = new Date();
      const client = await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(clients)
          .set({
            accessToken: createHash("sha256").update(rawToken).digest("hex"),
            portalAccessTokenExpiresAt: new Date(now.getTime() + PORTAL_ACCESS_TOKEN_TTL_MS),
            portalAccessTokenUsedAt: null,
          })
          .where(
            and(
              eq(clients.id, input.id),
              eq(clients.practiceId, ctx.practiceId),
              isNull(clients.deletedAt),
            ),
          )
          .returning({ id: clients.id });
        if (!updated) return null;
        await tx
          .update(portalSessions)
          .set({ revokedAt: now, revokedReason: "staff_access_reset" })
          .where(
            and(
              eq(portalSessions.clientId, updated.id),
              eq(portalSessions.practiceId, ctx.practiceId),
              isNull(portalSessions.revokedAt),
            ),
          );
        return updated;
      });
      if (!client) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      }
      return { id: client.id, accessToken: rawToken };
    }),

  update: staffWrite
    .input(
      z.object({
        id: z.string().uuid(),
        firstName: clientFields.firstName.optional(),
        lastName: clientFields.lastName.optional(),
        email: clientFields.email,
        phone: clientFields.phone,
        address: clientFields.address,
        city: clientFields.city,
        state: clientFields.state,
        zip: clientFields.zip,
        emergencyContact: clientFields.emergencyContact,
        emergencyPhone: clientFields.emergencyPhone,
        preferredContactMethod: clientFields.preferredContactMethod,
        notes: clientFields.notes,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [client] = await ctx.db
        .update(clients)
        .set(data)
        .where(
          and(
            eq(clients.id, id),
            eq(clients.practiceId, ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .returning();
      if (!client) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      }
      return withoutPortalSecret(client);
    }),

  delete: protectedProcedure
    .use(requireRole("admin"))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ id: clients.id })
        .from(clients)
        .where(
          and(
            eq(clients.id, input.id),
            eq(clients.practiceId, ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      }

      const [activePatient] = await ctx.db
        .select({ id: patients.id })
        .from(patients)
        .where(
          and(
            eq(patients.clientId, input.id),
            eq(patients.practiceId, ctx.practiceId),
            isNull(patients.deletedAt),
          ),
        )
        .limit(1);
      if (activePatient) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete a client with active patients.",
        });
      }

      await ctx.db
        .update(clients)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(clients.id, input.id),
            eq(clients.practiceId, ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        );
      return { success: true };
    }),
});
