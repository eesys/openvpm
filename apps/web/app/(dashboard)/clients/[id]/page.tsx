"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { COMMUNICATION_CONTENT_MAX_LENGTH } from "@/lib/communications/policy";
import { trpc } from "@/lib/trpc";

export default function ClientDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { status } = useSession();
  if (status === "loading") return <p>Loading client...</p>;
  if (status === "unauthenticated") {
    router.push("/login");
    return <p>Loading client...</p>;
  }
  return <ClientDetail id={params.id} />;
}

function ClientDetail({ id }: { id: string }) {
  const client = trpc.clients.getById.useQuery({ id });
  if (client.isLoading) return <p>Loading client...</p>;
  if (client.error) return <p>{client.error.message}</p>;
  if (!client.data) return <p>Client not found.</p>;

  const detail = client.data;
  return (
    <main>
      <p>
        <a href="/clients">Clients</a>
      </p>
      <h1>
        {detail.firstName} {detail.lastName}
      </h1>
      <p>
        {[detail.email, detail.phone].filter(Boolean).join(" · ") ||
          "No contact details"}
      </p>
      <p>
        <a href={`/clients/${detail.id}/edit`}>Edit</a>
      </p>
      <PortalLink clientId={detail.id} />
      <ClientMessages clientId={detail.id} />
      <h2>Patients</h2>
      <ul>
        {detail.patients.map((patient) => (
          <li key={patient.id}>
            <a href={`/patients/${patient.id}`}>{patient.name}</a>
            {` · ${patient.species} · ${patient.status}`}
          </li>
        ))}
      </ul>
      <p>
        <a
          href={`/patients/new?clientId=${encodeURIComponent(detail.id)}&clientName=${encodeURIComponent(`${detail.firstName} ${detail.lastName}`)}`}
        >
          Add patient
        </a>
      </p>
    </main>
  );
}

function PortalLink({ clientId }: { clientId: string }) {
  const rotate = trpc.clients.rotatePortalAccessToken.useMutation();
  const [link, setLink] = useState<string | null>(null);

  return (
    <section>
      <h2>Portal link</h2>
      <button
        type="button"
        disabled={rotate.isPending}
        onClick={() => {
          rotate.mutate(
            { id: clientId },
            {
              onSuccess: (result) => {
                setLink(
                  `${window.location.origin}/portal/access/${result.accessToken}`,
                );
              },
            },
          );
        }}
      >
        {rotate.isPending ? "Creating link..." : "Create portal link"}
      </button>
      {rotate.error ? <p>{rotate.error.message}</p> : null}
      {link ? (
        <p>
          This link works once and expires in 15 minutes. <a href={link}>{link}</a>
        </p>
      ) : (
        <p>No portal link has been issued for this client yet.</p>
      )}
    </section>
  );
}

function ClientMessages({ clientId }: { clientId: string }) {
  const utils = trpc.useUtils();
  const messages = trpc.communications.getByClient.useQuery({ clientId });
  const createMessage = trpc.communications.create.useMutation({
    onSuccess: async () => {
      setContent("");
      await utils.communications.getByClient.invalidate({ clientId });
    },
  });
  const [channel, setChannel] = useState<"phone" | "portal">("phone");
  const [content, setContent] = useState("");

  return (
    <section>
      <h2>Messages</h2>
      {messages.error ? <p>{messages.error.message}</p> : null}
      {(messages.data ?? []).length === 0 && !messages.isLoading ? (
        <p>No messages yet.</p>
      ) : null}
      <ul>
        {(messages.data ?? []).map((message) => (
          <li key={message.id}>
            {message.channel} · {message.direction} · {message.status}
            {message.assignedToName ? ` · ${message.assignedToName}` : ""}
            {message.content ? ` · ${message.content}` : ""}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          createMessage.mutate({
            clientId,
            channel,
            direction: "outbound",
            content,
          });
        }}
      >
        <label>
          Channel{" "}
          <select
            value={channel}
            onChange={(event) =>
              setChannel(event.target.value as "phone" | "portal")
            }
          >
            <option value="phone">Phone</option>
            <option value="portal">Portal</option>
          </select>
        </label>
        <label>
          Message{" "}
          <textarea
            value={content}
            maxLength={COMMUNICATION_CONTENT_MAX_LENGTH}
            onChange={(event) => setContent(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={!content.trim() || createMessage.isPending}
        >
          {createMessage.isPending ? "Saving..." : "Save message"}
        </button>
        {createMessage.error ? <p>{createMessage.error.message}</p> : null}
      </form>
    </section>
  );
}
