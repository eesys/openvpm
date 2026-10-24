import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "./clients";
import { baseColumns, tenantColumns } from "./common";
import { patients } from "./patients";
import { practices } from "./practices";
import { appointments } from "./scheduling";

export const invoiceStatusValues = [
  "draft",
  "sent",
  "paid",
  "overdue",
  "void",
] as const;

export const invoiceItemTypeValues = ["service", "product"] as const;

export const invoiceStatus = pgEnum("invoice_status", invoiceStatusValues);
export const invoiceItemType = pgEnum("invoice_item_type", invoiceItemTypeValues);

export const invoices = pgTable(
  "invoices",
  {
    ...tenantColumns(() => practices.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    patientId: uuid("patient_id").references(() => patients.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    status: invoiceStatus("status").notNull().default("draft"),
    subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
    tax: numeric("tax", { precision: 10, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 10, scale: 2 }).notNull().default("0"),
    paidAmount: numeric("paid_amount", { precision: 10, scale: 2 }).notNull().default("0"),
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
        sql`${table.appointmentId} is not null and ${table.isEstimate} = false and ${table.status} <> 'void' and ${table.deletedAt} is null`,
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
    quantity: numeric("quantity", { precision: 13, scale: 3, mode: "number" })
      .notNull()
      .default(1),
    unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
    total: numeric("total", { precision: 10, scale: 2 }).notNull(),
    taxable: boolean("taxable").notNull().default(true),
    itemType: invoiceItemType("item_type").notNull(),
  },
  (table) => ({
    invoiceIdx: index("invoice_items_invoice_idx").on(
      table.invoiceId,
      table.deletedAt,
    ),
    invoiceItemTargetUq: uniqueIndex("invoice_items_invoice_item_target_uq").on(
      table.invoiceId,
      table.id,
    ),
  }),
);

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

export const products = pgTable(
  "products",
  {
    ...tenantColumns(() => practices.id),
    name: varchar("name", { length: 255 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
    taxable: boolean("taxable").notNull().default(true),
    inventoryTracked: boolean("inventory_tracked").notNull().default(true),
    stockQuantity: numeric("stock_quantity", { precision: 13, scale: 3, mode: "number" })
      .notNull()
      .default(0),
    reorderPoint: integer("reorder_point").default(10),
  },
  (table) => ({
    practiceIdx: index("products_practice_idx").on(table.practiceId, table.deletedAt),
    practiceNameIdx: index("products_practice_name_idx").on(
      table.practiceId,
      table.deletedAt,
      table.name,
    ),
    stockAlertIdx: index("products_stock_alert_idx").on(
      table.practiceId,
      table.deletedAt,
      table.stockQuantity,
    ),
    practiceIdUq: uniqueIndex("products_practice_id_uq").on(table.practiceId, table.id),
    inventoryTrackingCheck: check(
      "products_inventory_tracking_check",
      sql`${table.inventoryTracked} or (
        ${table.stockQuantity} = 0
        and ${table.reorderPoint} is null
      )`,
    ),
  }),
);

export const productsRelations = relations(products, ({ one }) => ({
  practice: one(practices, {
    fields: [products.practiceId],
    references: [practices.id],
  }),
}));
