import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./common";
import { practices } from "./practices";

export const contactMethodValues = ["phone", "email", "sms", "portal"] as const;

export const contactMethod = pgEnum("contact_method", contactMethodValues);

export const clients = pgTable(
  "clients",
  {
    ...tenantColumns(() => practices.id),
    firstName: varchar("first_name", { length: 128 }).notNull(),
    lastName: varchar("last_name", { length: 128 }).notNull(),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 32 }),
    address: text("address"),
    city: varchar("city", { length: 128 }),
    state: varchar("state", { length: 64 }),
    zip: varchar("zip", { length: 16 }),
    emergencyContact: varchar("emergency_contact", { length: 255 }),
    emergencyPhone: varchar("emergency_phone", { length: 32 }),
    preferredContactMethod: contactMethod("preferred_contact_method").default(
      "phone",
    ),
    smsConsent: boolean("sms_consent").notNull().default(false),
    notes: text("notes"),
    accessToken: varchar("access_token", { length: 64 }).unique(),
    portalAccessTokenExpiresAt: timestamp("portal_access_token_expires_at", {
      withTimezone: true,
    }),
    portalAccessTokenUsedAt: timestamp("portal_access_token_used_at", {
      withTimezone: true,
    }),
  },
  (table) => ({
    practiceIdUq: uniqueIndex("clients_practice_id_uq").on(
      table.practiceId,
      table.id,
    ),
    practiceIdx: index("clients_practice_idx").on(
      table.practiceId,
      table.deletedAt,
    ),
    emailIdx: index("clients_email_idx").on(table.email),
    portalAccessTokenStateCheck: check(
      "clients_portal_access_token_state_check",
      sql`(
        ${table.accessToken} is null
        and ${table.portalAccessTokenExpiresAt} is null
        and ${table.portalAccessTokenUsedAt} is null
      ) or (
        ${table.accessToken} ~ '^[0-9a-f]{64}$'
        and ${table.portalAccessTokenExpiresAt} is not null
      )`,
    ),
  }),
);

export const clientsRelations = relations(clients, ({ one }) => ({
  practice: one(practices, {
    fields: [clients.practiceId],
    references: [practices.id],
  }),
}));
