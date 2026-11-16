import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { practices, soapNotes } from "@openpims/db";
import type { Database } from "@openpims/db/client";
import { SOAP_SECTION_MAX_LENGTH } from "@/lib/records/soap-content";
import {
  createFinalizedAppointmentSoapNote,
  discardAppointmentSoapDraft,
  finalizeAppointmentSoapDraft,
  getAppointmentSoapDraft,
  saveAppointmentSoapDraft,
  SoapLifecycleError,
} from "@/lib/records/soap-lifecycle";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const soapSectionInput = z
  .string()
  .trim()
  .max(
    SOAP_SECTION_MAX_LENGTH,
    `SOAP section must be at most ${SOAP_SECTION_MAX_LENGTH} characters.`,
  )
  .optional();

const soapSectionsInput = {
  subjective: soapSectionInput,
  objective: soapSectionInput,
  assessment: soapSectionInput,
  plan: soapSectionInput,
};

function rethrowSoapLifecycleError(error: unknown): never {
  if (error instanceof SoapLifecycleError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  throw error;
}

function activePracticePredicate(practiceId: string) {
  return sql`exists (
    select 1 from ${practices}
    where ${practices.id} = ${practiceId}
      and ${practices.deletedAt} is null
  )`;
}

const soapWriter = protectedProcedure.use(
  requireRole("admin", "veterinarian"),
);

export const recordsRouter = createRouter({
  listSoapNotes: protectedProcedure
    .input(z.object({ patientId: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: soapNotes.id,
          patientId: soapNotes.patientId,
          appointmentId: soapNotes.appointmentId,
          subjective: soapNotes.subjective,
          objective: soapNotes.objective,
          assessment: soapNotes.assessment,
          plan: soapNotes.plan,
          authorId: soapNotes.authorId,
          authorName: soapNotes.authorName,
          status: soapNotes.status,
          revision: soapNotes.revision,
          finalizedAt: soapNotes.finalizedAt,
          finalizedBy: soapNotes.finalizedBy,
          finalizerName: soapNotes.finalizerName,
          imported: soapNotes.imported,
          createdAt: soapNotes.createdAt,
        })
        .from(soapNotes)
        .where(
          and(
            eq(soapNotes.patientId, input.patientId),
            eq(soapNotes.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(soapNotes.deletedAt),
          ),
        )
        .orderBy(desc(soapNotes.createdAt));
    }),

  getSoapDraft: soapWriter
    .input(
      z.object({
        patientId: z.string().guid(),
        appointmentId: z.string().guid(),
      }),
    )
    .query(async ({ ctx, input }) =>
      getAppointmentSoapDraft(ctx.db, {
        practiceId: ctx.practiceId,
        ...input,
      }),
    ),

  saveSoapDraft: soapWriter
    .input(
      z.object({
        patientId: z.string().guid(),
        appointmentId: z.string().guid(),
        noteId: z.string().guid().optional(),
        expectedRevision: z.number().int().min(0),
        ...soapSectionsInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.transaction((tx) =>
          saveAppointmentSoapDraft(tx as unknown as Database, {
            practiceId: ctx.practiceId,
            ...input,
            actor: { id: ctx.user.id, name: ctx.user.name },
            sections: input,
          }),
        );
      } catch (error) {
        rethrowSoapLifecycleError(error);
      }
    }),

  finalizeSoapNote: soapWriter
    .input(
      z.object({
        patientId: z.string().guid(),
        appointmentId: z.string().guid(),
        noteId: z.string().guid(),
        expectedRevision: z.number().int().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.transaction((tx) =>
          finalizeAppointmentSoapDraft(tx as unknown as Database, {
            practiceId: ctx.practiceId,
            ...input,
            actor: { id: ctx.user.id, name: ctx.user.name },
          }),
        );
      } catch (error) {
        rethrowSoapLifecycleError(error);
      }
    }),

  discardSoapDraft: soapWriter
    .input(
      z.object({
        patientId: z.string().guid(),
        appointmentId: z.string().guid(),
        noteId: z.string().guid(),
        expectedRevision: z.number().int().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.transaction((tx) =>
          discardAppointmentSoapDraft(tx as unknown as Database, {
            practiceId: ctx.practiceId,
            ...input,
          }),
        );
      } catch (error) {
        rethrowSoapLifecycleError(error);
      }
    }),

  createSoapNote: soapWriter
    .input(
      z.object({
        patientId: z.string().guid(),
        appointmentId: z.string().guid(),
        ...soapSectionsInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.transaction((tx) =>
          createFinalizedAppointmentSoapNote(tx as unknown as Database, {
            practiceId: ctx.practiceId,
            patientId: input.patientId,
            appointmentId: input.appointmentId,
            actor: { id: ctx.user.id, name: ctx.user.name },
            sections: input,
          }),
        );
      } catch (error) {
        rethrowSoapLifecycleError(error);
      }
    }),
});
