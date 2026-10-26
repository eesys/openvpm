import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./common";
import { locations, practices } from "./practices";

export const messagingRegistrationStatusValues = [
  "not_started",
  "pending",
  "active",
  "action_required",
  "failed",
  "suspended",
] as const;

export const messagingRegistrationStatus = pgEnum(
  "messaging_registration_status",
  messagingRegistrationStatusValues,
);

export const locationMessaging = pgTable(
  "location_messaging",
  {
    ...tenantColumns(() => practices.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id)
      .unique(),
    provider: varchar("provider", { length: 16 }).notNull().default("telnyx"),
    senderE164: varchar("sender_e164", { length: 16 }),
    registrationStatus: messagingRegistrationStatus("registration_status")
      .notNull()
      .default("not_started"),
    enabled: boolean("enabled").notNull().default(false),
  },
  (table) => ({
    practiceIdx: index("location_messaging_practice_idx").on(table.practiceId),
    senderIdx: index("location_messaging_sender_idx").on(table.senderE164),
    practiceIdUq: uniqueIndex("location_messaging_practice_id_uq").on(
      table.practiceId,
      table.id,
    ),
  }),
);

export const locationMessagingRelations = relations(locationMessaging, ({ one }) => ({
  practice: one(practices, {
    fields: [locationMessaging.practiceId],
    references: [practices.id],
  }),
  location: one(locations, {
    fields: [locationMessaging.locationId],
    references: [locations.id],
  }),
}));
