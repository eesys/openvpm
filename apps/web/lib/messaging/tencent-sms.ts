import { createHash, createHmac, randomInt, randomUUID } from "node:crypto";

const HOST = "sms.tencentcloudapi.com";
const SERVICE = "sms";
const ACTION = "SendSms";
const VERSION = "2021-01-11";
const ALGORITHM = "TC3-HMAC-SHA256";
const CONTENT_TYPE = "application/json; charset=utf-8";

export type TencentSendSmsRequest = {
  PhoneNumberSet: string[];
  SmsSdkAppId: string;
  TemplateId: string;
  SignName: string;
  TemplateParamSet: string[];
  SessionContext?: string;
};

type SendStatus = {
  SerialNo: string;
  PhoneNumber: string;
  Fee: number;
  SessionContext: string;
  Code: string;
  Message: string;
  IsoCode: string;
};

export type TencentSendSmsResponse = {
  Response: {
    SendStatusSet: SendStatus[];
    RequestId: string;
  };
};

function configured(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/** 11-digit mainland mobiles, including numbers already prefixed as +1, are sent as +86. */
export function toTencentPhoneNumber(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (/^861[3-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (/^1[3-9]\d{9}$/.test(digits)) return `+86${digits}`;
  if (trimmed.startsWith("+") && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}

function failed(message: string, code = "FailedOperation"): TencentSendSmsResponse {
  return {
    Response: {
      SendStatusSet: [
        {
          SerialNo: "",
          PhoneNumber: "",
          Fee: 0,
          SessionContext: "",
          Code: code,
          Message: message,
          IsoCode: "",
        },
      ],
      RequestId: "",
    },
  };
}

function resolveMode(): "mock" | "live" | undefined {
  const mode = configured("TENCENT_SMS_MODE")?.toLowerCase() ?? "mock";
  if (mode === "mock" || mode === "live") return mode;
  return undefined;
}

function authorization(input: {
  secretId: string;
  secretKey: string;
  payload: string;
  timestamp: number;
}): string {
  const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:${CONTENT_TYPE}\nhost:${HOST}\nx-tc-action:${ACTION.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.payload),
  ].join("\n");
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    ALGORITHM,
    String(input.timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const secretDate = hmacSha256(`TC3${input.secretKey}`, date);
  const secretService = hmacSha256(secretDate, SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning)
    .update(stringToSign, "utf8")
    .digest("hex");
  return `${ALGORITHM} Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function mockResponse(request: TencentSendSmsRequest): TencentSendSmsResponse {
  const serialNo = `5000:${Date.now()}${randomInt(1000, 9999)}`;
  const response: TencentSendSmsResponse = {
    Response: {
      SendStatusSet: [
        {
          SerialNo: serialNo,
          PhoneNumber: request.PhoneNumberSet[0] ?? "",
          Fee: 1,
          SessionContext: request.SessionContext ?? "",
          Code: "Ok",
          Message: "send success",
          IsoCode: "CN",
        },
      ],
      RequestId: randomUUID(),
    },
  };
  console.log("[SMS] tencent_mock_accept", {
    templateId: request.TemplateId,
    signName: request.SignName,
    bodyLength: request.TemplateParamSet[0]?.length ?? 0,
    serialNo,
    requestId: response.Response.RequestId,
  });
  return response;
}

async function liveSend(request: TencentSendSmsRequest): Promise<TencentSendSmsResponse> {
  const secretId = configured("TENCENT_SMS_SECRET_ID");
  const secretKey = configured("TENCENT_SMS_SECRET_KEY");
  const region = configured("TENCENT_SMS_REGION") ?? "ap-guangzhou";
  if (!secretId || !secretKey) {
    return failed("Tencent SMS is not configured (TENCENT_SMS_SECRET_ID and TENCENT_SMS_SECRET_KEY are required).");
  }
  const payload = JSON.stringify(request);
  const timestamp = Math.floor(Date.now() / 1000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`https://${HOST}`, {
      method: "POST",
      headers: {
        Authorization: authorization({ secretId, secretKey, payload, timestamp }),
        "Content-Type": CONTENT_TYPE,
        "X-TC-Action": ACTION,
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Version": VERSION,
        "X-TC-Region": region,
      },
      body: payload,
      signal: controller.signal,
    });
    const responseText = await res.text();
    let parsed: {
      Response?: {
        Error?: { Code?: string; Message?: string };
        SendStatusSet?: SendStatus[];
        RequestId?: string;
      };
    } | null = null;
    try {
      parsed = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsed = null;
    }
    const body = parsed?.Response;
    if (body?.Error) {
      return failed(body.Error.Message || "Tencent SMS rejected the request.", body.Error.Code);
    }
    const status = body?.SendStatusSet?.[0];
    if (!res.ok || !status) {
      return failed(`Tencent SMS request failed (${res.status}).`);
    }
    console.log("[SMS] tencent_live_accept", {
      templateId: request.TemplateId,
      code: status.Code,
      requestId: body?.RequestId ?? "",
    });
    return {
      Response: {
        SendStatusSet: [status],
        RequestId: body?.RequestId ?? "",
      },
    };
  } catch {
    return failed("Tencent SMS request failed before a response was received.");
  } finally {
    clearTimeout(timeout);
  }
}

/** Send one SMS. TENCENT_SMS_MODE=live calls Tencent Cloud; any other supported value stays local. */
export async function sendTencentSms(input: {
  phoneNumber: string;
  body: string;
}): Promise<TencentSendSmsResponse> {
  const mode = resolveMode();
  if (!mode) {
    return failed("TENCENT_SMS_MODE must be mock or live.");
  }
  const phoneNumber = toTencentPhoneNumber(input.phoneNumber);
  if (!phoneNumber) {
    return failed("Phone number must be E.164. Mainland mobiles are sent as +86.");
  }
  const sdkAppId = configured("TENCENT_SMS_SDK_APP_ID") ?? (mode === "mock" ? "1400000000" : undefined);
  const templateId = configured("TENCENT_SMS_TEMPLATE_ID") ?? (mode === "mock" ? "1000000" : undefined);
  const signName = configured("TENCENT_SMS_SIGN_NAME") ?? (mode === "mock" ? "示范诊所" : undefined);
  if (!sdkAppId || !templateId || !signName) {
    return failed(
      "Tencent SMS is not configured (TENCENT_SMS_SDK_APP_ID, TENCENT_SMS_SIGN_NAME, and TENCENT_SMS_TEMPLATE_ID are required).",
    );
  }
  const request: TencentSendSmsRequest = {
    PhoneNumberSet: [phoneNumber],
    SmsSdkAppId: sdkAppId,
    TemplateId: templateId,
    SignName: signName,
    TemplateParamSet: [input.body],
  };
  if (mode === "mock") return mockResponse(request);
  return liveSend(request);
}
