import { and, eq, isNull, sql } from "drizzle-orm";
import { appointments, practices, soapNotes } from "@openpims/db";
import type { Database } from "@openpims/db/client";
import {
  hasSoapContent,
  normalizeSoapSection,
} from "@/lib/records/soap-content";

export interface SoapSections {
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
}

export interface SoapActor {
  id: string;
  name: string;
}

export type SoapDraft = typeof soapNotes.$inferSelect;

export class SoapLifecycleError extends Error {
  constructor(
    readonly code:
      | "BAD_REQUEST"
      | "NOT_FOUND"
      | "CONFLICT"
      | "PRECONDITION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "SoapLifecycleError";
  }
}

export function normalizeSoapSections(sections: SoapSections) {
  return {
    subjective: normalizeSoapSection(sections.subjective) ?? null,
    objective: normalizeSoapSection(sections.objective) ?? null,
    assessment: normalizeSoapSection(sections.assessment) ?? null,
    plan: normalizeSoapSection(sections.plan) ?? null,
  };
}

function sectionsMatch(left: SoapSections, right: SoapSections): boolean {
  const a = normalizeSoapSections(left);
  const b = normalizeSoapSections(right);
  return (
    a.subjective === b.subjective &&
    a.objective === b.objective &&
    a.assessment === b.assessment &&
    a.plan === b.plan
  );
}

function authorName(actor: SoapActor): string {
  const name = actor.name.trim();
  if (!name || name.length > 255) {
    throw new SoapLifecycleError("BAD_REQUEST", "SOAP author name is required.");
  }
  return name;
}

async function lockAppointment(
  db: Database,
  input: { practiceId: string; patientId: string; appointmentId: string },
) {
  const [appointment] = await db
    .select({
      id: appointments.id,
      status: appointments.status,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.id, input.appointmentId),
        eq(appointments.patientId, input.patientId),
        eq(appointments.practiceId, input.practiceId),
        isNull(appointments.deletedAt),
        sql`exists (
          select 1
          from ${practices}
          where ${practices.id} = ${input.practiceId}
            and ${practices.deletedAt} is null
        )`,
      ),
    )
    .limit(1)
    .for("update");
  return appointment ?? null;
}

async function finalizedNote(
  db: Database,
  input: {
    practiceId: string;
    patientId: string;
    appointmentId: string;
    noteId?: string;
  },
) {
  const predicates = [
    eq(soapNotes.practiceId, input.practiceId),
    eq(soapNotes.patientId, input.patientId),
    eq(soapNotes.appointmentId, input.appointmentId),
    eq(soapNotes.status, "finalized"),
    isNull(soapNotes.deletedAt),
  ];
  if (input.noteId) predicates.push(eq(soapNotes.id, input.noteId));
  const [note] = await db
    .select()
    .from(soapNotes)
    .where(and(...predicates))
    .limit(1);
  return note ?? null;
}

async function requireOpenVisit(
  db: Database,
  input: { practiceId: string; patientId: string; appointmentId: string },
) {
  const appointment = await lockAppointment(db, input);
  if (!appointment) {
    throw new SoapLifecycleError("NOT_FOUND", "Appointment not found");
  }
  if (appointment.status !== "in_exam") {
    throw new SoapLifecycleError(
      "PRECONDITION_FAILED",
      "SOAP documentation can only be changed while the visit is in exam.",
    );
  }
  return appointment;
}

async function openVisitOrFinalizedNote(
  db: Database,
  input: {
    practiceId: string;
    patientId: string;
    appointmentId: string;
    noteId?: string;
  },
) {
  try {
    await requireOpenVisit(db, input);
    return null;
  } catch (error) {
    if (
      error instanceof SoapLifecycleError &&
      error.code === "PRECONDITION_FAILED"
    ) {
      const finalized = await finalizedNote(db, input);
      if (finalized) return finalized;
    }
    throw error;
  }
}

export async function getAppointmentSoapDraft(
  db: Database,
  input: { practiceId: string; patientId: string; appointmentId: string },
) {
  const [draft] = await db
    .select()
    .from(soapNotes)
    .where(
      and(
        eq(soapNotes.practiceId, input.practiceId),
        eq(soapNotes.patientId, input.patientId),
        eq(soapNotes.appointmentId, input.appointmentId),
        eq(soapNotes.status, "draft"),
        isNull(soapNotes.deletedAt),
      ),
    )
    .limit(1);
  return draft ?? null;
}

export type SaveSoapDraftResult =
  | { outcome: "saved"; draft: SoapDraft }
  | { outcome: "conflict"; draft: SoapDraft }
  | { outcome: "already_finalized"; note: SoapDraft };

