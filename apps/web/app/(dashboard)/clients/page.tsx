"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type ClientList = {
  items: Array<{ id: string; firstName: string; lastName: string; phone: string | null }>;
  total: number;
};

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientList["items"]>([]);
  const [message, setMessage] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  async function load() {
    const result = await trpc<ClientList>("clients.list");
    setClients(result.items);
  }

  useEffect(() => {
    load().catch((error: Error) => setMessage(error.message));
  }, []);

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await trpc("clients.create", { firstName, lastName, phone }, "POST");
      setFirstName("");
      setLastName("");
      setPhone("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>客户</h1>
      <p>
        <a href="/login">登录</a>
      </p>
      <form onSubmit={onCreate} style={{ display: "grid", gap: "0.75rem", maxWidth: "24rem" }}>
        <label>
          名
          <input value={firstName} onChange={(event) => setFirstName(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          姓
          <input value={lastName} onChange={(event) => setLastName(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          电话
          <input value={phone} onChange={(event) => setPhone(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit">添加客户</button>
      </form>
      <p>{message}</p>
      <ul>
        {clients.map((client) => (
          <li key={client.id}>
            <a href={`/clients/${client.id}`}>{`${client.lastName}${client.firstName}`}</a>
            {client.phone ? ` ${client.phone}` : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
