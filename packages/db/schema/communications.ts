import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { baseColumns } from "./common";
import { practices } from "./practices";
import { users } from "./users";
import { clients } from "./clients";

export const channelEnum = pgEnum("comm_channel", [
  "phone",
  "sms",
  "email",
  "portal",
]);

export const directionEnum = pgEnum("comm_direction", ["inbound", "outbound"]);

export const commStatusEnum = pgEnum("comm_status", [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
]);

export const communications = pgTable(
  "communications",
  {
    ...baseColumns(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    clientId: uuid("client_id").references(() => clients.id),
    channel: channelEnum("channel").notNull(),
    direction: directionEnum("direction").notNull(),
    subject: varchar("subject", { length: 255 }),
    content: text("content"),
    status: commStatusEnum("status").notNull().default("pending"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    readAt: timestamp("read_at", { withTimezone: true }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    dedupeKey: varchar("dedupe_key", { length: 160 }),
    reminderAttempt: integer("reminder_attempt"),
    reminderAutomatedAttempts: integer("reminder_automated_attempts"),
    reminderOutcome: varchar("reminder_outcome", { length: 32 }),
    reminderAttemptStartedAt: timestamp("reminder_attempt_started_at", {
      withTimezone: true,
    }),
    reminderClaimToken: uuid("reminder_claim_token"),
  },
  (table) => ({
    tenantIdUq: uniqueIndex("communications_practice_id_uq").on(
      table.practiceId,
      table.id,
    ),
    practiceListIdx: index("communications_practice_list_idx").on(
      table.practiceId,
      table.deletedAt,
      table.createdAt,
    ),
    clientTimelineIdx: index("communications_client_timeline_idx").on(
      table.practiceId,
      table.clientId,
      table.deletedAt,
      table.createdAt,
    ),
    inboxStatusIdx: index("communications_inbox_status_idx").on(
      table.practiceId,
      table.direction,
      table.status,
      table.deletedAt,
    ),
    assignedIdx: index("communications_assigned_idx").on(
      table.practiceId,
      table.assignedTo,
      table.deletedAt,
    ),
    dedupeKeyIdx: uniqueIndex("communications_dedupe_key_idx").on(
      table.dedupeKey,
    ),
    providerMessageIdx: index("communications_provider_message_idx").on(
      table.practiceId,
      table.providerMessageId,
      table.channel,
      table.direction,
    ),
    reminderOutcomeCheck: check(
      "communications_reminder_outcome_check",
      sql`${table.reminderOutcome} is null or ${table.reminderOutcome} in ('staff_failure', 'automated_failure', 'outcome_unknown')`,
    ),
  }),
);

export const communicationsRelations = relations(communications, ({ one }) => ({
  practice: one(practices, {
    fields: [communications.practiceId],
    references: [practices.id],
  }),
  client: one(clients, {
    fields: [communications.clientId],
    references: [clients.id],
  }),
  assignedToUser: one(users, {
    fields: [communications.assignedTo],
    references: [users.id],
  }),
}));
