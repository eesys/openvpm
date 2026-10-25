import { sendTencentSms } from "@/lib/messaging/tencent-sms";

export type SmsSendResult =
  | { success: true; outcome: "accepted"; sid: string }
  | { success: false; outcome: "definite_failure"; error: string };

export async function sendSms(input: { to: string; body: string }): Promise<SmsSendResult> {
  const response = await sendTencentSms({
    phoneNumber: input.to,
    body: input.body,
  });
  const status = response.Response.SendStatusSet[0];
  if (!status || status.Code !== "Ok" || !status.SerialNo) {
    return {
      success: false,
      outcome: "definite_failure",
      error: status?.Message || "Tencent SMS did not accept the message.",
    };
  }
  return { success: true, outcome: "accepted", sid: status.SerialNo };
}
