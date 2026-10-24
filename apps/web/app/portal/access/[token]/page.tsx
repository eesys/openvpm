"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

export default function PortalAccessPage() {
  const params = useParams<{ token: string }>();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function onContinue() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/portal/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: params.token }),
      });
      const body = (await response.json()) as { redirectTo?: string; error?: string };
      if (!response.ok || body.redirectTo !== "/portal") {
        throw new Error(body.error || "无法打开门户");
      }
      window.location.replace(body.redirectTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法打开门户");
      setPending(false);
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem", maxWidth: "28rem" }}>
      <h1>打开宠物门户</h1>
      <p>这条链接只能用一次，而且很快过期。继续之后会在这台设备上建立门户会话。</p>
      <button type="button" onClick={onContinue} disabled={pending}>
        {pending ? "正在打开…" : "继续"}
      </button>
      <p>{message}</p>
    </main>
  );
}
