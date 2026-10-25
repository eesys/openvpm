import { createHmac, createSign, randomBytes } from "node:crypto";

export type DirectPayMethod = "wechat" | "alipay";

const WECHAT_PAY_URL = "https://api.mch.weixin.qq.com/pay/micropay";
const WECHAT_QUERY_URL = "https://api.mch.weixin.qq.com/pay/orderquery";
const ALIPAY_GATEWAY = "https://openapi.alipay.com/gateway.do";

function configured(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function pemPrivateKey(raw: string): string {
  const normalized = raw.replace(/\\n/g, "\n").trim();
  if (normalized.includes("BEGIN")) return normalized;
  const body = normalized.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? normalized;
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

function yuan(amountCents: number): string {
  return `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, "0")}`;
}

function outTradeNo(): string {
  return randomBytes(16).toString("hex");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function alipayTimestamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const hour = value("hour") === "24" ? "00" : value("hour");
  return `${value("year")}-${value("month")}-${value("day")} ${hour}:${value("minute")}:${value("second")}`;
}

function assertAuthCode(method: DirectPayMethod, authCode: string): void {
  if (method === "wechat" && !/^1[0-5]\d{16}$/.test(authCode)) {
    throw new Error("This is not a WeChat payment code.");
  }
  if (method === "alipay" && !/^(?:25|26|27|28|29|30)\d{14,22}$/.test(authCode)) {
    throw new Error("This is not an Alipay payment code.");
  }
}

function wechatSign(params: Record<string, string>, apiKey: string): string {
  const content = Object.keys(params)
    .filter((key) => params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHmac("sha256", apiKey).update(`${content}&key=${apiKey}`, "utf8").digest("hex").toUpperCase();
}

function wechatXml(params: Record<string, string>): string {
  const body = Object.entries(params)
    .map(([key, value]) => `<${key}><![CDATA[${value.replace(/\]\]>/g, "")}]]></${key}>`)
    .join("");
  return `<xml>${body}</xml>`;
}

function xmlValue(xml: string, tag: string): string {
  const cdata = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`).exec(xml);
  if (cdata) return cdata[1] ?? "";
  const plain = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return plain?.[1] ?? "";
}

async function wechatPost(url: string, params: Record<string, string>, apiKey: string): Promise<Record<string, string>> {
  const signed = { ...params, sign: wechatSign(params, apiKey) };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: wechatXml(signed),
    signal: AbortSignal.timeout(20_000),
  });
  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`WeChat Pay order failed (${response.status}).`);
  }
  const fields = [
    "return_code",
    "return_msg",
    "result_code",
    "err_code",
    "err_code_des",
    "trade_state",
    "trade_state_desc",
  ];
  return Object.fromEntries(fields.map((field) => [field, xmlValue(xml, field)]));
}

async function chargeWechat(input: {
  authCode: string;
  amountCents: number;
  description: string;
  invoiceId: string;
}): Promise<void> {
  const appid = configured("WECHAT_PAY_APP_ID");
  const mchId = configured("WECHAT_PAY_MCH_ID");
  const apiKey = configured("WECHAT_PAY_API_KEY");
  if (!appid || !mchId || !apiKey) {
    throw new Error("WeChat Pay is not configured.");
  }
  const tradeNo = outTradeNo();
  const common = { appid, mch_id: mchId, sign_type: "HMAC-SHA256" };
  const payment = await wechatPost(
    WECHAT_PAY_URL,
    {
      ...common,
      nonce_str: randomBytes(16).toString("hex"),
      body: input.description.slice(0, 127),
      out_trade_no: tradeNo,
      total_fee: String(input.amountCents),
      fee_type: "CNY",
      spbill_create_ip: "127.0.0.1",
      auth_code: input.authCode,
      attach: input.invoiceId,
    },
    apiKey,
  );
  if (payment.return_code !== "SUCCESS") {
    throw new Error(payment.return_msg || "WeChat Pay order failed.");
  }
  if (payment.result_code === "SUCCESS") return;
  if (payment.err_code !== "USERPAYING" && payment.err_code !== "SYSTEMERROR") {
    throw new Error(payment.err_code_des || payment.err_code || "WeChat Pay was not completed.");
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await wait(2_000);
    const queried = await wechatPost(
      WECHAT_QUERY_URL,
      {
        ...common,
        nonce_str: randomBytes(16).toString("hex"),
        out_trade_no: tradeNo,
      },
      apiKey,
    );
    if (queried.trade_state === "SUCCESS") return;
    if (queried.trade_state && queried.trade_state !== "USERPAYING" && queried.trade_state !== "NOTPAY") {
      throw new Error(queried.trade_state_desc || queried.err_code_des || "WeChat Pay was not completed.");
    }
  }
  throw new Error("The customer is still confirming this WeChat payment.");
}

async function alipayCall(
  method: string,
  bizContent: Record<string, string>,
  appId: string,
  privateKey: string,
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {
    app_id: appId,
    method,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: alipayTimestamp(),
    version: "1.0",
    biz_content: JSON.stringify(bizContent),
  };
  const content = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  params.sign = createSign("RSA-SHA256").update(content, "utf8").sign(pemPrivateKey(privateKey), "base64");
  const response = await fetch(ALIPAY_GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const key = `${method.split(".").join("_")}_response`;
  const result = payload?.[key];
  if (!response.ok || !result || typeof result !== "object") {
    throw new Error(`Alipay order failed (${response.status}).`);
  }
  return result as Record<string, unknown>;
}

function alipayMessage(result: Record<string, unknown>, fallback: string): string {
  const sub = typeof result.sub_msg === "string" ? result.sub_msg : "";
  const msg = typeof result.msg === "string" ? result.msg : "";
  return sub || msg || fallback;
}

async function chargeAlipay(input: {
  authCode: string;
  amountCents: number;
  description: string;
}): Promise<void> {
  const appId = configured("ALIPAY_APP_ID");
  const privateKey = configured("ALIPAY_PRIVATE_KEY");
  if (!appId || !privateKey) {
    throw new Error("Alipay is not configured.");
  }
  const tradeNo = outTradeNo();
  const subject = input.description.replace(/[/=&]/g, " ").slice(0, 256);
  const payment = await alipayCall(
    "alipay.trade.pay",
    {
      out_trade_no: tradeNo,
      scene: "bar_code",
      auth_code: input.authCode,
      subject,
      total_amount: yuan(input.amountCents),
      product_code: "FACE_TO_FACE_PAYMENT",
    },
    appId,
    privateKey,
  );
  const code = String(payment.code ?? "");
  if (code.startsWith("400")) {
    throw new Error(alipayMessage(payment, "Alipay payment was not completed."));
  }
  if (code !== "10000" && code !== "10003" && code !== "20000") {
    throw new Error(alipayMessage(payment, `Alipay order failed (${code || "unknown"}).`));
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await wait(2_000);
    const queried = await alipayCall("alipay.trade.query", { out_trade_no: tradeNo }, appId, privateKey);
    const status = String(queried.trade_status ?? "");
    if (status === "TRADE_SUCCESS" || status === "TRADE_FINISHED") return;
    if (status && status !== "WAIT_BUYER_PAY") {
      throw new Error(alipayMessage(queried, "Alipay payment was not completed."));
    }
    if (String(queried.code ?? "") === "40004") {
      throw new Error(alipayMessage(queried, "Alipay payment was not completed."));
    }
  }
  throw new Error("The customer is still confirming this Alipay payment.");
}

/** Charge a scanned WeChat or Alipay customer payment code for the invoice balance. */
export async function chargeCustomerPayCode(input: {
  method: DirectPayMethod;
  authCode: string;
  amountCents: number;
  description: string;
  invoiceId: string;
}): Promise<void> {
  const authCode = input.authCode.replace(/\s+/g, "");
  if (!authCode) throw new Error("Scan the customer's payment code.");
  assertAuthCode(input.method, authCode);
  if (input.method === "wechat") {
    await chargeWechat({ ...input, authCode });
    return;
  }
  await chargeAlipay({ ...input, authCode });
}
