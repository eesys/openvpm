import { resolveMessagingTransport } from "@/lib/messaging";
import { recordUsage } from "@/lib/billing/usage";

export type SmsSendResult =
  | { success: true; outcome: "accepted"; sid: string }
  | { success: false; outcome: "definite_failure"; error: string };

// Transport is provider-agnostic (lib/messaging): the env-selected provider and
// sender are resolved per send. This module keeps the usage metering.
export async function sendSms(input: {
  to: string;
  body: string;
  practiceId: string;
}): Promise<SmsSendResult> {
  const transport = await resolveMessagingTransport();
  const result = await transport.provider.send({
    to: input.to,
    body: input.body,
    sender: transport.sender,
  });
  if (result.status !== "accepted") {
    return {
      success: false,
      outcome: "definite_failure",
      error: result.error,
    };
  }
  // Console sends are the dev fallback, not real usage — never metered.
  if (transport.provider.name !== "console") {
    await recordUsage({ practiceId: input.practiceId, kind: "sms" });
  }
  return { success: true, outcome: "accepted", sid: result.id };
}
