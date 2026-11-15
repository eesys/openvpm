import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { clients, patients, practices } from "@openpims/db";
import type { Database } from "@openpims/db/client";
import {
  PATIENT_BREED_MAX_LENGTH,
  PATIENT_COLOR_MAX_LENGTH,
  PATIENT_MICROCHIP_NUMBER_MAX_LENGTH,
  PATIENT_NAME_MAX_LENGTH,
  PATIENT_SEARCH_MAX_LENGTH,
} from "@/lib/patients/policy";
import { PATIENT_SPECIES } from "@/lib/patients/species";
import { createRouter, protectedProcedure, requireRole } from "../trpc";
import { listOffsetInput } from "./pagination";

const patientManagerProcedure = protectedProcedure.use(
  requireRole("admin", "veterinarian", "technician", "front_desk"),
);

const patientSpeciesInput = z.enum(PATIENT_SPECIES);
const patientSexInput = z.enum([
  "male",
  "female",
  "male_neutered",
  "female_spayed",
]);
const patientStatusInput = z.enum(["active", "inactive", "deceased"]);
const patientDateInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD");
const patientDobInput = patientDateInput.optional();
const patientDobUpdateInput = patientDateInput.nullable().optional();
const patientSearchInput = z
  .string()
  .trim()
  .max(PATIENT_SEARCH_MAX_LENGTH)
  .optional();
const patientSearchQueryInput = z
  .string()
  .trim()
  .min(1)
  .max(PATIENT_SEARCH_MAX_LENGTH);
const patientNameInput = z.string().trim().min(1).max(PATIENT_NAME_MAX_LENGTH);
const optionalPatientString = (label: string, maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength, `${label} must be at most ${maxLength} characters.`)
    .optional()
    .transform((value) => value || undefined);
const patientMutableInput = {
  name: patientNameInput,
  species: patientSpeciesInput,
  breed: optionalPatientString("Breed", PATIENT_BREED_MAX_LENGTH),
  sex: patientSexInput.optional(),
  dob: patientDobInput,
  color: optionalPatientString("Color", PATIENT_COLOR_MAX_LENGTH),
  microchipNumber: optionalPatientString(
    "Microchip number",
    PATIENT_MICROCHIP_NUMBER_MAX_LENGTH,
  ),
};

function activePracticePredicate(practiceId: string) {
  return sql`exists (
    select 1 from ${practices}
    where ${practices.id} = ${practiceId}
      and ${practices.deletedAt} is null
  )`;
}

function literalSearchMatch(column: AnyColumn | SQL, value: string) {
  const escaped = value.replace(/[\\%_]/g, (character) => `\\${character}`);
  return sql`${column} ilike ${`%${escaped}%`} escape '\\'`;
}

function patientOwnerSearchConditions(search: string) {
  return or(
    literalSearchMatch(patients.name, search),
    literalSearchMatch(clients.firstName, search),
    literalSearchMatch(clients.lastName, search),
    literalSearchMatch(
      sql`concat_ws(' ', ${clients.firstName}, ${clients.lastName})`,
      search,
    ),
  )!;
}

async function assertClientBelongsToPractice(
  db: Database,
  practiceId: string,
  clientId: string,
) {
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.id, clientId),
        eq(clients.practiceId, practiceId),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  if (!client) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }
}

