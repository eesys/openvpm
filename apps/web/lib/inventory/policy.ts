export const INVENTORY_PRODUCT_NAME_MAX_LENGTH = 255;
export const INVENTORY_PRODUCT_SKU_MAX_LENGTH = 64;
export const INVENTORY_PRODUCT_CATEGORY_MAX_LENGTH = 128;
export const INVENTORY_PRODUCT_LOT_NUMBER_MAX_LENGTH = 64;
export const INVENTORY_PRODUCT_SEARCH_MAX_LENGTH = 120;
export const INVENTORY_STOCK_QUANTITY_MAX = 2_147_483_647;
export const INVENTORY_ADJUSTMENT_REASON_MAX_LENGTH = 500;
export const INVENTORY_MONEY_AMOUNT_PATTERN = /^\d{1,8}(?:\.\d{1,2})?$/;
export const INVENTORY_MONEY_AMOUNT_MAX_CENTS = 9_999_999_999;

export const PRODUCT_PRICING_FORBIDDEN_MESSAGE =
  "Only an administrator or front desk teammate can add products or change product prices and tax status.";

export function canManageProductPricing(role?: string | null): boolean {
  return role === "admin" || role === "front_desk";
}

export function isInventoryCurrencyAmountInputValid(value: string): boolean {
  const trimmed = value.trim();
  const cents = Math.round(Number(trimmed) * 100);
  return (
    INVENTORY_MONEY_AMOUNT_PATTERN.test(trimmed) &&
    cents <= INVENTORY_MONEY_AMOUNT_MAX_CENTS
  );
}
