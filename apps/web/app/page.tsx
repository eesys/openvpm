import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@openpims/db/client";
import { practices } from "@openpims/db";
import { appRouter } from "@/server/routers/_app";
import { createTRPCContext } from "@/server/trpc";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const caller = appRouter.createCaller(await createTRPCContext());
  let me: Awaited<ReturnType<typeof caller.auth.me>> | null = null;
  try {
    me = await caller.auth.me();
  } catch (error) {
    if (!(error instanceof TRPCError) || error.code !== "UNAUTHORIZED") {
      throw error;
    }
  }

  if (!me?.practiceId) {
    return (
      <main>
        <h1>OpenVPM</h1>
        <p>Sign in to open your clinic.</p>
        <a href="/login">Sign in</a>
      </main>
    );
  }

  const [clinic] = await db
    .select({
      id: practices.id,
      name: practices.name,
      email: practices.email,
      phone: practices.phone,
      timezone: practices.timezone,
    })
    .from(practices)
    .where(and(eq(practices.id, me.practiceId), isNull(practices.deletedAt)));

  return (
    <main>
      <h1>OpenVPM</h1>
      <p>
        {me.name} — {me.role} — {me.email}
      </p>
      {clinic ? (
        <section>
          <h2>{clinic.name}</h2>
          <p>
            {[clinic.email, clinic.phone, clinic.timezone]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p>
            <a href="/clients">Clients</a>
            {" · "}
            <a href="/patients">Patients</a>
            {" · "}
            <a href="/schedule">Schedule</a>
          </p>
        </section>
      ) : (
        <p>This account&apos;s clinic could not be found.</p>
      )}
    </main>
  );
}
