"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type Plan = {
  tier: string;
  name: string;
  blurb: string;
  includedSmsPerMonth: number | null;
  includedAiRunsPerMonth: number | null;
  selfServe: boolean;
};

type Subscription = {
  tier: string;
  billingStatus: string;
  trialEndsAt: string | null;
  billingEnforced: boolean;
  hasFullAccess: boolean;
  usage: { period: string; sms: number; aiRuns: number };
  plans: Plan[];
};

const STATUS_LABELS: Record<string, string> = {
  none: "未开通",
  trialing: "试用中",
  active: "已订阅",
  past_due: "逾期（重试中）",
  unpaid: "未支付",
  canceled: "已取消",
};

function includedLabel(value: number | null) {
  return value === null ? "不限" : `${value}`;
}

export default function SettingsPage() {
  const [data, setData] = useState<Subscription | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    trpc<Subscription>("subscription.get")
      .then(setData)
      .catch((error: Error) => setMessage(error.message));
  }, []);

  const currentPlan = data?.plans.find((plan) => plan.tier === data.tier);

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <p>
        <a href="/">首页</a>
        {" · "}
        <a href="/schedule">日程</a>
      </p>
      <h1>设置 · 方案与用量</h1>
      {message ? <p>{message}</p> : null}
      {data ? (
        <>
          {!data.billingEnforced ? (
            <p>自托管模式：不计量用量，全部功能可用（HOSTED_BILLING_ENABLED 未开启）。</p>
          ) : null}
          <h2>当前方案</h2>
          <ul>
            <li>方案：{currentPlan?.name ?? data.tier}</li>
            <li>状态：{STATUS_LABELS[data.billingStatus] ?? data.billingStatus}</li>
            {data.trialEndsAt ? (
              <li>试用截止：{new Date(data.trialEndsAt).toLocaleString()}</li>
            ) : null}
            <li>完整访问：{data.hasFullAccess ? "是" : "否"}</li>
          </ul>
          <h2>本期用量（{data.usage.period}）</h2>
          <ul>
            <li>
              短信：{data.usage.sms} / {includedLabel(currentPlan?.includedSmsPerMonth ?? null)}
            </li>
            <li>
              AI 运行：{data.usage.aiRuns} / {includedLabel(currentPlan?.includedAiRunsPerMonth ?? null)}
            </li>
          </ul>
          <h2>方案目录</h2>
          <ul>
            {data.plans.map((plan) => (
              <li key={plan.tier}>
                <strong>{plan.name}</strong>
                {plan.tier === data.tier ? "（当前）" : ""}
                {plan.selfServe ? "" : " · 联系销售"}
                <br />
                {plan.blurb}
                <br />
                每月含短信 {includedLabel(plan.includedSmsPerMonth)} 条 · AI 运行{" "}
                {includedLabel(plan.includedAiRunsPerMonth)} 次
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
