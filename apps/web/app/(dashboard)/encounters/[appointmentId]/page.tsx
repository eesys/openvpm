"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { hasSoapContent } from "@/lib/records/soap-content";

function canManageVisit(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "veterinarian" ||
    role === "technician" ||
    role === "front_desk"
  );
}

function canCreateSoap(role?: string | null): boolean {
  return role === "admin" || role === "veterinarian";
}

function nextVisitAction(status: string): {
  label: string;
  status: "checked_in" | "in_exam";
} | null {
  if (status === "scheduled" || status === "confirmed") {
    return { label: "Check in", status: "checked_in" };
  }
  if (status === "checked_in") {
    return { label: "Start exam", status: "in_exam" };
  }
  return null;
}

export default function EncounterPage() {
  const router = useRouter();
  const params = useParams<{ appointmentId: string }>();
  const { data: session, status } = useSession();

  if (status === "loading") return <p>Loading visit...</p>;
  if (status === "unauthenticated") {
    router.push("/login");
    return <p>Loading visit...</p>;
  }

  return (
    <EncounterVisit
      appointmentId={params.appointmentId}
      role={session?.user?.role}
    />
  );
}

function EncounterVisit({
  appointmentId,
  role,
}: {
  appointmentId: string;
  role?: string | null;
}) {
  const utils = trpc.useUtils();
  const settings = trpc.appointments.calendarSettings.useQuery();
  const timeZone = settings.data?.timezone ?? "America/New_York";
  const appointment = trpc.appointments.getById.useQuery({ id: appointmentId });
  const updateStatus = trpc.appointments.updateStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.appointments.getById.invalidate({ id: appointmentId }),
        utils.appointments.list.invalidate(),
      ]);
    },
  });

  if (appointment.isLoading) return <p>Loading visit...</p>;
  if (appointment.error) {
    return (
      <main>
        <p>
          <a href="/schedule">Schedule</a>
        </p>
        <p>{appointment.error.message}</p>
      </main>
    );
  }

  const visit = appointment.data;
  if (!visit) return <p>Loading visit...</p>;
  const action = canManageVisit(role) ? nextVisitAction(visit.status) : null;
  const clientName = [visit.clientFirstName, visit.clientLastName]
    .filter(Boolean)
    .join(" ");

  return (
    <main>
      <p>
        <a href="/schedule">Schedule</a>
        {visit.patientId ? (
          <>
            {" · "}
            <a href={`/patients/${visit.patientId}`}>{visit.patientName}</a>
          </>
        ) : null}
      </p>
      <h1>{visit.patientName ?? "Visit"}</h1>
      <p>
        {formatTime(visit.startTime, timeZone)}–
        {formatTime(visit.endTime, timeZone)}
        {visit.doctorName ? ` · ${visit.doctorName}` : ""}
        {visit.typeName ? ` · ${visit.typeName}` : ""}
        {` · ${visit.status}`}
      </p>
      {clientName ? <p>{clientName}</p> : null}
      {visit.notes ? <p>{visit.notes}</p> : null}
      {action ? (
        <p>
          <button
            type="button"
            disabled={updateStatus.isPending}
            onClick={() =>
              updateStatus.mutate({ id: visit.id, status: action.status })
            }
          >
            {action.label}
          </button>
        </p>
      ) : null}
      {updateStatus.error ? <p>{updateStatus.error.message}</p> : null}
      {visit.patientId ? (
        <SoapNote
          appointmentId={visit.id}
          patientId={visit.patientId}
          visitOpen={visit.status === "in_exam"}
          canWrite={canCreateSoap(role)}
        />
      ) : (
        <p>Attach a patient before writing a SOAP note.</p>
      )}
    </main>
  );
}

