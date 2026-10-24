"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

type Appointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  patientId: string | null;
  patientName: string | null;
  clientId: string | null;
  clientLastName: string | null;
  clientFirstName: string | null;
  doctorName: string | null;
};

type SoapNote = {
  id: string;
  appointmentId: string | null;
  status: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  authorName: string;
};

type Me = { role: string };

const nextStatus: Record<string, { label: string; status: "checked_in" | "in_exam" }> = {
  scheduled: { label: "报到", status: "checked_in" },
  confirmed: { label: "报到", status: "checked_in" },
  checked_in: { label: "开始看诊", status: "in_exam" },
};

function clock(value: string) {
  return new Date(value).toLocaleString();
}

export default function EncounterPage() {
  const params = useParams<{ appointmentId: string }>();
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [role, setRole] = useState("");
  const [note, setNote] = useState<SoapNote | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    const [current, me] = await Promise.all([
      trpc<Appointment>("appointments.getById", { id: params.appointmentId }),
      trpc<Me>("auth.me"),
    ]);
    setAppointment(current);
    setRole(me.role);
    if (!current.patientId) {
      setNote(null);
      return;
    }
    const notes = await trpc<SoapNote[]>("records.listSoapNotes", { patientId: current.patientId });
    setNote(notes.find((item) => item.appointmentId === current.id) ?? null);
  }

  useEffect(() => {
    if (!params.appointmentId) return;
    load().catch((error: Error) => setMessage(error.message));
  }, [params.appointmentId]);

  async function onAdvance() {
    if (!appointment) return;
    const next = nextStatus[appointment.status];
    if (!next) return;
    setMessage("");
    try {
      await trpc("appointments.updateStatus", { id: appointment.id, status: next.status }, "POST");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "状态没有改成");
    }
  }

  if (!appointment) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
        <p>{message || "正在读取就诊…"}</p>
      </main>
    );
  }

  const next = nextStatus[appointment.status];
  const canWriteSoap = role === "admin" || role === "veterinarian";

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <p>
        <a href="/schedule">日程</a>
      </p>
      <h1>{appointment.patientName ?? "未指定患者"}</h1>
      <p>
        {clock(appointment.startTime)} – {clock(appointment.endTime)}
      </p>
      <p>兽医：{appointment.doctorName ?? "未指定"}</p>
      <p>状态：{appointment.status}</p>
      {appointment.clientId ? (
        <p>
          客户：
          <a href={`/clients/${appointment.clientId}`}>
            {appointment.clientLastName}
            {appointment.clientFirstName}
          </a>
        </p>
      ) : null}
      {next ? <button type="button" onClick={onAdvance}>{next.label}</button> : null}
      {appointment.status === "in_exam" && appointment.patientId && canWriteSoap ? (
        <p>
          <a href={`/records/new-soap/${appointment.patientId}?appointmentId=${appointment.id}`}>
            {note?.status === "draft" ? "继续写 SOAP" : note ? "查看 SOAP" : "写 SOAP"}
          </a>
        </p>
      ) : null}
      {note ? (
        <section>
          <h2>SOAP（{note.status}）</h2>
          <p>主观：{note.subjective || "空"}</p>
          <p>客观：{note.objective || "空"}</p>
          <p>评估：{note.assessment || "空"}</p>
          <p>计划：{note.plan || "空"}</p>
          <p>作者：{note.authorName}</p>
        </section>
      ) : null}
      <p>{message}</p>
    </main>
  );
}
