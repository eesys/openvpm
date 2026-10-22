import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./common";
import { practices } from "./practices";

export const userRole = pgEnum("user_role", [
  "admin",
  "veterinarian",
  "technician",
  "front_desk",
  "viewer",
]);

export const users = pgTable(
  "users",
  {
    ...tenantColumns(() => practices.id),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    role: userRole("role").notNull().default("front_desk"),
    isVeterinarian: boolean("is_veterinarian").notNull().default(false),
  },
  (table) => ({
    emailUq: uniqueIndex("users_email_uq").on(table.email),
    practiceIdUq: uniqueIndex("users_practice_id_uq").on(
      table.practiceId,
      table.id,
    ),
    practiceIdx: index("users_practice_idx").on(
      table.practiceId,
      table.deletedAt,
    ),
    roleIdx: index("users_role_idx").on(table.practiceId, table.role),
    veterinarianIdx: index("users_veterinarian_idx").on(
      table.practiceId,
      table.isVeterinarian,
      table.deletedAt,
    ),
  }),
);

export const usersRelations = relations(users, ({ one }) => ({
  practice: one(practices, {
    fields: [users.practiceId],
    references: [practices.id],
  }),
}));
