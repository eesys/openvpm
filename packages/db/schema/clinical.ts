import {
  boolean,
  check,
  foreignKey,
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
import { relations, sql } from "drizzle-orm";
import { baseColumns } from "./common";
import { practices } from "./practices";
import { users } from "./users";
import { patients } from "./patients";
import { appointments } from "./scheduling";

export const soapNoteStatusEnum = pgEnum("soap_note_status", [
  "draft",
  "finalized",
]);

export const soapNotes = pgTable(
  "soap_notes",
  {
    ...baseColumns(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    authorName: varchar("author_name", { length: 255 }).notNull(),
    status: soapNoteStatusEnum("status").notNull().default("finalized"),
    revision: integer("revision").notNull().default(1),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: uuid("finalized_by"),
    finalizerName: varchar("finalizer_name", { length: 255 }),
    subjective: text("subjective"),
    objective: text("objective"),
    assessment: text("assessment"),
    plan: text("plan"),
    imported: boolean("imported").notNull().default(false),
    importFingerprint: varchar("import_fingerprint", { length: 64 }),
  },
  (table) => ({
    patientIdx: index("soap_notes_patient_idx").on(table.patientId),
    practiceRecordUq: uniqueIndex("soap_notes_practice_record_uq").on(
      table.practiceId,
      table.id,
    ),
    importFingerprintUq: uniqueIndex("soap_notes_import_fingerprint_uq")
      .on(table.practiceId, table.importFingerprint)
      .where(
        sql`${table.importFingerprint} is not null and ${table.deletedAt} is null`,
      ),
    importFingerprintCheck: check(
      "soap_notes_import_fingerprint_check",
      sql`${table.importFingerprint} is null or ${table.importFingerprint} ~ '^[0-9a-f]{64}$'`,
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
    activeAppointmentDraftUq: uniqueIndex(
      "soap_notes_active_appointment_draft_uq",
    )
      .on(table.practiceId, table.appointmentId)
      .where(
        sql`${table.status} = 'draft' and ${table.appointmentId} is not null and ${table.deletedAt} is null`,
      ),
    patientPracticeFk: foreignKey({
      columns: [table.practiceId, table.patientId],
      foreignColumns: [patients.practiceId, patients.id],
      name: "soap_notes_practice_patient_fk",
    }),
    appointmentPracticeFk: foreignKey({
      columns: [table.practiceId, table.appointmentId, table.patientId],
      foreignColumns: [
        appointments.practiceId,
        appointments.id,
        appointments.patientId,
      ],
      name: "soap_notes_practice_appointment_fk",
    }),
    authorPracticeFk: foreignKey({
      columns: [table.practiceId, table.authorId],
      foreignColumns: [users.practiceId, users.id],
      name: "soap_notes_practice_author_fk",
    }),
    finalizerPracticeFk: foreignKey({
      columns: [table.practiceId, table.finalizedBy],
      foreignColumns: [users.practiceId, users.id],
      name: "soap_notes_practice_finalizer_fk",
    }),
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
        and ${table.imported} = false
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
