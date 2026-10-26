import { consoleProvider } from "./console";
import { envValue } from "./env";
import { telnyxProvider } from "./telnyx";
import type {
  MessagingProvider,
  MessagingProviderName,
  MessagingSender,
  ResolvedMessagingTransport,
} from "./types";

export * from "./types";
export { normalizeE164 } from "./phone";

/**
 * Resolve the active messaging provider. Explicit override via MESSAGING_PROVIDER
 * (telnyx), else Telnyx when configured, else a console fallback that logs
 * instead of sending (local dev / CI).
 */
export function getMessagingProvider(): MessagingProvider {
  const override = envValue("MESSAGING_PROVIDER")?.toLowerCase();
  if (override === "telnyx") return telnyxProvider;
  if (telnyxProvider.isConfigured()) return telnyxProvider;
  return consoleProvider;
}

/** Platform-wide env default sender for the active provider (dev + fallback). */
function envSender(providerName: MessagingProviderName): MessagingSender {
  void providerName;
  return {
    messagingServiceId: envValue("TELNYX_MESSAGING_PROFILE_ID"),
    from: envValue("TELNYX_FROM_NUMBER"),
  };
}

/**
 * Resolve the provider and sender for one outbound message. Location-scoped
 * sends arrive with the texting-number setup iteration; until then every send
 * uses the platform-wide env defaults (main's fallback branch).
 */
export async function resolveMessagingTransport(): Promise<ResolvedMessagingTransport> {
  const provider = getMessagingProvider();
  return { provider, sender: envSender(provider.name) };
}
