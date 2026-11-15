import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema/index";
import { isPooledDatabaseConnection } from "./connection-policy";

type DbClient = ReturnType<typeof drizzle<typeof schema>>;
type PostgresOptions = NonNullable<Parameters<typeof postgres>[1]>;
type CachedDb = {
  url: string;
  client: Sql;
  db: DbClient;
};

declare global {
  // Next dev reloads this module. Keep one pool on the global so old pools
  // do not stay open until Postgres runs out of connections.
  var __openpimsDb: CachedDb | undefined;
}

let _db: DbClient | null = null;

function getConnectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return url;
}

function databasePoolMax(): number | undefined {
  const raw = process.env.DATABASE_POOL_MAX?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("DATABASE_POOL_MAX must be a positive integer");
  }
  return value;
}

function createDb(url: string): CachedDb {
  const options: PostgresOptions = isPooledDatabaseConnection(url)
    ? { prepare: false }
    : {};
  const max = databasePoolMax();
  if (max) {
    options.max = max;
  }

  const client = postgres(url, options);
  return {
    url,
    client,
    db: drizzle(client, { schema }),
  };
}

function getDb(): DbClient {
  const url = getConnectionString();

  if (process.env.NODE_ENV !== "production") {
    const cached = globalThis.__openpimsDb;
    if (cached?.url === url) {
      return cached.db;
    }

    const next = createDb(url);
    globalThis.__openpimsDb = next;
    return next.db;
  }

  if (!_db) {
    _db = createDb(url).db;
  }
  return _db;
}

export const db = new Proxy({} as DbClient, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});

export type Database = DbClient;
