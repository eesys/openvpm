import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
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
