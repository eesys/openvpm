import { timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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

export function tenantColumns(practiceId: () => AnyPgColumn) {
  return {
    ...baseColumns(),
    practiceId: uuid("practice_id").notNull().references(practiceId),
  };
}
