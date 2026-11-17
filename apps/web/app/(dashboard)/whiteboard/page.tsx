"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";

const COLUMNS = [
  { key: "waiting", label: "Waiting", statuses: ["confirmed"] },
  {
    key: "in_progress",
    label: "In Progress",
    statuses: ["checked_in", "in_exam"],
  },
  { key: "completed", label: "Completed", statuses: ["checked_out"] },
] as const;

function canUpdateWhiteboardStatus(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "veterinarian" ||
    role === "technician" ||
    role === "front_desk"
  );
}

export default function WhiteboardPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  if (status === "loading") return <p>Loading whiteboard...</p>;
  if (status === "unauthenticated") {
    router.push("/login");
    return <p>Loading whiteboard...</p>;
  }
  return <Whiteboard role={session?.user?.role} />;
}

function Whiteboard({ role }: { role?: string | null }) {
  const utils = trpc.useUtils();
  const settings = trpc.whiteboard.settings.useQuery();
  const board = trpc.whiteboard.getActive.useQuery();
  const updateStatus = trpc.whiteboard.updateStatus.useMutation({
    onSuccess: async () => {
      await utils.whiteboard.getActive.invalidate();
    },
  });
  const canMove = canUpdateWhiteboardStatus(role);
  const timeZone = settings.data?.timezone ?? "America/New_York";

  return (
    <main>
      <p>
        <a href="/">Home</a>
      </p>
      <h1>Whiteboard</h1>
      {board.error ? <p>{board.error.message}</p> : null}
      {board.isLoading ? <p>Loading whiteboard...</p> : null}
      {COLUMNS.map((column) => {
        const visits = (board.data ?? []).filter((visit) =>
          (column.statuses as readonly string[]).includes(visit.status),
        );
        return (
          <section key={column.key}>
            <h2>
              {column.label} · {visits.length}
            </h2>
            {visits.length === 0 ? <p>None</p> : null}
            <ul>
              {visits.map((visit) => {
                const clientName = [visit.clientFirstName, visit.clientLastName]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={visit.id}>
                    {formatTime(visit.startTime, timeZone)}
                    {" · "}
                    {visit.patientName ?? "Unknown patient"}
                    {visit.patientSpecies ? ` · ${visit.patientSpecies}` : ""}
                    {clientName ? ` · ${clientName}` : ""}
                    {visit.doctorName ? ` · ${visit.doctorName}` : ""}
                    {visit.typeName ? ` · ${visit.typeName}` : ""}
                    {` · ${visit.status}`}
                    {canMove && visit.status === "confirmed" ? (
                      <button
                        type="button"
                        disabled={updateStatus.isPending}
                        onClick={() =>
                          updateStatus.mutate({
                            id: visit.id,
                            status: "checked_in",
                          })
                        }
                      >
                        Check In
                      </button>
                    ) : null}
                    {canMove && visit.status === "checked_in" ? (
                      <button
                        type="button"
                        disabled={updateStatus.isPending}
                        onClick={() =>
                          updateStatus.mutate({ id: visit.id, status: "in_exam" })
                        }
                      >
                        Start Exam
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {updateStatus.error ? <p>{updateStatus.error.message}</p> : null}
    </main>
  );
}

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
