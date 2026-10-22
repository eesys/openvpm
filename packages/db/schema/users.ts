import { pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

export const users = pgTable(
  "users",
  {
    ...baseColumns(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 32 }),
  },
  (table) => ({
    emailUq: uniqueIndex("users_email_uq").on(table.email),
  }),
);
