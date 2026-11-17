import { isSupportedQuantity, quantityLineTotalCents } from "@/lib/quantity";
import { moneyToCents } from "./invoice-balance";

export const BILLING_INVOICE_LINE_DESCRIPTION_MAX_LENGTH = 500;
export const BILLING_INVOICE_MAX_ITEMS = 200;
export const BILLING_INVOICE_LINE_QUANTITY_MIN = 0.001;
export const BILLING_INVOICE_LINE_QUANTITY_MAX = 10000;
export const BILLING_MAX_MONEY_CENTS = 9_999_999_999;
export const BILLING_CURRENCY_AMOUNT_PATTERN = /^\d{1,8}(?:\.\d{1,2})?$/;

export function isBillingCurrencyAmountInputValid(value: string): boolean {
  const trimmed = value.trim();
  return (
    BILLING_CURRENCY_AMOUNT_PATTERN.test(trimmed) &&
    moneyToCents(trimmed) <= BILLING_MAX_MONEY_CENTS
  );
}

export function isBillingInvoiceLineQuantityValid(value: number): boolean {
  return (
    isSupportedQuantity(value) &&
    value >= BILLING_INVOICE_LINE_QUANTITY_MIN &&
    value <= BILLING_INVOICE_LINE_QUANTITY_MAX
  );
}
