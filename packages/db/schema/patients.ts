import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { baseColumns } from "./common";
import { practices } from "./practices";
import { clients } from "./clients";

export const speciesEnum = pgEnum("species", [
  "canine",
  "feline",
  "avian",
  "rabbit",
  "reptile",
  "equine",
  "bovine",
  "ovine",
  "caprine",
  "porcine",
  "poultry",
  "camelid",
  "other",
]);

export const sexEnum = pgEnum("sex", [
  "male",
  "female",
  "male_neutered",
  "female_spayed",
]);

export const patientStatusEnum = pgEnum("patient_status", [
  "active",
  "inactive",
  "deceased",
]);

export const patients = pgTable(
  "patients",
  {
    ...baseColumns(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    name: varchar("name", { length: 128 }).notNull(),
    species: speciesEnum("species").notNull(),
    breed: varchar("breed", { length: 128 }),
    sex: sexEnum("sex"),
    dob: date("dob"),
    color: varchar("color", { length: 64 }),
    microchipNumber: varchar("microchip_number", { length: 64 }),
    photoUrl: varchar("photo_url", { length: 512 }),
    status: patientStatusEnum("status").notNull().default("active"),
  },
  (table) => ({
    practiceIdUq: uniqueIndex("patients_practice_id_uq").on(
      table.practiceId,
      table.id,
    ),
    practiceClientIdUq: uniqueIndex("patients_practice_client_id_uq").on(
      table.practiceId,
      table.id,
      table.clientId,
    ),
    practiceIdx: index("patients_practice_idx").on(
      table.practiceId,
      table.deletedAt,
    ),
    clientIdx: index("patients_client_idx").on(table.clientId),
    nameIdx: index("patients_name_idx").on(table.name),
  }),
);

export const patientsRelations = relations(patients, ({ one }) => ({
  practice: one(practices, {
    fields: [patients.practiceId],
    references: [practices.id],
  }),
  client: one(clients, {
    fields: [patients.clientId],
    references: [clients.id],
  }),
}));
