"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type Webhook = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
};

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const rows = await trpc<Webhook[]>("webhooks.list");
    setWebhooks(rows);
  }

  useEffect(() => {
    load().catch((error: Error) => setMessage(error.message));
  }, []);

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSecret("");
    try {
      const created = await trpc<Webhook & { secret: string }>(
        "webhooks.create",
        { url, events: ["appointment.created"] },
        "POST",
      );
      setUrl("");
      setSecret(created.secret);
      await load();
      setMessage("已登记");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登记失败");
    }
  }

  async function onToggle(id: string) {
    setMessage("");
    try {
      await trpc("webhooks.toggle", { id }, "POST");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "切换失败");
    }
  }

  async function onDelete(id: string) {
    setMessage("");
    try {
      await trpc("webhooks.delete", { id }, "POST");
      await load();
      setMessage("已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <p>
        <a href="/">首页</a>
        {" · "}
        <a href="/schedule">日程</a>
      </p>
      <h1>Webhook</h1>
      <p>预约创建后，向这个地址发送一条签名通知。密钥只在登记时出现一次。</p>
      <form onSubmit={onCreate} style={{ display: "grid", gap: "0.75rem", maxWidth: "32rem" }}>
        <label>
          地址
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <p>订阅：预约创建</p>
        <button type="submit">登记</button>
      </form>
      {secret ? (
        <p>
          密钥：<code>{secret}</code>
        </p>
      ) : null}
      <h2>已登记</h2>
      <ul>
        {webhooks.map((webhook) => (
          <li key={webhook.id}>
            {webhook.url}
            {webhook.active ? "，启用" : "，停用"}
            {" · "}
            <button type="button" onClick={() => onToggle(webhook.id)}>
              {webhook.active ? "停用" : "启用"}
            </button>
            {" · "}
            <button type="button" onClick={() => onDelete(webhook.id)}>
              删除
            </button>
          </li>
        ))}
      </ul>
      <p>{message}</p>
    </main>
  );
}
