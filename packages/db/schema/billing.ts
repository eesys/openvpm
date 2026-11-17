import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { baseColumns } from "./common";
import { practices } from "./practices";
import { clients } from "./clients";
import { patients } from "./patients";
import { appointments } from "./scheduling";

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "paid",
  "overdue",
  "void",
]);

export const invoiceItemTypeEnum = pgEnum("invoice_item_type", [
  "service",
  "product",
]);

export const services = pgTable(
  "services",
  {
    ...baseColumns(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 32 }),
    category: varchar("category", { length: 128 }),
    defaultPrice: numeric("default_price", { precision: 10, scale: 2 }).notNull(),
    taxable: boolean("taxable").notNull().default(true),
    externalSource: varchar("external_source", { length: 64 }),
    externalId: varchar("external_id", { length: 160 }),
    importFingerprint: varchar("import_fingerprint", { length: 64 }),
  },
  (table) => ({
    practiceNameIdx: index("services_practice_name_idx").on(
      table.practiceId,
      table.deletedAt,
      table.name,
    ),
    practiceIdUq: uniqueIndex("services_practice_id_uq").on(
      table.practiceId,
      table.id,
    ),
    defaultPriceNonnegative: check(
      "services_default_price_nonnegative",
      sql`${table.defaultPrice} >= 0`,
    ),
    externalIdUq: uniqueIndex("services_external_id_uq")
      .on(table.practiceId, table.externalSource, table.externalId)
      .where(
        sql`${table.externalSource} is not null and ${table.externalId} is not null`,
      ),
    importFingerprintUq: uniqueIndex("services_import_fingerprint_uq")
      .on(table.practiceId, table.importFingerprint)
      .where(sql`${table.importFingerprint} is not null`),
    importIdentityCheck: check(
      "services_import_identity_check",
      sql`(${table.externalSource} is null and ${table.externalId} is null and ${table.importFingerprint} is null)
        or (${table.externalSource} is not null and ${table.externalId} is not null and ${table.importFingerprint} is not null)`,
    ),
    importFingerprintCheck: check(
      "services_import_fingerprint_check",
      sql`${table.importFingerprint} is null or ${table.importFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    externalSourceCheck: check(
      "services_external_source_check",
      sql`${table.externalSource} is null or ${table.externalSource} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`,
    ),
  }),
);

export const invoices = pgTable(
  "invoices",
  {
    ...baseColumns(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    patientId: uuid("patient_id").references(() => patients.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    subtotal: numeric("subtotal", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    tax: numeric("tax", { precision: 10, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 10, scale: 2 }).notNull().default("0"),
    paidAmount: numeric("paid_amount", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    dueDate: date("due_date"),
    isEstimate: boolean("is_estimate").notNull().default(false),
  },
  (table) => ({
    practiceIdx: index("invoices_practice_idx").on(
      table.practiceId,
      table.deletedAt,
      table.createdAt,
    ),
    clientIdx: index("invoices_client_idx").on(
      table.practiceId,
      table.clientId,
      table.deletedAt,
      table.createdAt,
    ),
    patientIdx: index("invoices_patient_idx").on(
      table.practiceId,
      table.patientId,
      table.clientId,
      table.deletedAt,
    ),
    appointmentIdx: index("invoices_appointment_idx").on(
      table.practiceId,
      table.appointmentId,
      table.deletedAt,
      table.isEstimate,
      table.status,
    ),
    activeAppointmentUq: uniqueIndex("invoices_active_appointment_uq")
      .on(table.practiceId, table.appointmentId)
      .where(
        sql`${table.appointmentId} is not null
          and ${table.isEstimate} = false
          and ${table.status} <> 'void'
          and ${table.deletedAt} is null`,
      ),
    visitTargetUq: uniqueIndex("invoices_visit_target_uq").on(
      table.practiceId,
      table.appointmentId,
      table.id,
    ),
    practiceIdUq: uniqueIndex("invoices_practice_id_uq").on(
      table.practiceId,
      table.id,
    ),
  }),
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    ...baseColumns(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    description: varchar("description", { length: 500 }).notNull(),
    quantity: numeric("quantity", {
      precision: 13,
      scale: 3,
      mode: "number",
    })
      .notNull()
      .default(1),
    unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
    total: numeric("total", { precision: 10, scale: 2 }).notNull(),
    taxable: boolean("taxable").notNull().default(true),
    itemType: invoiceItemTypeEnum("item_type").notNull(),
    itemId: uuid("item_id"),
  },
  (table) => ({
    invoiceIdx: index("invoice_items_invoice_idx").on(
      table.invoiceId,
      table.deletedAt,
    ),
    itemIdx: index("invoice_items_item_idx").on(
      table.itemType,
      table.deletedAt,
      table.itemId,
    ),
    invoiceItemTargetUq: uniqueIndex("invoice_items_invoice_item_target_uq").on(
      table.invoiceId,
      table.id,
    ),
  }),
);

export const servicesRelations = relations(services, ({ one }) => ({
  practice: one(practices, {
    fields: [services.practiceId],
    references: [practices.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  practice: one(practices, {
    fields: [invoices.practiceId],
    references: [practices.id],
  }),
  client: one(clients, {
    fields: [invoices.clientId],
    references: [clients.id],
  }),
  patient: one(patients, {
    fields: [invoices.patientId],
    references: [patients.id],
  }),
  appointment: one(appointments, {
    fields: [invoices.appointmentId],
    references: [appointments.id],
  }),
  items: many(invoiceItems),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id],
  }),
}));
