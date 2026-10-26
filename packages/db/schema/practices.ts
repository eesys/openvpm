import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { tenantColumns, baseColumns } from "./common";

export const practices = pgTable("practices", {
  ...baseColumns(),
  name: varchar("name", { length: 255 }).notNull(),
  address: text("address"),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 255 }),
  website: varchar("website", { length: 255 }),
  timezone: varchar("timezone", { length: 64 })
    .notNull()
    .default("America/New_York"),
  logoUrl: varchar("logo_url", { length: 512 }),
  // Hosted-SaaS subscription (ignored by self-host unless HOSTED_BILLING_ENABLED).
  // subscriptionTier is the canonical plan tier: free | cloud | enterprise.
  subscriptionTier: varchar("subscription_tier", { length: 32 })
    .notNull()
    .default("free"),
  // Stripe-style billing lifecycle: none | trialing | active | past_due | canceled.
  billingStatus: varchar("billing_status", { length: 24 })
    .notNull()
    .default("none"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
});

export const locations = pgTable(
  "locations",
  {
    ...tenantColumns(() => practices.id),
    name: varchar("name", { length: 255 }).notNull(),
    address: text("address"),
    phone: varchar("phone", { length: 32 }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (table) => ({
    practiceIdUq: uniqueIndex("locations_practice_id_uq").on(table.practiceId, table.id),
    practiceIdx: index("locations_practice_idx").on(table.practiceId, table.deletedAt),
    primaryIdx: index("locations_primary_idx").on(table.practiceId, table.isPrimary),
  }),
);

export const locationsRelations = relations(locations, ({ one }) => ({
  practice: one(practices, {
    fields: [locations.practiceId],
    references: [practices.id],
  }),
}));
