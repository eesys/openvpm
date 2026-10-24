import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "./clients";
import { tenantColumns } from "./common";
import { practices } from "./practices";
import { users } from "./users";

export const commChannelValues = ["phone", "sms", "email", "portal"] as const;
export const commDirectionValues = ["inbound", "outbound"] as const;
export const commStatusValues = [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
] as const;

export const commChannel = pgEnum("comm_channel", commChannelValues);
export const commDirection = pgEnum("comm_direction", commDirectionValues);
export const commStatus = pgEnum("comm_status", commStatusValues);

export const communications = pgTable(
  "communications",
  {
    ...tenantColumns(() => practices.id),
    clientId: uuid("client_id").references(() => clients.id),
    channel: commChannel("channel").notNull(),
    direction: commDirection("direction").notNull(),
    subject: varchar("subject", { length: 255 }),
    content: text("content"),
    status: commStatus("status").notNull().default("pending"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => ({
    practiceIdUq: uniqueIndex("communications_practice_id_uq").on(
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
  }),
);

export const webhooks = pgTable(
  "webhooks",
  {
    ...tenantColumns(() => practices.id),
    url: varchar("url", { length: 512 }).notNull(),
    events: jsonb("events").$type<string[]>().notNull().default([]),
    secret: varchar("secret", { length: 255 }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => ({
    practiceActiveIdx: index("webhooks_practice_active_idx").on(
      table.practiceId,
      table.deletedAt,
      table.active,
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

export const webhooksRelations = relations(webhooks, ({ one }) => ({
  practice: one(practices, {
    fields: [webhooks.practiceId],
    references: [practices.id],
  }),
}));
