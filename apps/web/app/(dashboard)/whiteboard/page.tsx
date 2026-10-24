"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type Visit = {
  id: string;
  status: string;
  startTime: string;
  patientName: string | null;
  patientSpecies: string | null;
  clientLastName: string | null;
  clientFirstName: string | null;
  doctorName: string | null;
};

const columns = [
  { key: "waiting", label: "等候", statuses: ["confirmed"] },
  { key: "in_progress", label: "看诊中", statuses: ["checked_in", "in_exam"] },
  { key: "completed", label: "已结束", statuses: ["checked_out"] },
] as const;

const nextMove: Record<string, { label: string; status: "checked_in" | "in_exam" }> = {
  confirmed: { label: "报到", status: "checked_in" },
  checked_in: { label: "开始看诊", status: "in_exam" },
};

function clock(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function WhiteboardPage() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    setVisits(await trpc<Visit[]>("whiteboard.getActive"));
  }

  useEffect(() => {
    load().catch((error: Error) => setMessage(error.message));
  }, []);

  async function onMove(id: string, status: "checked_in" | "in_exam") {
    setMessage("");
    try {
      await trpc("whiteboard.updateStatus", { id, status }, "POST");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "状态没有改成");
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <p>
        <a href="/">首页</a>
        {" · "}
        <a href="/schedule">日程</a>
      </p>
      <h1>白板</h1>
      <p>按诊所时区显示今天已进入就诊流程的预约。</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(12rem, 1fr))", gap: "1rem" }}>
        {columns.map((column) => {
          const items = visits.filter((visit) => (column.statuses as readonly string[]).includes(visit.status));
          return (
            <section key={column.key}>
              <h2>
                {column.label}（{items.length}）
              </h2>
              {items.length === 0 ? <p>没有就诊</p> : null}
              {items.map((visit) => {
                const move = nextMove[visit.status];
                return (
                  <article key={visit.id} style={{ border: "1px solid #ccc", padding: "0.75rem", marginBottom: "0.75rem" }}>
                    <p>{clock(visit.startTime)}</p>
                    <p>
                      <a href={`/encounters/${visit.id}`}>{visit.patientName ?? "未指定患者"}</a>
                      {visit.patientSpecies ? ` ${visit.patientSpecies}` : ""}
                    </p>
                    <p>
                      {visit.clientLastName}
                      {visit.clientFirstName}，{visit.doctorName ?? "未指定医生"}
                    </p>
                    <p>{visit.status}</p>
                    {move ? (
                      <button type="button" onClick={() => onMove(visit.id, move.status)}>
                        {move.label}
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
      <p>{message}</p>
    </main>
  );
}
