import { TRPCError } from "@trpc/server";
import { redirect } from "next/navigation";
import { appRouter } from "@/server/routers/_app";
import { createTRPCContext } from "@/server/trpc";

export const dynamic = "force-dynamic";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = q?.trim() || undefined;
  const caller = appRouter.createCaller(await createTRPCContext());
  let list: Awaited<ReturnType<typeof caller.patients.list>>;
  try {
    list = await caller.patients.list({ search, limit: 25, offset: 0 });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "UNAUTHORIZED") {
      redirect("/login");
    }
    throw error;
  }

  return (
    <main>
      <p>
        <a href="/">Home</a>
      </p>
      <h1>Patients</h1>
      <p>
        <a href="/patients/new">New patient</a>
      </p>
      <form action="/patients">
        <label>
          Search <input name="q" defaultValue={search ?? ""} />
        </label>
        <button type="submit">Search</button>
      </form>
      <p>
        {list.total === 1 ? "1 patient" : `${list.total} patients`}
      </p>
      <ul>
        {list.items.map((patient) => (
          <li key={patient.id}>
            <a href={`/patients/${patient.id}`}>{patient.name}</a>
            {` · ${patient.species}`}
            {patient.clientFirstName
              ? ` · ${patient.clientFirstName} ${patient.clientLastName ?? ""}`
              : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
