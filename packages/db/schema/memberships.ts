import {
  boolean,
  index,
  pgEnum,
  pgTable,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./common";
import { practices } from "./practices";
import { users } from "./users";

export const membershipRole = pgEnum("membership_role", [
  "admin",
  "veterinarian",
  "technician",
  "front_desk",
  "viewer",
]);

export const memberships = pgTable(
  "memberships",
  {
    ...tenantColumns(() => practices.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRole("role").notNull().default("front_desk"),
    isVeterinarian: boolean("is_veterinarian").notNull().default(false),
  },
  (table) => ({
    practiceIdUq: uniqueIndex("memberships_practice_id_uq").on(
      table.practiceId,
      table.id,
    ),
    userUq: uniqueIndex("memberships_user_uq").on(table.userId),
    practiceIdx: index("memberships_practice_idx").on(
      table.practiceId,
      table.deletedAt,
    ),
  }),
);
