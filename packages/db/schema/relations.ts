import { relations } from "drizzle-orm";
import { memberships } from "./memberships";
import { practices } from "./practices";
import { users } from "./users";

export const practicesRelations = relations(practices, ({ many }) => ({
  memberships: many(memberships),
}));

export const usersRelations = relations(users, ({ one }) => ({
  membership: one(memberships, {
    fields: [users.id],
    references: [memberships.userId],
  }),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  practice: one(practices, {
    fields: [memberships.practiceId],
    references: [practices.id],
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
}));
