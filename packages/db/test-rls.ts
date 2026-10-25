import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

config({ path: "../../.env" });

function nonBlankEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function appRoleUrl(ownerUrl: string, password: string): string {
  const url = new URL(ownerUrl);
  url.username = "openpims_app";
  url.password = password;
  return url.toString();
}

function isRlsViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42501"
  );
}

const ownerUrl = nonBlankEnv("DATABASE_URL");
const appPassword = nonBlankEnv("OPENPIMS_APP_DB_PASSWORD");
if (!ownerUrl || !appPassword) {
  console.error("DATABASE_URL and OPENPIMS_APP_DB_PASSWORD are required");
  process.exit(1);
}

const owner = postgres(ownerUrl, { max: 1 });
const app = postgres(appRoleUrl(ownerUrl, appPassword), { max: 1 });
const practiceA = randomUUID();
const practiceB = randomUUID();
const clientA = randomUUID();
const clientB = randomUUID();

try {
  await owner`
    insert into practices (id, name) values
      (${practiceA}, ${"诊所 A"}),
      (${practiceB}, ${"诊所 B"})
  `;
  await owner`
    insert into clients (id, practice_id, first_name, last_name) values
      (${clientA}, ${practiceA}, ${"甲"}, ${"客户"}),
      (${clientB}, ${practiceB}, ${"乙"}, ${"客户"})
  `;

  const ownRows = await app.begin(async (tx) => {
    await tx`select set_config('app.current_practice_id', ${practiceA}, true)`;
    return tx<{ id: string }[]>`
      select id from clients where id in (${clientA}, ${clientB})
    `;
  });
  if (ownRows.length !== 1 || ownRows[0]?.id !== clientA) {
    throw new Error("tenant context saw another practice's client");
  }

  let writeBlocked = false;
  try {
    await app.begin(async (tx) => {
      await tx`select set_config('app.current_practice_id', ${practiceA}, true)`;
      await tx`
        insert into clients (practice_id, first_name, last_name)
        values (${practiceB}, ${"越界"}, ${"客户"})
      `;
    });
  } catch (error) {
    writeBlocked = isRlsViolation(error);
    if (!writeBlocked) throw error;
  }
  if (!writeBlocked) {
    throw new Error("cross-tenant client insert was stored");
  }

  const [{ count: unscoped }] = await app<{ count: number }[]>`
    select count(*)::int as count from clients
  `;
  if (unscoped !== 0) {
    throw new Error("a query with no tenant context returned clients");
  }

  const bypassRows = await app.begin(async (tx) => {
    await tx`select set_config('app.rls_bypass', 'on', true)`;
    return tx<{ id: string }[]>`
      select id from clients where id in (${clientA}, ${clientB}) order by first_name
    `;
  });
  if (bypassRows.length !== 2) {
    throw new Error("system bypass did not see both practices");
  }

  const ownerRows = await owner<{ id: string }[]>`
    select id from clients where id in (${clientA}, ${clientB})
  `;
  if (ownerRows.length !== 2) {
    throw new Error("owner connection was filtered by RLS");
  }

  console.log("openpims_app 只看见当前诊所的客户；无上下文看不见；所有者连接不受策略影响");
} finally {
  await owner`delete from clients where id in (${clientA}, ${clientB})`;
  await owner`delete from practices where id in (${practiceA}, ${practiceB})`;
  await app.end();
  await owner.end();
}
