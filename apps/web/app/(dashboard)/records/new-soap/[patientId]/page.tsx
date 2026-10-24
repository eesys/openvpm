"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

type SoapNote = {
  id: string;
  appointmentId: string | null;
  status: string;
  revision: number;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  authorName: string;
  finalizerName: string | null;
};

type SaveResult =
  | { outcome: "saved"; draft: SoapNote }
  | { outcome: "conflict"; draft: SoapNote }
  | { outcome: "already_finalized"; note: SoapNote };

type FinalizeResult =
  | { outcome: "finalized"; note: SoapNote; transitioned: boolean }
  | { outcome: "conflict"; note: SoapNote };

export default function NewSoapPage() {
  const params = useParams<{ patientId: string }>();
  const searchParams = useSearchParams();
  const appointmentId = searchParams.get("appointmentId") ?? "";
  const [note, setNote] = useState<SoapNote | null>(null);
  const [subjective, setSubjective] = useState("");
  const [objective, setObjective] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);

  function show(next: SoapNote) {
    setNote(next);
    setSubjective(next.subjective ?? "");
    setObjective(next.objective ?? "");
    setAssessment(next.assessment ?? "");
    setPlan(next.plan ?? "");
  }

  useEffect(() => {
    if (!params.patientId || !appointmentId) return;
    Promise.all([
      trpc<SoapNote | null>("records.getSoapDraft", {
        patientId: params.patientId,
        appointmentId,
      }),
      trpc<SoapNote[]>("records.listSoapNotes", { patientId: params.patientId }),
    ])
      .then(([draft, notes]) => {
        const finalized = notes.find(
          (item) => item.appointmentId === appointmentId && item.status === "finalized",
        );
        const current = draft ?? finalized ?? null;
        if (current) show(current);
        setReady(true);
      })
      .catch((error: Error) => setMessage(error.message));
  }, [params.patientId, appointmentId]);

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      const result = await trpc<SaveResult>(
        "records.saveSoapDraft",
        {
          patientId: params.patientId,
          appointmentId,
          noteId: note?.status === "draft" ? note.id : undefined,
          expectedRevision: note?.status === "draft" ? note.revision : 0,
          subjective,
          objective,
          assessment,
          plan,
        },
        "POST",
      );
      if (result.outcome === "saved") {
        show(result.draft);
        setMessage("草稿已保存");
        return;
      }
      if (result.outcome === "already_finalized") {
        show(result.note);
        setMessage("这次就诊已经有定稿的 SOAP。");
        return;
      }
      show(result.draft);
      setMessage("SOAP draft changed while saving.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function onFinalize() {
    if (!note || note.status !== "draft") return;
    setMessage("");
    try {
      const result = await trpc<FinalizeResult>(
        "records.finalizeSoapNote",
        {
          patientId: params.patientId,
          appointmentId,
          noteId: note.id,
          expectedRevision: note.revision,
        },
        "POST",
      );
      if (result.outcome === "conflict") {
        show(result.note);
        setMessage("SOAP draft changed while saving.");
        return;
      }
      show(result.note);
      setMessage("SOAP 已定稿");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "定稿失败");
    }
  }

  const finalized = note?.status === "finalized";

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <p>
        <a href={appointmentId ? `/encounters/${appointmentId}` : "/schedule"}>返回就诊</a>
      </p>
      <h1>SOAP</h1>
      {!appointmentId ? <p>缺少预约。</p> : null}
      {note ? (
        <p>
          {note.status}，第 {note.revision} 次，{note.authorName}
          {note.finalizerName ? `，定稿 ${note.finalizerName}` : ""}
        </p>
      ) : null}
      <form onSubmit={onSave} style={{ display: "grid", gap: "0.75rem", maxWidth: "36rem" }}>
        <label>
          主观
          <textarea value={subjective} onChange={(event) => setSubjective(event.target.value)} disabled={finalized} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          客观
          <textarea value={objective} onChange={(event) => setObjective(event.target.value)} disabled={finalized} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          评估
          <textarea value={assessment} onChange={(event) => setAssessment(event.target.value)} disabled={finalized} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          计划
          <textarea value={plan} onChange={(event) => setPlan(event.target.value)} disabled={finalized} style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" disabled={!ready || finalized || !appointmentId}>
          保存草稿
        </button>
        <button type="button" onClick={onFinalize} disabled={!note || note.status !== "draft"}>
          定稿
        </button>
      </form>
      <p>{message}</p>
    </main>
  );
}
