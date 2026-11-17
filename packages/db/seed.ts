import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { appointmentTypes, practices, services, users } from "./schema/index";

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

const serviceCatalog = [
  { name: "Wellness Examination", code: "EXAM-WE", category: "Exam", defaultPrice: "65.00" },
  { name: "Sick Visit Examination", code: "EXAM-SV", category: "Exam", defaultPrice: "75.00" },
  { name: "Surgery Consultation", code: "EXAM-SC", category: "Exam", defaultPrice: "85.00" },
  { name: "Dental Prophylaxis", code: "DENT-01", category: "Dental", defaultPrice: "350.00" },
  { name: "Tooth Extraction (simple)", code: "DENT-02", category: "Dental", defaultPrice: "150.00" },
  { name: "Spay (under 50 lbs)", code: "SURG-01", category: "Surgery", defaultPrice: "400.00" },
  { name: "Neuter (under 50 lbs)", code: "SURG-02", category: "Surgery", defaultPrice: "300.00" },
  { name: "Mass Removal", code: "SURG-03", category: "Surgery", defaultPrice: "500.00" },
  { name: "Radiograph (2 views)", code: "DIAG-01", category: "Diagnostic", defaultPrice: "185.00" },
  { name: "CBC/Chemistry Panel", code: "LAB-01", category: "Lab", defaultPrice: "145.00" },
  { name: "Urinalysis", code: "LAB-02", category: "Lab", defaultPrice: "55.00" },
  { name: "Fecal Float", code: "LAB-03", category: "Lab", defaultPrice: "35.00" },
  { name: "DHPP Vaccine", code: "VAX-01", category: "Vaccine", defaultPrice: "28.00" },
  { name: "Rabies Vaccine", code: "VAX-02", category: "Vaccine", defaultPrice: "22.00" },
  { name: "Bordetella Vaccine", code: "VAX-03", category: "Vaccine", defaultPrice: "25.00" },
  { name: "FVRCP Vaccine", code: "VAX-04", category: "Vaccine", defaultPrice: "28.00" },
  { name: "FeLV Vaccine", code: "VAX-05", category: "Vaccine", defaultPrice: "30.00" },
  { name: "Nail Trim", code: "GROO-01", category: "Grooming", defaultPrice: "18.00" },
  { name: "Anal Gland Expression", code: "GROO-02", category: "Grooming", defaultPrice: "25.00" },
  { name: "Microchip Implantation", code: "MISC-01", category: "Misc", defaultPrice: "55.00" },
];

const [existingService] = await db
  .select({ id: services.id })
  .from(services)
  .where(and(eq(services.practiceId, clinic.id), isNull(services.deletedAt)))
  .limit(1);

if (!existingService) {
  await db.insert(services).values(
    serviceCatalog.map((service) => ({
      ...service,
      practiceId: clinic.id,
      taxable: true,
    })),
  );
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
