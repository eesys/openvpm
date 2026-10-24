import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { appointments, soapNotes } from "@openpims/db";
import { z } from "zod";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const SOAP_SECTION_MAX_LENGTH = 10000;

const clinician = protectedProcedure.use(requireRole("admin", "veterinarian"));

const sectionInput = z.string().max(SOAP_SECTION_MAX_LENGTH).nullish();

const soapTarget = {
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid(),
};

const soapSections = {
  subjective: sectionInput,
  objective: sectionInput,
  assessment: sectionInput,
  plan: sectionInput,
};

function normalizeSection(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
}

function normalizeSections(input: {
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
}) {
  return {
    subjective: normalizeSection(input.subjective),
    objective: normalizeSection(input.objective),
    assessment: normalizeSection(input.assessment),
    plan: normalizeSection(input.plan),
  };
}

function hasSoapContent(sections: {
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
}) {
  return Boolean(
    sections.subjective || sections.objective || sections.assessment || sections.plan,
  );
}

type SoapTx = Parameters<Parameters<typeof import("@openpims/db/client").db.transaction>[0]>[0];

async function lockExam(
  tx: SoapTx,
  practiceId: string,
  input: { patientId: string; appointmentId: string },
) {
  const [appointment] = await tx
    .select({ id: appointments.id, status: appointments.status })
    .from(appointments)
    .where(
      and(
        eq(appointments.id, input.appointmentId),
        eq(appointments.patientId, input.patientId),
        eq(appointments.practiceId, practiceId),
        isNull(appointments.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!appointment) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
  }
  if (appointment.status !== "in_exam") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "SOAP documentation can only be changed while the visit is in exam.",
    });
  }
  return appointment;
}

async function finalizedNote(
  tx: SoapTx,
  practiceId: string,
  input: { patientId: string; appointmentId: string },
) {
  const [note] = await tx
    .select()
    .from(soapNotes)
    .where(
      and(
        eq(soapNotes.practiceId, practiceId),
        eq(soapNotes.patientId, input.patientId),
        eq(soapNotes.appointmentId, input.appointmentId),
        eq(soapNotes.status, "finalized"),
        isNull(soapNotes.deletedAt),
      ),
    )
    .limit(1);
  return note ?? null;
}

export const recordsRouter = createRouter({
  listSoapNotes: protectedProcedure
    .input(z.object({ patientId: z.string().uuid() }))
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
          createdAt: soapNotes.createdAt,
        })
        .from(soapNotes)
        .where(
          and(
            eq(soapNotes.patientId, input.patientId),
            eq(soapNotes.practiceId, ctx.practiceId),
            isNull(soapNotes.deletedAt),
          ),
        )
        .orderBy(desc(soapNotes.createdAt));
    }),

  getSoapDraft: clinician
    .input(z.object(soapTarget))
    .query(async ({ ctx, input }) => {
      const [draft] = await ctx.db
        .select()
        .from(soapNotes)
        .where(
          and(
            eq(soapNotes.practiceId, ctx.practiceId),
            eq(soapNotes.patientId, input.patientId),
            eq(soapNotes.appointmentId, input.appointmentId),
            eq(soapNotes.status, "draft"),
            isNull(soapNotes.deletedAt),
          ),
        )
        .limit(1);
      return draft ?? null;
    }),

  saveSoapDraft: clinician
    .input(
      z.object({
        ...soapTarget,
        noteId: z.string().uuid().optional(),
        expectedRevision: z.number().int().min(0),
        ...soapSections,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sections = normalizeSections(input);
      return ctx.db.transaction(async (tx) => {
        await lockExam(tx, ctx.practiceId, input);
        const finalized = await finalizedNote(tx, ctx.practiceId, input);
        if (finalized) {
          return { outcome: "already_finalized" as const, note: finalized };
        }

        const [existing] = await tx
          .select()
          .from(soapNotes)
          .where(
            and(
              eq(soapNotes.practiceId, ctx.practiceId),
              eq(soapNotes.patientId, input.patientId),
              eq(soapNotes.appointmentId, input.appointmentId),
              eq(soapNotes.status, "draft"),
              isNull(soapNotes.deletedAt),
            ),
          )
          .limit(1)
          .for("update");

        if (!existing) {
          if (input.expectedRevision !== 0 || input.noteId) {
            throw new TRPCError({ code: "NOT_FOUND", message: "SOAP draft not found" });
          }
          const [created] = await tx
            .insert(soapNotes)
            .values({
              practiceId: ctx.practiceId,
              patientId: input.patientId,
              appointmentId: input.appointmentId,
              authorId: ctx.session.user.id,
              authorName: ctx.session.user.name,
              status: "draft",
              revision: 1,
              ...sections,
            })
            .returning();
          if (!created) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "SOAP draft changed while saving.",
            });
          }
          return { outcome: "saved" as const, draft: created };
        }

        if (input.noteId && existing.id !== input.noteId) {
          return { outcome: "conflict" as const, draft: existing };
        }
        if (existing.revision !== input.expectedRevision) {
          return { outcome: "conflict" as const, draft: existing };
        }

        const [saved] = await tx
          .update(soapNotes)
          .set({ ...sections, revision: existing.revision + 1 })
          .where(
            and(
              eq(soapNotes.id, existing.id),
              eq(soapNotes.practiceId, ctx.practiceId),
              eq(soapNotes.status, "draft"),
              eq(soapNotes.revision, existing.revision),
              isNull(soapNotes.deletedAt),
            ),
          )
          .returning();
        if (!saved) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "SOAP draft changed while saving.",
          });
        }
        return { outcome: "saved" as const, draft: saved };
      });
    }),

  finalizeSoapNote: clinician
    .input(
      z.object({
        ...soapTarget,
        noteId: z.string().uuid(),
        expectedRevision: z.number().int().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        await lockExam(tx, ctx.practiceId, input);
        const [note] = await tx
          .select()
          .from(soapNotes)
          .where(
            and(
              eq(soapNotes.id, input.noteId),
              eq(soapNotes.practiceId, ctx.practiceId),
              eq(soapNotes.patientId, input.patientId),
              eq(soapNotes.appointmentId, input.appointmentId),
              isNull(soapNotes.deletedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!note) {
          throw new TRPCError({ code: "NOT_FOUND", message: "SOAP draft not found" });
        }
        if (note.status === "finalized") {
          return note.revision === input.expectedRevision
            ? { outcome: "finalized" as const, note, transitioned: false }
            : { outcome: "conflict" as const, note };
        }
        if (note.revision !== input.expectedRevision) {
          return { outcome: "conflict" as const, note };
        }
        if (!hasSoapContent(normalizeSections(note))) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "SOAP note must include at least one section before finalization.",
          });
        }

        const [finalized] = await tx
          .update(soapNotes)
          .set({
            status: "finalized",
            finalizedAt: new Date(),
            finalizedBy: ctx.session.user.id,
            finalizerName: ctx.session.user.name,
          })
          .where(
            and(
              eq(soapNotes.id, note.id),
              eq(soapNotes.practiceId, ctx.practiceId),
              eq(soapNotes.status, "draft"),
              eq(soapNotes.revision, note.revision),
              isNull(soapNotes.deletedAt),
            ),
          )
          .returning();
        if (!finalized) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "SOAP draft changed while saving.",
          });
        }
        return { outcome: "finalized" as const, note: finalized, transitioned: true };
      });
    }),
});
