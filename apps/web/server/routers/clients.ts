import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { clients, patients, practices } from "@openpims/db";
import {
  CLIENT_ADDRESS_MAX_LENGTH,
  CLIENT_CITY_MAX_LENGTH,
  CLIENT_CONTACT_METHODS,
  CLIENT_EMAIL_MAX_LENGTH,
  CLIENT_NAME_MAX_LENGTH,
  CLIENT_PHONE_MAX_LENGTH,
  CLIENT_SEARCH_MAX_LENGTH,
  CLIENT_STATE_MAX_LENGTH,
  CLIENT_ZIP_MAX_LENGTH,
} from "@/lib/clients/policy";
import { createRouter, protectedProcedure, requireRole } from "../trpc";
import { listOffsetInput } from "./pagination";

const clientManagerProcedure = protectedProcedure.use(
  requireRole("admin", "veterinarian", "technician", "front_desk"),
);

const clientNameInput = z.string().trim().min(1).max(CLIENT_NAME_MAX_LENGTH);
const clientEmailInput = z
  .string()
  .trim()
  .email()
  .max(CLIENT_EMAIL_MAX_LENGTH)
  .optional();
const clientSearchInput = z
  .string()
  .trim()
  .max(CLIENT_SEARCH_MAX_LENGTH)
  .optional();
const clientSearchQueryInput = z
  .string()
  .trim()
  .min(1)
  .max(CLIENT_SEARCH_MAX_LENGTH);
const optionalClientString = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .optional()
    .transform((value) => value || undefined);
const clientAddressInput = optionalClientString(CLIENT_ADDRESS_MAX_LENGTH);
const clientNotesInput = optionalClientString(2000);
const clientPreferredContactInput = z.enum(CLIENT_CONTACT_METHODS);

function activePracticePredicate(practiceId: string) {
  return sql`exists (
    select 1 from ${practices}
    where ${practices.id} = ${practiceId}
      and ${practices.deletedAt} is null
  )`;
}

function literalClientSearchMatch(column: AnyColumn | SQL, value: string) {
  const escaped = value.replace(/[\\%_]/g, (character) => `\\${character}`);
  return sql`${column} ilike ${`%${escaped}%`} escape '\\'`;
}

function clientSearchConditions(search: string) {
  return or(
    literalClientSearchMatch(clients.firstName, search),
    literalClientSearchMatch(clients.lastName, search),
    literalClientSearchMatch(
      sql`concat_ws(' ', ${clients.firstName}, ${clients.lastName})`,
      search,
    ),
    literalClientSearchMatch(clients.email, search),
    literalClientSearchMatch(clients.phone, search),
  );
}

export const clientsRouter = createRouter({
  list: protectedProcedure
    .input(
      z.object({
        search: clientSearchInput,
        limit: z.number().int().min(1).max(100).default(25),
        offset: listOffsetInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(clients.practiceId, ctx.practiceId),
        activePracticePredicate(ctx.practiceId),
        isNull(clients.deletedAt),
      ];
      if (input.search) {
        conditions.push(clientSearchConditions(input.search)!);
      }

      const [items, countResult, practiceResult] = await Promise.all([
        ctx.db
          .select()
          .from(clients)
          .where(and(...conditions))
          .orderBy(desc(clients.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(clients)
          .where(and(...conditions)),
        ctx.db
          .select({ timezone: practices.timezone })
          .from(practices)
          .where(
            and(eq(practices.id, ctx.practiceId), isNull(practices.deletedAt)),
          )
          .limit(1),
      ]);

      if (!practiceResult[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Practice not found",
        });
      }

      return {
        items,
        total: Number(countResult[0]?.count ?? 0),
        timezone: practiceResult[0].timezone ?? null,
      };
    }),

  search: protectedProcedure
    .input(z.object({ query: clientSearchQueryInput }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: clients.id,
          firstName: clients.firstName,
          lastName: clients.lastName,
          email: clients.email,
          phone: clients.phone,
        })
        .from(clients)
        .where(
          and(
            eq(clients.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(clients.deletedAt),
            clientSearchConditions(input.query),
          ),
        )
        .limit(10);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      const [client] = await ctx.db
        .select()
        .from(clients)
        .where(
          and(
            eq(clients.id, input.id),
            eq(clients.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
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
            eq(patients.clientId, input.id),
            eq(patients.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(patients.deletedAt),
          ),
        )
        .orderBy(patients.name);

      return { ...client, patients: clientPatients };
    }),

  create: clientManagerProcedure
    .input(
      z.object({
        firstName: clientNameInput,
        lastName: clientNameInput,
        email: clientEmailInput,
        phone: optionalClientString(CLIENT_PHONE_MAX_LENGTH),
        address: clientAddressInput,
        city: optionalClientString(CLIENT_CITY_MAX_LENGTH),
        state: optionalClientString(CLIENT_STATE_MAX_LENGTH),
        zip: optionalClientString(CLIENT_ZIP_MAX_LENGTH),
        notes: clientNotesInput,
        preferredContactMethod: clientPreferredContactInput.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
      return client;
    }),

  update: clientManagerProcedure
    .input(
      z.object({
        id: z.string().guid(),
        firstName: clientNameInput.optional(),
        lastName: clientNameInput.optional(),
        email: clientEmailInput,
        phone: optionalClientString(CLIENT_PHONE_MAX_LENGTH),
        address: clientAddressInput,
        city: optionalClientString(CLIENT_CITY_MAX_LENGTH),
        state: optionalClientString(CLIENT_STATE_MAX_LENGTH),
        zip: optionalClientString(CLIENT_ZIP_MAX_LENGTH),
        notes: clientNotesInput,
        preferredContactMethod: clientPreferredContactInput.optional(),
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
            activePracticePredicate(ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .returning();
      if (!client) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      }
      return client;
    }),
});
