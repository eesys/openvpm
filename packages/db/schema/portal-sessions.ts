import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "./clients";
import { tenantColumns } from "./common";
import { practices } from "./practices";

export const portalSessions = pgTable(
  "portal_sessions",
  {
    ...tenantColumns(() => practices.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: varchar("revoked_reason", { length: 48 }),
  },
  (table) => ({
    tokenHashUq: uniqueIndex("portal_sessions_token_hash_uq").on(table.tokenHash),
    clientActiveIdx: index("portal_sessions_client_active_idx").on(
      table.practiceId,
      table.clientId,
      table.revokedAt,
      table.expiresAt,
    ),
    expiryIdx: index("portal_sessions_expiry_idx").on(table.expiresAt),
  }),
);

export const portalSessionsRelations = relations(portalSessions, ({ one }) => ({
  practice: one(practices, {
    fields: [portalSessions.practiceId],
    references: [practices.id],
  }),
  client: one(clients, {
    fields: [portalSessions.clientId],
    references: [clients.id],
  }),
}));
