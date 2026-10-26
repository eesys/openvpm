import type {
  MessagingProvider,
  SendMessageInput,
  SendMessageResult,
} from "./types";
import { randomUUID } from "node:crypto";

/**
 * Dev/CI fallback: logs the message instead of sending when no real provider is
 * configured. Sends are never metered for this provider (see lib/sms.ts).
 */
export const consoleProvider: MessagingProvider = {
  name: "console",

  isConfigured(): boolean {
    return true;
  },

  async send({ body }: SendMessageInput): Promise<SendMessageResult> {
    console.log("[SMS] console_provider_accept", {
      bodyLength: body.length,
    });
    return { status: "accepted", id: `dev-console:${randomUUID()}` };
  },
};
