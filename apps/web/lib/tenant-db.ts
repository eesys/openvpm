import { sql } from "drizzle-orm";
import type { db as database } from "@openpims/db/client";

type Database = typeof database;

export async function withTenant<T>(
  db: Database,
  practiceId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_practice_id', ${practiceId}, true)`);
    return fn(tx as unknown as Database);
  });
}

export async function withSystem<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.rls_bypass', 'on', true)`);
    return fn(tx as unknown as Database);
  });
}
