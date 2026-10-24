import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher";

export type AppointmentCreatedWebhookSource = "dashboard";

type AppointmentCreatedWebhookRow = {
  id: string;
  startTime: Date;
  endTime: Date;
  status?: string | null;
  patientId?: string | null;
  clientId?: string | null;
  doctorId?: string | null;
};

export function appointmentCreatedWebhookPayload(
  appointment: AppointmentCreatedWebhookRow,
  source: AppointmentCreatedWebhookSource,
) {
  return {
    id: appointment.id,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status ?? null,
    patientId: appointment.patientId ?? null,
    clientId: appointment.clientId ?? null,
    doctorId: appointment.doctorId ?? null,
    source,
  };
}

function postCommitEffect(ctx: object) {
  if (!("postCommitEffect" in ctx)) return null;
  const effect = ctx.postCommitEffect;
  if (typeof effect !== "function") return null;
  return effect as (run: () => Promise<void>) => void;
}

export async function dispatchAppointmentWebhookAfterCommit(
  ctx: object,
  practiceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const afterCommit = postCommitEffect(ctx);
  if (afterCommit) {
    afterCommit(async () => {
      await dispatchWebhookEvent(practiceId, event, payload);
    });
    return;
  }
  await dispatchWebhookEvent(practiceId, event, payload);
}
