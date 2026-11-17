"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

export default function PortalAccessPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueToPortal() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/portal/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = (await response.json()) as {
        redirectTo?: string;
        error?: string;
      };
      if (!response.ok || body.redirectTo !== "/portal") {
        throw new Error(body.error || "Unable to open the portal");
      }
      window.location.replace(body.redirectTo);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to open the portal. Please ask your clinic for a new link.",
      );
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Open your secure pet portal</h1>
      <p>
        This private link can be used once and expires shortly. Continuing
        creates a secure session on this device and removes the link from your
        address bar.
      </p>
      <button type="button" onClick={continueToPortal} disabled={loading}>
        {loading ? "Opening portal..." : "Continue securely"}
      </button>
      {error ? <p>{error}</p> : null}
    </main>
  );
}
