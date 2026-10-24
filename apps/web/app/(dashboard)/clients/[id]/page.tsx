"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";

const speciesValues = [
  "canine",
  "feline",
  "avian",
  "rabbit",
  "reptile",
  "equine",
  "bovine",
  "ovine",
  "caprine",
  "porcine",
  "poultry",
  "camelid",
  "other",
] as const;

type Patient = { id: string; name: string; species: string; status: string };
type ClientDetail = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  patients: Patient[];
};

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [message, setMessage] = useState("");
  const [firstName, setFirstName] = useState("");
  const [petName, setPetName] = useState("");
  const [species, setSpecies] = useState<(typeof speciesValues)[number]>("canine");

  async function load() {
    const result = await trpc<ClientDetail>("clients.getById", { id: params.id });
    setClient(result);
    setFirstName(result.firstName);
  }

  useEffect(() => {
    if (params.id) load().catch((error: Error) => setMessage(error.message));
  }, [params.id]);

  async function onRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await trpc("clients.update", { id: params.id, firstName }, "POST");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function onAddPet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("petName") ?? "").trim();
    const chosenSpecies = String(form.get("species") ?? "canine") as (typeof speciesValues)[number];
    setMessage("");
    try {
      await trpc("patients.create", { clientId: params.id, name, species: chosenSpecies }, "POST");
      setPetName("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加宠物失败");
    }
  }

  if (!client) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
        <p>{message || "正在读取客户…"}</p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <p>
        <a href="/clients">客户列表</a>
      </p>
      <h1>{`${client.lastName}${client.firstName}`}</h1>
      <p>{client.phone ?? "没有电话"}</p>
      <form onSubmit={onRename} style={{ display: "flex", gap: "0.5rem" }}>
        <label>
          名
          <input value={firstName} onChange={(event) => setFirstName(event.target.value)} />
        </label>
        <button type="submit">保存</button>
      </form>
      <h2>宠物</h2>
      <ul>
        {client.patients.map((patient) => (
          <li key={patient.id}>
            <a href={`/patients/${patient.id}`}>
              {patient.name}（{patient.species}，{patient.status}）
            </a>
          </li>
        ))}
      </ul>
      <form onSubmit={onAddPet} style={{ display: "flex", gap: "0.5rem" }}>
        <label>
          名字
          <input name="petName" value={petName} onChange={(event) => setPetName(event.target.value)} />
        </label>
        <label>
          物种
          <select name="species" value={species} onChange={(event) => setSpecies(event.target.value as (typeof speciesValues)[number])}>
            {speciesValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">添加宠物</button>
      </form>
      <p>{message}</p>
    </main>
  );
}
