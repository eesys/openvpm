"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

type PatientDetail = {
  id: string;
  clientId: string;
  name: string;
  species: string;
  status: string;
  clientFirstName: string;
  clientLastName: string;
};

export default function PatientDetailPage() {
  const params = useParams<{ id: string }>();
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const result = await trpc<PatientDetail>("patients.getById", { id: params.id });
    setPatient(result);
    setName(result.name);
  }

  useEffect(() => {
    if (params.id) load().catch((error: Error) => setMessage(error.message));
  }, [params.id]);

  async function onRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await trpc("patients.update", { id: params.id, name }, "POST");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  }

  if (!patient) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
        <p>{message || "正在读取宠物…"}</p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <p>
        <a href={`/clients/${patient.clientId}`}>{`${patient.clientLastName}${patient.clientFirstName}`}</a>
      </p>
      <h1>{patient.name}</h1>
      <p>
        {patient.species}，{patient.status}
      </p>
      <form onSubmit={onRename} style={{ display: "flex", gap: "0.5rem" }}>
        <label>
          名字
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit">保存</button>
      </form>
      <p>{message}</p>
    </main>
  );
}
