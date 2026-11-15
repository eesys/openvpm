import { isNull } from "drizzle-orm";
import { db } from "@openpims/db/client";
import { practices, users } from "@openpims/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const clinics = await db
    .select({
      id: practices.id,
      name: practices.name,
      email: practices.email,
      phone: practices.phone,
      timezone: practices.timezone,
    })
    .from(practices)
    .where(isNull(practices.deletedAt));

  const staff = await db
    .select({
      id: users.id,
      practiceId: users.practiceId,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(isNull(users.deletedAt));

  return (
    <main>
      <h1>OpenVPM</h1>
      {clinics.length === 0 ? (
        <p>No clinic has been recorded yet.</p>
      ) : (
        clinics.map((clinic) => (
          <section key={clinic.id}>
            <h2>{clinic.name}</h2>
            <p>
              {[clinic.email, clinic.phone, clinic.timezone]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <h3>Staff</h3>
            <ul>
              {staff
                .filter((person) => person.practiceId === clinic.id)
                .map((person) => (
                  <li key={person.id}>
                    {person.name} — {person.role} — {person.email}
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
