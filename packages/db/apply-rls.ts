import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

config({ path: "../../.env" });

function nonBlankEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const url = nonBlankEnv("DATABASE_URL");
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const sqlText = readFileSync(join(here, "rls", "enable-rls.sql"), "utf8");
const sql = postgres(url, { max: 1 });

try {
  const [exists] = await sql`select 1 from pg_roles where rolname = 'openpims_app'`;
  const appPassword = nonBlankEnv("OPENPIMS_APP_DB_PASSWORD");
  if (!exists) {
    if (!appPassword) {
      console.error(
        "openpims_app role does not exist. Set OPENPIMS_APP_DB_PASSWORD and re-run pnpm db:rls.",
      );
      process.exit(1);
    }
    const escaped = appPassword.replaceAll("'", "''");
    await sql.unsafe(`CREATE ROLE openpims_app LOGIN PASSWORD '${escaped}'`);
    console.log("created openpims_app role");
  } else if (appPassword) {
    const escaped = appPassword.replaceAll("'", "''");
    await sql.unsafe(`ALTER ROLE openpims_app PASSWORD '${escaped}'`);
    console.log("rotated openpims_app password");
  }

  await sql.unsafe(sqlText).simple();
  console.log("RLS policies applied");
} catch (error) {
  console.error("Failed to apply RLS policies:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
