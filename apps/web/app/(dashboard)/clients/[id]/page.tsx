import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";
import { appRouter } from "@/server/routers/_app";
import { createTRPCContext } from "@/server/trpc";
export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const caller = appRouter.createCaller(await createTRPCContext());
  let client: Awaited<ReturnType<typeof caller.clients.getById>>;
  try {
    client = await caller.clients.getById({ id });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "UNAUTHORIZED") {
      redirect("/login");
    }
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  return (
    <main>
      <p>
        <a href="/clients">Clients</a>
      </p>
      <h1>
        {client.firstName} {client.lastName}
      </h1>
      <p>
        {[client.email, client.phone].filter(Boolean).join(" · ") ||
          "No contact details"}
      </p>
      <p>
        <a href={`/clients/${client.id}/edit`}>Edit</a>
      </p>
      <h2>Patients</h2>
      <ul>
        {client.patients.map((patient) => (
          <li key={patient.id}>
            <a href={`/patients/${patient.id}`}>
              {patient.name}
            </a>
            {` · ${patient.species} · ${patient.status}`}
          </li>
        ))}
      </ul>
      <p>
        <a
          href={`/patients/new?clientId=${encodeURIComponent(client.id)}&clientName=${encodeURIComponent(`${client.firstName} ${client.lastName}`)}`}
        >
          Add patient
        </a>
      </p>
    </main>
  );
}
