import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";
import { appRouter } from "@/server/routers/_app";
import { createTRPCContext } from "@/server/trpc";
export const dynamic = "force-dynamic";

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const caller = appRouter.createCaller(await createTRPCContext());
  let patient: Awaited<ReturnType<typeof caller.patients.getById>>;
  try {
    patient = await caller.patients.getById({ id });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "UNAUTHORIZED") {
      redirect("/login");
    }
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const notes = await caller.records.listSoapNotes({ patientId: patient.id });

  return (
    <main>
      <p>
        <a href={`/clients/${patient.clientId}`}>Client</a>
        {" · "}
        <a href="/patients">Patients</a>
      </p>
      <h1>{patient.name}</h1>
      <p>
        {patient.species}
        {patient.breed ? ` · ${patient.breed}` : ""} · {patient.status}
      </p>
      <p>
        <a href={`/patients/${patient.id}/edit`}>Edit</a>
        {" · "}
        <a
          href={`/schedule?patient=${encodeURIComponent(patient.name)}`}
        >
          Schedule
        </a>
      </p>
      <h2>SOAP</h2>
      {notes.length === 0 ? <p>No SOAP notes.</p> : null}
      <ul>
        {notes.map((note) => (
          <li key={note.id}>
            {note.appointmentId ? (
              <a href={`/encounters/${note.appointmentId}`}>{note.status}</a>
            ) : (
              note.status
            )}
            {` · ${note.authorName}`}
            {note.subjective ? ` · Subjective: ${note.subjective}` : ""}
            {note.objective ? ` · Objective: ${note.objective}` : ""}
            {note.assessment ? ` · Assessment: ${note.assessment}` : ""}
            {note.plan ? ` · Plan: ${note.plan}` : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
