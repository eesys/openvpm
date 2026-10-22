import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { resolve } from "node:path";

config({ path: resolve(import.meta.dirname, "../../.env") });

const { db, sql } = await import("./client");
const { memberships, practices, users } = await import("./schema/index");

const demoEmail = "frontdesk@demo.clinic";

const existingUser = await db.query.users.findFirst({
  where: eq(users.email, demoEmail),
});

if (existingUser) {
  const existingMembership = await db.query.memberships.findFirst({
    where: eq(memberships.userId, existingUser.id),
  });
  if (existingMembership) {
    await db.delete(memberships).where(eq(memberships.id, existingMembership.id));
    await db
      .delete(practices)
      .where(eq(practices.id, existingMembership.practiceId));
  }
  await db.delete(users).where(eq(users.id, existingUser.id));
}

const [practice] = await db
  .insert(practices)
  .values({ name: "示范诊所", phone: "555-0100" })
  .returning();
const [user] = await db
  .insert(users)
  .values({
    email: demoEmail,
    passwordHash: "not-a-login-hash",
    name: "前台",
  })
  .returning();
const [membership] = await db
  .insert(memberships)
  .values({ practiceId: practice.id, userId: user.id })
  .returning();

const found = await db.query.memberships.findFirst({
  where: eq(memberships.id, membership.id),
  with: { practice: true, user: true },
});

if (
  !found?.practice ||
  !found.user ||
  found.practiceId !== practice.id ||
  found.practice.timezone !== "America/New_York" ||
  found.role !== "front_desk" ||
  found.isVeterinarian !== false ||
  found.user.email !== demoEmail
) {
  throw new Error("clinic membership was not stored as expected");
}

let rejectedMissingPractice = false;
try {
  await sql.begin(async (tx) => {
    await tx`insert into memberships (user_id) values (${user.id})`;
  });
} catch (error) {
  rejectedMissingPractice = isNotNullViolation(error);
  if (!rejectedMissingPractice) throw error;
}

if (!rejectedMissingPractice) {
  throw new Error("membership without practiceId was stored");
}

console.log(
  `诊所「${found.practice.name}」的员工 ${found.user.name} 以 ${found.role} 加入，practiceId=${found.practiceId}`,
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
