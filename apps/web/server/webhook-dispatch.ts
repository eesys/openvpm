import { createHmac } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { webhooks } from "@openpims/db";
import { db } from "@openpims/db/client";

export const WEBHOOK_URL_MAX_LENGTH = 512;
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;

const WEBHOOK_URL_PROTOCOLS = new Set(["http:", "https:"]);

export function isWebhookDeliveryUrl(value: string): boolean {
  if (value.length === 0 || value.length > WEBHOOK_URL_MAX_LENGTH) return false;
  try {
    const url = new URL(value);
    return WEBHOOK_URL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

type AppointmentCreated = {
  id: string;
  startTime: Date;
  endTime: Date;
  status: string;
  patientId: string | null;
  clientId: string | null;
  doctorId: string | null;
};

export async function dispatchAppointmentCreated(
  practiceId: string,
  appointment: AppointmentCreated,
) {
  try {
    await dispatchWebhookEvent(practiceId, "appointment.created", {
      id: appointment.id,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      status: appointment.status,
      patientId: appointment.patientId,
      clientId: appointment.clientId,
      doctorId: appointment.doctorId,
      source: "dashboard",
    });
  } catch (error) {
    console.error("Webhook dispatch failed", error);
  }
}

async function dispatchWebhookEvent(
  practiceId: string,
  event: string,
  payload: Record<string, unknown>,
) {
  const activeWebhooks = await db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.practiceId, practiceId),
        eq(webhooks.active, true),
        isNull(webhooks.deletedAt),
      ),
    );
  const matching = activeWebhooks.filter((webhook) => {
    const events = webhook.events;
    return Array.isArray(events) && (events.includes("*") || events.includes(event));
  });
  if (matching.length === 0) return;

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  await Promise.allSettled(
    matching.map(async (webhook) => {
      if (!isWebhookDeliveryUrl(webhook.url)) {
        console.error(`Invalid webhook delivery URL for ${event}`);
        return;
      }
      const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Event": event,
          "X-Webhook-Signature": signature,
        },
        body,
        signal: AbortSignal.timeout(WEBHOOK_DELIVERY_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.error(`Webhook ${event} delivery failed with HTTP ${response.status}`);
      }
    }),
  );
}
