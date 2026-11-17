"use client";

import { trpc } from "@/lib/trpc";

export default function PortalHomePage() {
  const { data, isLoading, error } = trpc.portal.getClient.useQuery({});

  if (isLoading) return <p>Loading portal...</p>;
  if (error || !data) {
    return (
      <main>
        <h1>Unable to load portal</h1>
        <p>
          This portal link is invalid or has expired. Please contact your
          veterinary clinic for a new link.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>
        Welcome, {data.firstName} {data.lastName}
      </h1>
      <p>{data.practice.name}</p>
      <h2>Your pets</h2>
      {data.patients.length === 0 ? <p>No pets on file yet.</p> : null}
      <ul>
        {data.patients.map((pet) => (
          <li key={pet.id}>
            {pet.name} · {pet.species}
            {pet.breed ? ` · ${pet.breed}` : ""}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={async () => {
          await fetch("/api/portal/session", { method: "DELETE" });
          window.location.reload();
        }}
      >
        Sign out
      </button>
    </main>
  );
}
