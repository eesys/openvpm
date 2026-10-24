"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type Doctor = { id: string; name: string };
type Patient = { id: string; name: string; clientLastName: string; clientFirstName: string };
type Appointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  patientId: string | null;
  patientName: string | null;
  clientId: string | null;
  clientLastName: string | null;
  clientFirstName: string | null;
  doctorName: string | null;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function localInput(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function todayInput() {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function defaultStart() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date;
}

function toIso(localValue: string) {
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) throw new Error("时间无效");
  return date.toISOString();
}

function dayRange(day: string) {
  return {
    startDate: toIso(`${day}T00:00`),
    endDate: toIso(`${day}T23:59:59`),
  };
}

function clock(value: string) {
  return new Date(value).toLocaleString();
}

export default function SchedulePage() {
  const start = defaultStart();
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const [day, setDay] = useState(todayInput());
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [startTime, setStartTime] = useState(localInput(start));
  const [endTime, setEndTime] = useState(localInput(end));
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [reason, setReason] = useState("");

  async function load(nextDay = day) {
    const [doctorRows, patientRows, appointmentRows] = await Promise.all([
      trpc<Doctor[]>("appointments.listDoctors"),
      trpc<{ items: Patient[] }>("patients.list", { limit: 100 }),
      trpc<Appointment[]>("appointments.list", dayRange(nextDay)),
    ]);
    setDoctors(doctorRows);
    setPatients(patientRows.items);
    setAppointments(appointmentRows);
    setDoctorId((current) => current || doctorRows[0]?.id || "");
    setPatientId((current) => current || patientRows.items[0]?.id || "");
    setSelected((current) =>
      current ? appointmentRows.find((appointment) => appointment.id === current.id) ?? null : null,
    );
    setReady(true);
  }

  useEffect(() => {
    load().catch((error: Error) => setMessage(error.message));
  }, []);

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      const created = await trpc<{ id: string; startTime: string }>(
        "appointments.create",
        {
          patientId,
          doctorId,
          startTime: toIso(startTime),
          endTime: toIso(endTime),
          notes,
        },
        "POST",
      );
      const bookedDay = localInput(new Date(created.startTime)).slice(0, 10);
      setDay(bookedDay);
      setNotes("");
      await load(bookedDay);
      setMessage("已约上");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "预约失败");
    }
  }

  async function openAppointment(id: string) {
    setMessage("");
    setReason("");
    try {
      setSelected(await trpc<Appointment>("appointments.getById", { id }));
    } catch (error) {
      setSelected(null);
      setMessage(error instanceof Error ? error.message : "读取预约失败");
    }
  }

  async function onCancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setMessage("");
    try {
      await trpc("appointments.delete", { id: selected.id, reason }, "POST");
      setSelected(null);
      setReason("");
      await load();
      setMessage("预约已取消，这个时段可以再约。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取消失败");
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <p>
        <a href="/">首页</a>
        {" · "}
        <a href="/clients">客户</a>
      </p>
      <h1>日程</h1>
      <form onSubmit={onCreate} style={{ display: "grid", gap: "0.75rem", maxWidth: "28rem" }}>
        <label>
          患者
          <select value={patientId} onChange={(event) => setPatientId(event.target.value)} style={{ display: "block", width: "100%" }}>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.name}（{patient.clientLastName}
                {patient.clientFirstName}）
              </option>
            ))}
          </select>
        </label>
        <label>
          兽医
          <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} style={{ display: "block", width: "100%" }}>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          开始
          <input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          结束
          <input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          备注
          <input value={notes} onChange={(event) => setNotes(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" disabled={!patientId || !doctorId}>
          预约此时段
        </button>
      </form>
      {ready && !doctors.length ? <p>当前诊所还没有兽医，不能预约。</p> : null}
      <p>{message}</p>
      <h2>当天预约</h2>
      <label>
        日期
        <input
          type="date"
          value={day}
          onChange={(event) => {
            const nextDay = event.target.value;
            setDay(nextDay);
            load(nextDay).catch((error: Error) => setMessage(error.message));
          }}
        />
      </label>
      <ul>
        {appointments.map((appointment) => (
          <li key={appointment.id}>
            <button type="button" onClick={() => openAppointment(appointment.id)}>
              {clock(appointment.startTime)} – {clock(appointment.endTime)}
            </button>
            {` ${appointment.patientName ?? "未指定患者"}，${appointment.doctorName ?? "未指定医生"}，${appointment.status}`}
            {appointment.clientLastName
              ? `（${appointment.clientLastName}${appointment.clientFirstName ?? ""}）`
              : ""}
          </li>
        ))}
      </ul>
      {selected ? (
        <section>
          <h2>{selected.patientName ?? "未指定患者"}</h2>
          <p>
            {clock(selected.startTime)} – {clock(selected.endTime)}
          </p>
          <p>兽医：{selected.doctorName ?? "未指定"}</p>
          <p>状态：{selected.status}</p>
          {selected.clientId ? (
            <p>
              客户：
              <a href={`/clients/${selected.clientId}`}>
                {selected.clientLastName}
                {selected.clientFirstName}
              </a>
            </p>
          ) : null}
          {selected.patientId ? (
            <p>
              <a href={`/patients/${selected.patientId}`}>宠物档案</a>
            </p>
          ) : null}
          <p>
            <a href={`/encounters/${selected.id}`}>打开就诊</a>
          </p>
          <p>{selected.notes || "没有备注"}</p>
          {["scheduled", "confirmed", "cancelled", "no_show"].includes(selected.status) ? (
          <form onSubmit={onCancel} style={{ display: "grid", gap: "0.75rem", maxWidth: "24rem" }}>
            <label>
              取消原因
              <input value={reason} onChange={(event) => setReason(event.target.value)} style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit">取消预约</button>
          </form>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
