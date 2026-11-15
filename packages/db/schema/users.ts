import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { baseColumns } from "./common";
import { practices } from "./practices";

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "veterinarian",
  "technician",
  "front_desk",
  "viewer",
]);

export const users = pgTable(
  "users",
  {
    ...baseColumns(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    sessionVersion: integer("session_version").notNull().default(1),
    name: varchar("name", { length: 255 }).notNull(),
    role: userRoleEnum("role").notNull().default("front_desk"),
    isVeterinarian: boolean("is_veterinarian").notNull().default(false),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    avatarUrl: varchar("avatar_url", { length: 512 }),
    licenseNumber: varchar("license_number", { length: 64 }),
    phone: varchar("phone", { length: 32 }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  },
  (table) => ({
    practiceIdUq: uniqueIndex("users_practice_id_uq").on(
      table.practiceId,
      table.id,
    ),
    practiceIdx: index("users_practice_idx").on(table.practiceId, table.deletedAt),
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
