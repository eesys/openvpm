import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { baseColumns } from "./common";
import { practices } from "./practices";
import { users } from "./users";
import { clients } from "./clients";
import { patients } from "./patients";

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "confirmed",
  "checked_in",
  "in_exam",
  "checked_out",
  "no_show",
  "cancelled",
]);

export const appointmentOriginEnum = pgEnum("appointment_origin", [
  "scheduled",
  "field",
]);

export const roomTypeEnum = pgEnum("room_type", [
  "exam",
  "surgery",
  "treatment",
  "boarding",
]);

export const appointmentTypes = pgTable(
  "appointment_types",
  {
    ...baseColumns(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    name: varchar("name", { length: 128 }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    color: varchar("color", { length: 7 }).default("#0d9488"),
    requiresDoctor: integer("requires_doctor").notNull().default(1),
    defaultRoomType: roomTypeEnum("default_room_type").default("exam"),
  },
  (table) => ({
    practiceNameIdx: index("appointment_types_practice_name_idx").on(
      table.practiceId,
      table.deletedAt,
      table.name,
    ),
  }),
);

export const appointments = pgTable(
  "appointments",
  {
    ...baseColumns(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    typeId: uuid("type_id").references(() => appointmentTypes.id),
    patientId: uuid("patient_id").references(() => patients.id),
    clientId: uuid("client_id").references(() => clients.id),
    doctorId: uuid("doctor_id").references(() => users.id),
    status: appointmentStatusEnum("status").notNull().default("scheduled"),
    origin: appointmentOriginEnum("origin").notNull().default("scheduled"),
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
    conversionCreatedIdx: index("appointments_conversion_created_idx").on(
      table.practiceId,
      table.createdAt,
      table.id,
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
    typeStatusIdx: index("appointments_type_status_idx").on(
      table.practiceId,
      table.typeId,
      table.status,
      table.deletedAt,
    ),
    timeRangeCheck: check(
      "appointments_time_range_check",
      sql`${table.startTime} < ${table.endTime}`,
    ),
  }),
);

export const appointmentTypesRelations = relations(
  appointmentTypes,
  ({ one }) => ({
    practice: one(practices, {
      fields: [appointmentTypes.practiceId],
      references: [practices.id],
    }),
  }),
);

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  practice: one(practices, {
    fields: [appointments.practiceId],
    references: [practices.id],
  }),
  type: one(appointmentTypes, {
    fields: [appointments.typeId],
    references: [appointmentTypes.id],
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
