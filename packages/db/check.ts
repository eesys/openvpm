import { config } from "dotenv";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { resolve } from "node:path";

const { hash } = createRequire(import.meta.url)("bcryptjs") as {
  hash: (password: string, rounds: number) => Promise<string>;
};

config({ path: resolve(import.meta.dirname, "../../.env") });

const { db, sql } = await import("./client");
const { practices, users } = await import("./schema/index");

const demoEmail = "frontdesk@demo.clinic";

const existingUser = await db.query.users.findFirst({
  where: eq(users.email, demoEmail),
});

if (existingUser) {
  await db.delete(users).where(eq(users.id, existingUser.id));
  await db.delete(practices).where(eq(practices.id, existingUser.practiceId));
}

const [practice] = await db
  .insert(practices)
  .values({ name: "示范诊所", phone: "555-0100" })
  .returning();
const [user] = await db
  .insert(users)
  .values({
    email: demoEmail,
    passwordHash: await hash("password", 12),
    name: "前台",
    practiceId: practice.id,
  })
  .returning();

const found = await db.query.users.findFirst({
  where: eq(users.id, user.id),
  with: { practice: true },
});

if (
  !found?.practice ||
  found.practiceId !== practice.id ||
  found.practice.timezone !== "America/New_York" ||
  found.role !== "front_desk" ||
  found.isVeterinarian !== false ||
  found.email !== demoEmail
) {
  throw new Error("staff member was not stored on the practice");
}

let rejectedMissingPractice = false;
try {
  await sql.begin(async (tx) => {
    await tx`insert into users (email, password_hash, name) values (${"missing-practice@demo.clinic"}, ${"not-a-login-hash"}, ${"无诊所"})`;
  });
} catch (error) {
  rejectedMissingPractice = isNotNullViolation(error);
  if (!rejectedMissingPractice) throw error;
}

if (!rejectedMissingPractice) {
  throw new Error("user without practiceId was stored");
}

console.log(
  `诊所「${found.practice.name}」的员工 ${found.name} 以 ${found.role} 属于该诊所，practiceId=${found.practiceId}`,
);

await sql.end();

function isNotNullViolation(error: unknown): boolean {
  const candidates = [error, causeOf(error)];
  return candidates.some(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "code" in candidate &&
      candidate.code === "23502",
  );
}

function causeOf(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "cause" in error) {
    return error.cause;
  }
  return undefined;
}
