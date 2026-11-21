import { sql } from "drizzle-orm";
import type { Database } from "@openpims/db/client";

export type TenantTransactionOptions = {
  isolationLevel?: "serializable";
};

/**
 * Set `app.current_practice_id` on the same connection that runs the queries.
 * postgres-js pools connections, so the setting has to be local to this
 * transaction. The table owner bypasses the policies; `openpims_app` does not.
 */
export async function withTenant<T>(
  db: Database,
  practiceId: string,
  fn: (tx: Database) => Promise<T>,
  options: TenantTransactionOptions = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    if (options.isolationLevel === "serializable") {
      await tx.execute(sql`set transaction isolation level serializable`);
    }
    await tx.execute(
      sql`select set_config('app.current_practice_id', ${practiceId}, true)`,
    );
    return fn(tx as unknown as Database);
  });
}

/**
 * Cross-tenant work has to opt in. Login and API-key lookup do not know the
 * practice until they have read a row, so they use this instead of withTenant.
 */
export async function withSystem<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.rls_bypass', 'on', true)`);
    return fn(tx as unknown as Database);
  });
}
