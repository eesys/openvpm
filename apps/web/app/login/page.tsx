"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("frontdesk@demo.clinic");
  const [password, setPassword] = useState("password");
  const [message, setMessage] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("正在登录…");

    const login = await fetch("/api/trpc/auth.login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    if (!login.ok) {
      setMessage("邮箱或密码不正确");
      return;
    }

    const me = await fetch("/api/trpc/auth.me", { credentials: "include" });
    if (!me.ok) {
      setMessage("会话没有带上当前诊所");
      return;
    }
    const body = (await me.json()) as {
      result?: { data?: { name?: string; role?: string; practiceId?: string } };
    };
    const current = body.result?.data;
    setMessage(
      current?.practiceId
        ? `${current.name}（${current.role}）的当前诊所是 ${current.practiceId}`
        : "会话没有带上当前诊所",
    );
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>登录</h1>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem", maxWidth: "24rem" }}>
        <label>
          邮箱
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <button type="submit">进入诊所</button>
      </form>
      <p>{message}</p>
    </main>
  );
}