function SoapNote({
  appointmentId,
  patientId,
  visitOpen,
  canWrite,
}: {
  appointmentId: string;
  patientId: string;
  visitOpen: boolean;
  canWrite: boolean;
}) {
  const utils = trpc.useUtils();
  const notes = trpc.records.listSoapNotes.useQuery({ patientId });
  const draftQuery = trpc.records.getSoapDraft.useQuery(
    { patientId, appointmentId },
    { enabled: canWrite && visitOpen },
  );
  const saveDraft = trpc.records.saveSoapDraft.useMutation();
  const finalize = trpc.records.finalizeSoapNote.useMutation();
  const discard = trpc.records.discardSoapDraft.useMutation();
  const [subjective, setSubjective] = useState("");
  const [objective, setObjective] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!draftQuery.isSuccess || ready) return;
    const draft = draftQuery.data;
    if (draft) {
      setSubjective(draft.subjective ?? "");
      setObjective(draft.objective ?? "");
      setAssessment(draft.assessment ?? "");
      setPlan(draft.plan ?? "");
      setNoteId(draft.id);
      setRevision(draft.revision);
    }
    setReady(true);
  }, [draftQuery.isSuccess, draftQuery.data, ready]);

  const visitNotes = (notes.data ?? []).filter(
    (note) => note.appointmentId === appointmentId,
  );
  const finalizedNote = visitNotes.find((note) => note.status === "finalized");
  const canSave = hasSoapContent({ subjective, objective, assessment, plan });
  const busy = saveDraft.isPending || finalize.isPending || discard.isPending;

  async function refreshNotes() {
    await Promise.all([
      utils.records.listSoapNotes.invalidate({ patientId }),
      utils.records.getSoapDraft.invalidate({ patientId, appointmentId }),
    ]);
  }

  async function onSave() {
    setMessage(null);
    const result = await saveDraft.mutateAsync({
      patientId,
      appointmentId,
      noteId: noteId ?? undefined,
      expectedRevision: noteId ? revision : 0,
      subjective,
      objective,
      assessment,
      plan,
    });
    if (result.outcome === "saved") {
      setNoteId(result.draft.id);
      setRevision(result.draft.revision);
      setMessage("Draft saved.");
      await refreshNotes();
      return;
    }
    if (result.outcome === "already_finalized") {
      setMessage("This visit already has a finalized SOAP note.");
      await refreshNotes();
      return;
    }
    setMessage("This SOAP draft changed. Refresh and try again.");
  }

  async function onFinalize() {
    if (!noteId) return;
    setMessage(null);
    const result = await finalize.mutateAsync({
      patientId,
      appointmentId,
      noteId,
      expectedRevision: revision,
    });
    if (result.outcome === "finalized") {
      setMessage("SOAP note finalized.");
      await refreshNotes();
      return;
    }
    setMessage("This SOAP draft changed. Refresh and try again.");
  }

  async function onDiscard() {
    if (!noteId) return;
    setMessage(null);
    const result = await discard.mutateAsync({
      patientId,
      appointmentId,
      noteId,
      expectedRevision: revision,
    });
    if (result.outcome === "discarded") {
      setSubjective("");
      setObjective("");
      setAssessment("");
      setPlan("");
      setNoteId(null);
      setRevision(0);
      setMessage("Draft discarded.");
      await refreshNotes();
      return;
    }
    if (result.outcome === "already_finalized") {
      setMessage("This visit already has a finalized SOAP note.");
      await refreshNotes();
      return;
    }
    setMessage("This SOAP draft changed. Refresh and try again.");
  }

  return (
    <section>
      <h2>SOAP</h2>
      {notes.error ? <p>{notes.error.message}</p> : null}
      {finalizedNote ? <SoapSections note={finalizedNote} /> : null}
      {visitOpen && canWrite && !finalizedNote ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSave().catch((error: Error) => setMessage(error.message));
          }}
        >
          <label>
            Subjective
            <textarea
              value={subjective}
              onChange={(event) => setSubjective(event.target.value)}
            />
          </label>
          <label>
            Objective
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
            />
          </label>
          <label>
            Assessment
            <textarea
              value={assessment}
              onChange={(event) => setAssessment(event.target.value)}
            />
          </label>
          <label>
            Plan
            <textarea
              value={plan}
              onChange={(event) => setPlan(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !ready}>
            Save draft
          </button>
          <button
            type="button"
            disabled={busy || !noteId || !canSave}
            onClick={() => {
              void onFinalize().catch((error: Error) =>
                setMessage(error.message),
              );
            }}
          >
            Finalize SOAP
          </button>
          {noteId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void onDiscard().catch((error: Error) =>
                  setMessage(error.message),
                );
              }}
            >
              Discard draft
            </button>
          ) : null}
        </form>
      ) : null}
      {visitOpen && !canWrite && !finalizedNote ? (
        <p>A veterinarian writes the SOAP note for this visit.</p>
      ) : null}
      {!visitOpen && !finalizedNote ? (
        <p>Start the exam before writing a SOAP note.</p>
      ) : null}
      {message ? <p>{message}</p> : null}
      {saveDraft.error ? <p>{saveDraft.error.message}</p> : null}
      {finalize.error ? <p>{finalize.error.message}</p> : null}
      {discard.error ? <p>{discard.error.message}</p> : null}
    </section>
  );
}

function SoapSections({
  note,
}: {
  note: {
    status: string;
    authorName: string;
    finalizerName: string | null;
    subjective: string | null;
    objective: string | null;
    assessment: string | null;
    plan: string | null;
  };
}) {
  return (
    <article>
      <p>
        {note.status}
        {` · ${note.authorName}`}
        {note.finalizerName ? ` · finalized by ${note.finalizerName}` : ""}
      </p>
      {note.subjective ? <p>Subjective: {note.subjective}</p> : null}
      {note.objective ? <p>Objective: {note.objective}</p> : null}
      {note.assessment ? <p>Assessment: {note.assessment}</p> : null}
      {note.plan ? <p>Plan: {note.plan}</p> : null}
    </article>
  );
}

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
