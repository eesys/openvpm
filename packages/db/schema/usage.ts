import {
  index,
  integer,
  pgTable,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { practices } from "./practices";

/**
 * Metered usage events for the hosted service (SMS sends, AI agent runs). Rolled
 * up per billing period to charge overage beyond a plan's included allowance.
 * Only written when HOSTED_BILLING_ENABLED — self-host never meters.
 */
export const usageRecords = pgTable(
  "usage_records",
  {
    ...baseColumns(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    /** "sms" | "ai_run" */
    kind: varchar("kind", { length: 16 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    /** Billing period as YYYY-MM (UTC). */
    periodMonth: varchar("period_month", { length: 7 }).notNull(),
  },
  (t) => ({
    practicePeriodIdx: index("usage_practice_period_idx").on(
      t.practiceId,
      t.periodMonth,
    ),
  }),
);
