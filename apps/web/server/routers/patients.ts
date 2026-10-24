import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  clients,
  patientStatusValues,
  patients,
  sexValues,
  speciesValues,
} from "@openpims/db";
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

const patientFields = {
  name: z.string().trim().min(1).max(128),
  species: z.enum(speciesValues),
  breed: optionalText(128),
  sex: z.enum(sexValues).optional(),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  color: optionalText(64),
  microchipNumber: optionalText(64),
  photoUrl: optionalText(512),
  status: z.enum(patientStatusValues).optional(),
};

const listInput = z.object({
  search: z.string().trim().max(128).optional(),
  species: z.enum(speciesValues).optional(),
  status: z.enum(patientStatusValues).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

function searchPattern(value: string) {
  return `%${value.replace(/[%_\\]/g, "\\$&")}%`;
}

async function clientInPractice(
  db: typeof import("@openpims/db/client").db,
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
  list: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
    const conditions = [
      eq(patients.practiceId, ctx.practiceId),
      isNull(patients.deletedAt),
    ];
    if (input.species) conditions.push(eq(patients.species, input.species));
    if (input.status) conditions.push(eq(patients.status, input.status));
    if (input.search) {
      const pattern = searchPattern(input.search);
      conditions.push(
        or(
          ilike(patients.name, pattern),
          ilike(clients.firstName, pattern),
          ilike(clients.lastName, pattern),
        )!,
      );
    }

    const where = and(...conditions);
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
        .where(where)
        .orderBy(desc(patients.createdAt), patients.id)
        .limit(input.limit)
        .offset(input.offset),
      ctx.db
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
        .where(where),
    ]);

    return { items, total: Number(countResult[0]?.count ?? 0) };
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [patient] = await ctx.db
        .select({
          id: patients.id,
          practiceId: patients.practiceId,
          clientId: patients.clientId,
          name: patients.name,
          species: patients.species,
          breed: patients.breed,
          sex: patients.sex,
          dob: patients.dob,
          color: patients.color,
          microchipNumber: patients.microchipNumber,
          photoUrl: patients.photoUrl,
          status: patients.status,
          createdAt: patients.createdAt,
          updatedAt: patients.updatedAt,
          clientFirstName: clients.firstName,
          clientLastName: clients.lastName,
        })
        .from(patients)
        .innerJoin(
          clients,
          and(
            eq(patients.clientId, clients.id),
            eq(clients.practiceId, ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .where(
          and(
            eq(patients.id, input.id),
            eq(patients.practiceId, ctx.practiceId),
            isNull(patients.deletedAt),
          ),
        )
        .limit(1);
      if (!patient) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });
      }
      return patient;
    }),

  create: staffWrite
    .input(z.object({ clientId: z.string().uuid(), ...patientFields }))
    .mutation(async ({ ctx, input }) => {
      await clientInPractice(ctx.db, ctx.practiceId, input.clientId);
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

  update: staffWrite
    .input(
      z.object({
        id: z.string().uuid(),
        name: patientFields.name.optional(),
        species: patientFields.species.optional(),
        breed: patientFields.breed,
        sex: patientFields.sex,
        dob: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional()
          .or(z.literal("")),
        color: patientFields.color,
        microchipNumber: patientFields.microchipNumber,
        photoUrl: patientFields.photoUrl,
        status: patientFields.status,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, dob, ...rest } = input;
      const data = {
        ...rest,
        ...(dob === "" || dob === null ? { dob: null } : dob ? { dob } : {}),
      };
      const [patient] = await ctx.db
        .update(patients)
        .set(data)
        .where(
          and(
            eq(patients.id, id),
            eq(patients.practiceId, ctx.practiceId),
            isNull(patients.deletedAt),
          ),
        )
        .returning();
      if (!patient) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });
      }
      return patient;
    }),

  delete: protectedProcedure
    .use(requireRole("admin"))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [patient] = await ctx.db
        .update(patients)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(patients.id, input.id),
            eq(patients.practiceId, ctx.practiceId),
            isNull(patients.deletedAt),
          ),
        )
        .returning({ id: patients.id });
      if (!patient) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });
      }
      return { success: true };
    }),
});
