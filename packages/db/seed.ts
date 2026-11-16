import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { appointmentTypes, practices, users } from "./schema/index";

config({ path: "../../.env" });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is missing. Copy .env.example to .env.");
}

const sql = postgres(url);
const db = drizzle(sql);

const clinicName = "Harbor Animal Clinic";
const staffEmail = "mina@harbor.example";
// bcrypt cost 12 for "password123", same cost main uses for staff passwords.
const passwordHash =
  "$2a$12$SfAqlcRMnLkebDqs9eBQm.jsQH9Z2zYd2gYAEeVXc4V1qypSKeiSK";

const [existingClinic] = await db
  .select()
  .from(practices)
  .where(and(eq(practices.name, clinicName), isNull(practices.deletedAt)));

const clinic =
  existingClinic ??
  (
    await db
      .insert(practices)
      .values({
        name: clinicName,
        phone: "555-0100",
        email: "front@harbor.example",
        timezone: "America/New_York",
      })
      .returning()
  )[0];

const [existingStaff] = await db
  .select()
  .from(users)
  .where(eq(users.email, staffEmail));

if (existingStaff && !existingStaff.passwordHash.startsWith("$2")) {
  await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, existingStaff.id));
  existingStaff.passwordHash = passwordHash;
}

const staff =
  existingStaff ??
  (
    await db
      .insert(users)
      .values({
        email: staffEmail,
        passwordHash,
        name: "Mina Chen",
        role: "veterinarian",
        isVeterinarian: true,
        practiceId: clinic.id,
      })
      .returning()
  )[0];

const visitTypes = [
  {
    name: "Wellness Exam",
    durationMinutes: 30,
    color: "#0d9488",
    requiresDoctor: 1,
    defaultRoomType: "exam" as const,
  },
  {
    name: "Sick Visit",
    durationMinutes: 30,
    color: "#dc2626",
    requiresDoctor: 1,
    defaultRoomType: "exam" as const,
  },
  {
    name: "Vaccination",
    durationMinutes: 15,
    color: "#2563eb",
    requiresDoctor: 1,
    defaultRoomType: "exam" as const,
  },
  {
    name: "Surgery",
    durationMinutes: 60,
    color: "#7c3aed",
    requiresDoctor: 1,
    defaultRoomType: "surgery" as const,
  },
  {
    name: "Dental",
    durationMinutes: 45,
    color: "#ea580c",
    requiresDoctor: 1,
    defaultRoomType: "exam" as const,
  },
  {
    name: "Follow-up",
    durationMinutes: 15,
    color: "#16a34a",
    requiresDoctor: 1,
    defaultRoomType: "exam" as const,
  },
];

const [existingType] = await db
  .select({ id: appointmentTypes.id })
  .from(appointmentTypes)
  .where(
    and(
      eq(appointmentTypes.practiceId, clinic.id),
      isNull(appointmentTypes.deletedAt),
    ),
  )
  .limit(1);

if (!existingType) {
  await db
    .insert(appointmentTypes)
    .values(visitTypes.map((type) => ({ ...type, practiceId: clinic.id })));
}

console.log(
  JSON.stringify(
    {
      practice: { id: clinic.id, name: clinic.name },
      staff: {
        id: staff.id,
        name: staff.name,
        role: staff.role,
        practiceId: staff.practiceId,
      },
    },
    null,
    2,
  ),
);

await sql.end();
