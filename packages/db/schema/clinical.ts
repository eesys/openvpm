import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./common";
import { patients } from "./patients";
import { practices } from "./practices";
import { appointments } from "./scheduling";
import { users } from "./users";

export const soapNoteStatusValues = ["draft", "finalized"] as const;

export const soapNoteStatus = pgEnum("soap_note_status", soapNoteStatusValues);

export const soapNotes = pgTable(
  "soap_notes",
  {
    ...tenantColumns(() => practices.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    authorName: varchar("author_name", { length: 255 }).notNull(),
    status: soapNoteStatus("status").notNull().default("finalized"),
    revision: integer("revision").notNull().default(1),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: uuid("finalized_by").references(() => users.id),
    finalizerName: varchar("finalizer_name", { length: 255 }),
    subjective: text("subjective"),
    objective: text("objective"),
    assessment: text("assessment"),
    plan: text("plan"),
  },
  (table) => ({
    patientIdx: index("soap_notes_patient_idx").on(table.patientId),
    practiceRecordUq: uniqueIndex("soap_notes_practice_record_uq").on(
      table.practiceId,
      table.id,
    ),
    practiceIdx: index("soap_notes_practice_idx").on(
      table.practiceId,
      table.deletedAt,
    ),
    appointmentIdx: index("soap_notes_appointment_idx").on(
      table.practiceId,
      table.appointmentId,
      table.deletedAt,
    ),
    activeAppointmentDraftUq: uniqueIndex("soap_notes_active_appointment_draft_uq")
      .on(table.practiceId, table.appointmentId)
      .where(
        sql`${table.status} = 'draft' and ${table.appointmentId} is not null and ${table.deletedAt} is null`,
      ),
    revisionCheck: check(
      "soap_notes_revision_check",
      sql`${table.revision} >= 1`,
    ),
    authorNameCheck: check(
      "soap_notes_author_name_check",
      sql`length(btrim(${table.authorName})) between 1 and 255`,
    ),
    lifecycleCheck: check(
      "soap_notes_lifecycle_check",
      sql`(
        ${table.status} = 'draft'
        and ${table.finalizedAt} is null
        and ${table.finalizedBy} is null
        and ${table.finalizerName} is null
      ) or (
        ${table.status} = 'finalized'
        and ${table.finalizedAt} is not null
        and ${table.finalizedBy} is not null
        and length(btrim(${table.finalizerName})) between 1 and 255
      )`,
    ),
  }),
);

export const soapNotesRelations = relations(soapNotes, ({ one }) => ({
  practice: one(practices, {
    fields: [soapNotes.practiceId],
    references: [practices.id],
  }),
  patient: one(patients, {
    fields: [soapNotes.patientId],
    references: [patients.id],
  }),
  appointment: one(appointments, {
    fields: [soapNotes.appointmentId],
    references: [appointments.id],
  }),
  author: one(users, {
    fields: [soapNotes.authorId],
    references: [users.id],
  }),
}));
