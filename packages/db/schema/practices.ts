import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

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
