import { randomUUID } from "node:crypto";

export async function acceptConsoleSms(body: string): Promise<string> {
  console.log("[SMS] console_provider_accept", { bodyLength: body.length });
  return `dev-console:${randomUUID()}`;
}
