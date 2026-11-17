"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

export function PortalLink({ clientId }: { clientId: string }) {
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
                setLink(`${window.location.origin}/portal/access/${result.accessToken}`);
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
          This link works once and expires in 15 minutes.{" "}
          <a href={link}>{link}</a>
        </p>
      ) : (
        <p>No portal link has been issued for this client yet.</p>
      )}
    </section>
  );
}