export const patientsRouter = createRouter({
  list: protectedProcedure
    .input(
      z.object({
        search: patientSearchInput,
        species: patientSpeciesInput.optional(),
        status: patientStatusInput.optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: listOffsetInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions: SQL[] = [
        eq(patients.practiceId, ctx.practiceId),
        activePracticePredicate(ctx.practiceId),
        isNull(patients.deletedAt),
      ];
      if (input.search) {
        conditions.push(patientOwnerSearchConditions(input.search));
      }
      if (input.species) {
        conditions.push(eq(patients.species, input.species));
      }
      if (input.status) {
        conditions.push(eq(patients.status, input.status));
      }

      const countQuery = input.search
        ? ctx.db
            .select({ count: sql<number>`count(*)` })
            .from(patients)
            .leftJoin(
              clients,
              and(
                eq(patients.clientId, clients.id),
                eq(clients.practiceId, ctx.practiceId),
                isNull(clients.deletedAt),
              ),
            )
            .where(and(...conditions))
        : ctx.db
            .select({ count: sql<number>`count(*)` })
            .from(patients)
            .where(and(...conditions));

      const [items, countResult] = await Promise.all([
        ctx.db
          .select({
            id: patients.id,
            name: patients.name,
            species: patients.species,
            breed: patients.breed,
            sex: patients.sex,
            dob: patients.dob,
            status: patients.status,
            photoUrl: patients.photoUrl,
            clientId: patients.clientId,
            clientFirstName: clients.firstName,
            clientLastName: clients.lastName,
            createdAt: patients.createdAt,
          })
          .from(patients)
          .leftJoin(
            clients,
            and(
              eq(patients.clientId, clients.id),
              eq(clients.practiceId, ctx.practiceId),
              isNull(clients.deletedAt),
            ),
          )
          .where(and(...conditions))
          .orderBy(
            ...(input.search
              ? [asc(patients.name), asc(patients.id)]
              : [desc(patients.createdAt), asc(patients.id)]),
          )
          .limit(input.limit)
          .offset(input.offset),
        countQuery,
      ]);

      return {
        items,
        total: Number(countResult[0]?.count ?? 0),
      };
    }),

  search: protectedProcedure
    .input(
      z.object({
        query: patientSearchQueryInput,
        status: patientStatusInput.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions: SQL[] = [
        eq(patients.practiceId, ctx.practiceId),
        activePracticePredicate(ctx.practiceId),
        isNull(patients.deletedAt),
        patientOwnerSearchConditions(input.query),
      ];
      if (input.status) {
        conditions.push(eq(patients.status, input.status));
      }
      return ctx.db
        .select({
          id: patients.id,
          name: patients.name,
          species: patients.species,
          breed: patients.breed,
          clientFirstName: clients.firstName,
          clientLastName: clients.lastName,
        })
        .from(patients)
        .leftJoin(
          clients,
          and(
            eq(patients.clientId, clients.id),
            eq(clients.practiceId, ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .where(and(...conditions))
        .orderBy(asc(patients.name), asc(patients.id))
        .limit(10);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      const [patient] = await ctx.db
        .select()
        .from(patients)
        .where(
          and(
            eq(patients.id, input.id),
            eq(patients.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(patients.deletedAt),
          ),
        )
        .limit(1);
      if (!patient) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Patient not found",
        });
      }
      return patient;
    }),

  create: patientManagerProcedure
    .input(
      z.object({
        clientId: z.string().guid(),
        ...patientMutableInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertClientBelongsToPractice(
        ctx.db,
        ctx.practiceId,
        input.clientId,
      );
      const [patient] = await ctx.db
        .insert(patients)
        .values({ ...input, practiceId: ctx.practiceId })
        .returning();
      if (!patient) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Patient could not be created",
        });
      }
      return patient;
    }),

  update: patientManagerProcedure
    .input(
      z
        .object({
          id: z.string().guid(),
          name: patientMutableInput.name.optional(),
          species: patientMutableInput.species.optional(),
          breed: patientMutableInput.breed,
          sex: patientMutableInput.sex,
          dob: patientDobUpdateInput,
          color: patientMutableInput.color,
          microchipNumber: patientMutableInput.microchipNumber,
          status: patientStatusInput.optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [patient] = await ctx.db
        .update(patients)
        .set(data)
        .where(
          and(
            eq(patients.id, id),
            eq(patients.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(patients.deletedAt),
          ),
        )
        .returning();
      if (!patient) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Patient not found",
        });
      }
      return patient;
    }),
});
