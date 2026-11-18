import type { Database } from "@openpims/db/client";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher";

type WebhookCaller = {
  postCommitEffect?: (effect: (rootDb: Database) => Promise<void>) => void;
};

/** Deliver after the appointment write has committed. */
export async function dispatchAppointmentWebhookAfterCommit(
  ctx: unknown,
  practiceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const caller = ctx as WebhookCaller;
  if (caller.postCommitEffect) {
    caller.postCommitEffect(async () => {
      await dispatchWebhookEvent(practiceId, event, payload);
    });
    return;
  }
  await dispatchWebhookEvent(practiceId, event, payload);
}
