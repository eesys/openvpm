import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

/** Every table keeps an id and timestamps, including a soft-delete marker. */
export function baseColumns() {
  return {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  };
}

/** Later business tables add the clinic they belong to. */
export function tenantColumns(practiceRef: ReturnType<typeof pgTable>) {
  return {
    ...baseColumns(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practiceRef.id),
  };
}
