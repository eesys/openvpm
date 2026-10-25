import { createHash } from "node:crypto";
import { isSafeCheckoutRedirectUrl } from "@/lib/checkout-redirect";

const STRIPE_CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions";

export function appBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  if (!configured) return "http://localhost:3000";
  try {
    const url = new URL(configured);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
      return url.origin;
    }
  } catch {
    return "http://localhost:3000";
  }
  return "http://localhost:3000";
}

export async function createInvoiceCheckoutSession(input: {
  invoiceId: string;
  amountCents: number;
  clientEmail: string | null;
  description: string;
  successUrl: string;
  cancelUrl: string;
  currency?: string;
}): Promise<{ url: string | null } | null> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;

  const currency = (input.currency ?? "usd").toLowerCase();
  const metadata = {
    invoiceId: input.invoiceId,
    captureMode: "manual_v1",
    source: "client_invoice",
  };
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("client_reference_id", input.invoiceId);
  body.set("success_url", input.successUrl);
  body.set("cancel_url", input.cancelUrl);
  const email = input.clientEmail?.trim().toLowerCase();
  if (email) body.set("customer_email", email);
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", currency);
  body.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
  body.set("line_items[0][price_data][product_data][name]", input.description.slice(0, 250));
  for (const [name, value] of Object.entries(metadata)) {
    body.set(`metadata[${name}]`, value);
    body.set(`payment_intent_data[metadata][${name}]`, value);
  }
  body.set("payment_intent_data[capture_method]", "manual");

  const idempotencyKey = `openvpm:invoice-checkout:${input.invoiceId}:${createHash("sha256")
    .update(body.toString())
    .digest("hex")
    .slice(0, 32)}`.slice(0, 255);

  const response = await fetch(STRIPE_CHECKOUT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    url?: unknown;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe checkout failed (${response.status}).`);
  }
  const url = isSafeCheckoutRedirectUrl(payload?.url) ? payload.url : null;
  return { url };
}
