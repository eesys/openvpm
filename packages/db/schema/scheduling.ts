import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { clients } from "./clients";
import { tenantColumns } from "./common";
import { patients } from "./patients";
import { practices } from "./practices";
import { users } from "./users";

export const appointmentStatusValues = [
  "scheduled",
  "confirmed",
  "checked_in",
  "in_exam",
  "checked_out",
  "no_show",
  "cancelled",
] as const;

export const appointmentStatus = pgEnum(
  "appointment_status",
  appointmentStatusValues,
);

export const appointments = pgTable(
  "appointments",
  {
    ...tenantColumns(() => practices.id),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    patientId: uuid("patient_id").references(() => patients.id),
    clientId: uuid("client_id").references(() => clients.id),
    doctorId: uuid("doctor_id").references(() => users.id),
    status: appointmentStatus("status").notNull().default("scheduled"),
    notes: text("notes"),
  },
  (table) => ({
    practiceIdUq: uniqueIndex("appointments_practice_id_uq").on(
      table.practiceId,
      table.id,
    ),
    practicePatientIdUq: uniqueIndex("appointments_practice_patient_id_uq").on(
      table.practiceId,
      table.id,
      table.patientId,
    ),
    practicePatientClientIdUq: uniqueIndex(
      "appointments_practice_patient_client_id_uq",
    ).on(table.practiceId, table.id, table.patientId, table.clientId),
    practiceTimeIdx: index("appointments_practice_time_idx").on(
      table.practiceId,
      table.startTime,
      table.doctorId,
    ),
    patientIdx: index("appointments_patient_idx").on(table.patientId),
    doctorIdx: index("appointments_doctor_idx").on(
      table.doctorId,
      table.startTime,
    ),
    clientStatusIdx: index("appointments_client_status_idx").on(
      table.practiceId,
      table.clientId,
      table.status,
      table.deletedAt,
    ),
    patientStatusIdx: index("appointments_patient_status_idx").on(
      table.practiceId,
      table.patientId,
      table.status,
      table.deletedAt,
    ),
    doctorStatusIdx: index("appointments_doctor_status_idx").on(
      table.practiceId,
      table.doctorId,
      table.status,
      table.deletedAt,
    ),
    timeRangeCheck: check(
      "appointments_time_range_check",
      sql`${table.startTime} < ${table.endTime}`,
    ),
  }),
);

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  practice: one(practices, {
    fields: [appointments.practiceId],
    references: [practices.id],
  }),
  patient: one(patients, {
    fields: [appointments.patientId],
    references: [patients.id],
  }),
  client: one(clients, {
    fields: [appointments.clientId],
    references: [clients.id],
  }),
  doctor: one(users, {
    fields: [appointments.doctorId],
    references: [users.id],
  }),
}));
