"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type PortalHome = {
  firstName: string;
  lastName: string;
  patients: Array<{ id: string; name: string; species: string; status: string }>;
};

export default function PortalHomePage() {
  const [home, setHome] = useState<PortalHome | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    trpc<PortalHome>("portal.getClient")
      .then(setHome)
      .catch((error: Error) => setMessage(error.message));
  }, []);

  if (!home) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
        <p>{message || "正在打开门户…"}</p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>{`${home.lastName}${home.firstName}`}的宠物</h1>
      {home.patients.length === 0 ? <p>还没有宠物。</p> : null}
      <ul>
        {home.patients.map((pet) => (
          <li key={pet.id}>
            {pet.name}（{pet.species}，{pet.status}）
          </li>
        ))}
      </ul>
    </main>
  );
}
