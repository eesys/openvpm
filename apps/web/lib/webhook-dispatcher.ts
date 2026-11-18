import { createHmac } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@openpims/db/client";
import { webhooks } from "@openpims/db";
import { isWebhookDeliveryUrl } from "@/lib/webhook-urls";

export const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;

export async function dispatchWebhookEvent(
  practiceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
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
      return Array.isArray(events) && events.includes(event);
    });
    if (matching.length === 0) return;

    const body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    });
    await Promise.all(
      matching.map(async (webhook) => {
        try {
          if (!isWebhookDeliveryUrl(webhook.url)) {
            throw new Error("Invalid webhook delivery URL");
          }
          const signature = createHmac("sha256", webhook.secret)
            .update(body)
            .digest("hex");
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            WEBHOOK_DELIVERY_TIMEOUT_MS,
          );
          try {
            const response = await fetch(webhook.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Webhook-Event": event,
                "X-Webhook-Signature": signature,
              },
              body,
              signal: controller.signal,
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
          } finally {
            clearTimeout(timeout);
          }
        } catch (error) {
          console.error(
            `[WebhookDispatcher] Failed to deliver ${event} to ${webhook.url}:`,
            error,
          );
        }
      }),
    );
  } catch (error) {
    console.error("[WebhookDispatcher] Failed to query webhooks:", error);
  }
}
