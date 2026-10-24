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
type Communication = {
  id: string;
  channel: (typeof channelValues)[number];
  direction: (typeof directionValues)[number];
  subject: string | null;
  content: string | null;
  status: string;
  readAt: string | null;
  createdAt: string;
};

const channelValues = ["phone", "sms", "email", "portal"] as const;
const directionValues = ["inbound", "outbound"] as const;
const channelLabels: Record<(typeof channelValues)[number], string> = {
  phone: "电话",
  sms: "短信",
  email: "邮件",
  portal: "门户",
};
const directionLabels: Record<(typeof directionValues)[number], string> = {
  inbound: "呼入",
  outbound: "呼出",
};

function statusLabel(message: Communication) {
  if (message.direction === "inbound") {
    if (message.readAt || message.status === "read") return "诊所已读";
    if (message.status === "pending" || message.status === "sent" || message.status === "delivered") {
      return "未读";
    }
  }
  if (message.direction === "outbound" && message.channel === "portal" && message.status === "read") {
    return "客户已读";
  }
  if (message.direction === "outbound" && message.channel === "portal" && message.status === "delivered") {
    return "已送到门户";
  }
  const labels: Record<string, string> = {
    pending: "待处理",
    sent: "已发出",
    delivered: "已送达",
    read: "已读",
    failed: "失败",
  };
  return labels[message.status] ?? message.status;
}

function formatWhen(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return date.toLocaleString("zh-CN", { timeZone });
  } catch {
    return date.toLocaleString("zh-CN");
  }
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [message, setMessage] = useState("");
  const [firstName, setFirstName] = useState("");
  const [petName, setPetName] = useState("");
  const [species, setSpecies] = useState<(typeof speciesValues)[number]>("canine");
  const [portalLink, setPortalLink] = useState("");
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [timezone, setTimezone] = useState("America/New_York");
  const [channel, setChannel] = useState<(typeof channelValues)[number]>("phone");
  const [direction, setDirection] = useState<(typeof directionValues)[number]>("inbound");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");

  async function load() {
    const result = await trpc<ClientDetail>("clients.getById", { id: params.id });
    setClient(result);
    setFirstName(result.firstName);
    const log = await trpc<{ timezone: string; items: Communication[] }>(
      "communications.getByClient",
      { clientId: params.id },
    );
    setTimezone(log.timezone);
    setCommunications(log.items);
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

  async function onPortalLink() {
    setMessage("");
    try {
      const result = await trpc<{ accessToken: string }>(
        "clients.rotatePortalAccessToken",
        { id: params.id },
        "POST",
      );
      setPortalLink(`/portal/access/${result.accessToken}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "门户链接没有生成");
    }
  }

  async function onRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await trpc(
        "communications.create",
        {
          clientId: params.id,
          channel,
          direction,
          subject: subject.trim() || undefined,
          content,
        },
        "POST",
      );
      setSubject("");
      setContent("");
      await load();
      setMessage("已记下");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "没有记下");
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
      <p>
        <button type="button" onClick={onPortalLink}>
          生成门户链接
        </button>
      </p>
      {portalLink ? (
        <p>
          一次性链接：<a href={portalLink}>{portalLink}</a>
        </p>
      ) : null}
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
      <h2>沟通记录</h2>
      {communications.length === 0 ? <p>还没有沟通记录</p> : null}
      <ul>
        {communications.map((item) => (
          <li key={item.id}>
            {`${channelLabels[item.channel]} · ${directionLabels[item.direction]} · ${statusLabel(item)} · ${formatWhen(item.createdAt, timezone)}`}
            {item.subject ? <div>{item.subject}</div> : null}
            <div style={{ whiteSpace: "pre-wrap" }}>{item.content?.trim() || "没有内容"}</div>
          </li>
        ))}
      </ul>
      <form onSubmit={onRecord} style={{ display: "grid", gap: "0.75rem", maxWidth: "24rem" }}>
        <label>
          渠道
          <select value={channel} onChange={(event) => setChannel(event.target.value as (typeof channelValues)[number])}>
            {channelValues.map((value) => (
              <option key={value} value={value}>
                {channelLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          方向
          <select value={direction} onChange={(event) => setDirection(event.target.value as (typeof directionValues)[number])}>
            {directionValues.map((value) => (
              <option key={value} value={value}>
                {directionLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          主题
          <input value={subject} onChange={(event) => setSubject(event.target.value)} />
        </label>
        <label>
          内容
          <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={3} />
        </label>
        <button type="submit">记下</button>
      </form>
      <p>{message}</p>
    </main>
  );
}