export async function saveAppointmentSoapDraft(
  db: Database,
  input: {
    practiceId: string;
    patientId: string;
    appointmentId: string;
    noteId?: string;
    expectedRevision: number;
    actor: SoapActor;
    sections: SoapSections;
  },
): Promise<SaveSoapDraftResult> {
  const finalizedAfterClose = await openVisitOrFinalizedNote(db, input);
  if (finalizedAfterClose) {
    if (!input.noteId || finalizedAfterClose.id === input.noteId) {
      return { outcome: "already_finalized", note: finalizedAfterClose };
    }
    throw new SoapLifecycleError(
      "CONFLICT",
      "This encounter already has finalized SOAP documentation.",
    );
  }

  const sections = normalizeSoapSections(input.sections);
  const name = authorName(input.actor);
  const [existing] = await db
    .select()
    .from(soapNotes)
    .where(
      and(
        eq(soapNotes.practiceId, input.practiceId),
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
      if (input.noteId) {
        const note = await finalizedNote(db, { ...input, noteId: input.noteId });
        if (note) return { outcome: "already_finalized", note };
      }
      throw new SoapLifecycleError("NOT_FOUND", "SOAP draft not found");
    }
    const existingFinalized = await finalizedNote(db, input);
    if (existingFinalized) {
      return { outcome: "already_finalized", note: existingFinalized };
    }
    const [created] = await db
      .insert(soapNotes)
      .values({
        practiceId: input.practiceId,
        patientId: input.patientId,
        appointmentId: input.appointmentId,
        authorId: input.actor.id,
        authorName: name,
        status: "draft",
        revision: 1,
        finalizedAt: null,
        finalizedBy: null,
        finalizerName: null,
        imported: false,
        ...sections,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return { outcome: "saved", draft: created };
    const concurrent = await getAppointmentSoapDraft(db, input);
    if (!concurrent) {
      throw new SoapLifecycleError("CONFLICT", "SOAP draft changed while saving.");
    }
    return sectionsMatch(concurrent, sections)
      ? { outcome: "saved", draft: concurrent }
      : { outcome: "conflict", draft: concurrent };
  }

  if (input.noteId && existing.id !== input.noteId) {
    return { outcome: "conflict", draft: existing };
  }
  if (
    existing.revision === input.expectedRevision + 1 &&
    sectionsMatch(existing, sections)
  ) {
    return { outcome: "saved", draft: existing };
  }
  if (existing.revision !== input.expectedRevision) {
    return { outcome: "conflict", draft: existing };
  }
  if (sectionsMatch(existing, sections)) {
    return { outcome: "saved", draft: existing };
  }

  const [saved] = await db
    .update(soapNotes)
    .set({ ...sections, revision: existing.revision + 1 })
    .where(
      and(
        eq(soapNotes.id, existing.id),
        eq(soapNotes.practiceId, input.practiceId),
        eq(soapNotes.status, "draft"),
        eq(soapNotes.revision, existing.revision),
        isNull(soapNotes.deletedAt),
      ),
    )
    .returning();
  if (!saved) {
    const latest = await getAppointmentSoapDraft(db, input);
    if (!latest) {
      const note = await finalizedNote(db, { ...input, noteId: existing.id });
      if (note) return { outcome: "already_finalized", note };
      throw new SoapLifecycleError("CONFLICT", "SOAP draft changed while saving.");
    }
    return { outcome: "conflict", draft: latest };
  }
  return { outcome: "saved", draft: saved };
}

export type FinalizeSoapResult =
  | { outcome: "finalized"; note: SoapDraft; transitioned: boolean }
  | { outcome: "conflict"; note: SoapDraft };

export async function finalizeAppointmentSoapDraft(
  db: Database,
  input: {
    practiceId: string;
    patientId: string;
    appointmentId: string;
    noteId: string;
    expectedRevision: number;
    actor: SoapActor;
  },
): Promise<FinalizeSoapResult> {
  const finalizedAfterClose = await openVisitOrFinalizedNote(db, input);
  if (finalizedAfterClose) {
    return finalizedAfterClose.revision === input.expectedRevision
      ? { outcome: "finalized", note: finalizedAfterClose, transitioned: false }
      : { outcome: "conflict", note: finalizedAfterClose };
  }

  const name = authorName(input.actor);
  const [note] = await db
    .select()
    .from(soapNotes)
    .where(
      and(
        eq(soapNotes.id, input.noteId),
        eq(soapNotes.practiceId, input.practiceId),
        eq(soapNotes.patientId, input.patientId),
        eq(soapNotes.appointmentId, input.appointmentId),
        isNull(soapNotes.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!note) throw new SoapLifecycleError("NOT_FOUND", "SOAP draft not found");
  if (note.status === "finalized") {
    return note.revision === input.expectedRevision
      ? { outcome: "finalized", note, transitioned: false }
      : { outcome: "conflict", note };
  }
  if (note.revision !== input.expectedRevision) {
    return { outcome: "conflict", note };
  }
  if (!hasSoapContent(note)) {
    throw new SoapLifecycleError(
      "BAD_REQUEST",
      "SOAP note must include at least one section before finalization.",
    );
  }

  const [finalized] = await db
    .update(soapNotes)
    .set({
      status: "finalized",
      finalizedAt: new Date(),
      finalizedBy: input.actor.id,
      finalizerName: name,
    })
    .where(
      and(
        eq(soapNotes.id, note.id),
        eq(soapNotes.practiceId, input.practiceId),
        eq(soapNotes.status, "draft"),
        eq(soapNotes.revision, note.revision),
        isNull(soapNotes.deletedAt),
      ),
    )
    .returning();
  if (!finalized) {
    const [latest] = await db
      .select()
      .from(soapNotes)
      .where(
        and(
          eq(soapNotes.id, note.id),
          eq(soapNotes.practiceId, input.practiceId),
          isNull(soapNotes.deletedAt),
        ),
      )
      .limit(1);
    if (!latest) {
      throw new SoapLifecycleError(
        "CONFLICT",
        "SOAP draft changed while finalizing.",
      );
    }
    if (latest.status === "finalized") {
      return latest.revision === input.expectedRevision
        ? { outcome: "finalized", note: latest, transitioned: false }
        : { outcome: "conflict", note: latest };
    }
    return { outcome: "conflict", note: latest };
  }
  return { outcome: "finalized", note: finalized, transitioned: true };
}

export type DiscardSoapDraftResult =
  | { outcome: "discarded"; noteId: string }
  | { outcome: "conflict"; draft: SoapDraft }
  | { outcome: "already_finalized"; note: SoapDraft };

export async function discardAppointmentSoapDraft(
  db: Database,
  input: {
    practiceId: string;
    patientId: string;
    appointmentId: string;
    noteId: string;
    expectedRevision: number;
  },
): Promise<DiscardSoapDraftResult> {
  const finalizedAfterClose = await openVisitOrFinalizedNote(db, input);
  if (finalizedAfterClose) {
    return { outcome: "already_finalized", note: finalizedAfterClose };
  }
  const [draft] = await db
    .select()
    .from(soapNotes)
    .where(
      and(
        eq(soapNotes.id, input.noteId),
        eq(soapNotes.practiceId, input.practiceId),
        eq(soapNotes.patientId, input.patientId),
        eq(soapNotes.appointmentId, input.appointmentId),
        eq(soapNotes.status, "draft"),
        isNull(soapNotes.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!draft) {
    const note = await finalizedNote(db, input);
    if (note) return { outcome: "already_finalized", note };
    throw new SoapLifecycleError("NOT_FOUND", "SOAP draft not found");
  }
  if (draft.revision !== input.expectedRevision) {
    return { outcome: "conflict", draft };
  }
  const [deleted] = await db
    .delete(soapNotes)
    .where(
      and(
        eq(soapNotes.id, draft.id),
        eq(soapNotes.practiceId, input.practiceId),
        eq(soapNotes.status, "draft"),
        eq(soapNotes.revision, draft.revision),
      ),
    )
    .returning({ id: soapNotes.id });
  if (!deleted) return { outcome: "conflict", draft };
  return { outcome: "discarded", noteId: deleted.id };
}

export async function createFinalizedAppointmentSoapNote(
  db: Database,
  input: {
    practiceId: string;
    patientId: string;
    appointmentId: string;
    actor: SoapActor;
    sections: SoapSections;
  },
) {
  const sections = normalizeSoapSections(input.sections);
  if (!hasSoapContent(sections)) {
    throw new SoapLifecycleError(
      "BAD_REQUEST",
      "SOAP note must include at least one section.",
    );
  }
  await requireOpenVisit(db, input);
  const draft = await getAppointmentSoapDraft(db, input);
  if (draft) {
    throw new SoapLifecycleError(
      "CONFLICT",
      "A SOAP draft already exists. Resume and finalize it instead.",
    );
  }
  const existingFinalized = await finalizedNote(db, input);
  if (existingFinalized) {
    throw new SoapLifecycleError(
      "CONFLICT",
      "This encounter already has finalized SOAP documentation.",
    );
  }
  const name = authorName(input.actor);
  const [note] = await db
    .insert(soapNotes)
    .values({
      practiceId: input.practiceId,
      patientId: input.patientId,
      appointmentId: input.appointmentId,
      authorId: input.actor.id,
      authorName: name,
      status: "finalized",
      revision: 1,
      finalizedAt: new Date(),
      finalizedBy: input.actor.id,
      finalizerName: name,
      imported: false,
      ...sections,
    })
    .returning();
  if (!note) {
    throw new SoapLifecycleError("CONFLICT", "SOAP note could not be created.");
  }
  return note;
}
