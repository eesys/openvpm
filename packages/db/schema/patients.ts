import { relations } from "drizzle-orm";
import {
  date,
  index,
  pgEnum,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./common";
import { clients } from "./clients";
import { practices } from "./practices";

export const speciesValues = [
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
] as const;

export const sexValues = [
  "male",
  "female",
  "male_neutered",
  "female_spayed",
] as const;

export const patientStatusValues = ["active", "inactive", "deceased"] as const;

export const species = pgEnum("species", speciesValues);
export const sex = pgEnum("sex", sexValues);
export const patientStatus = pgEnum("patient_status", patientStatusValues);

export const patients = pgTable(
  "patients",
  {
    ...tenantColumns(() => practices.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    name: varchar("name", { length: 128 }).notNull(),
    species: species("species").notNull(),
    breed: varchar("breed", { length: 128 }),
    sex: sex("sex"),
    dob: date("dob"),
    color: varchar("color", { length: 64 }),
    microchipNumber: varchar("microchip_number", { length: 64 }),
    photoUrl: varchar("photo_url", { length: 512 }),
    status: patientStatus("status").notNull().default("active"),
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
