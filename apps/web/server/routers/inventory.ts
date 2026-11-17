import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  inventoryStockAdjustments,
  practices,
  products,
} from "@openpims/db";
import type { Database } from "@openpims/db/client";
import {
  INVENTORY_ADJUSTMENT_REASON_MAX_LENGTH,
  INVENTORY_PRODUCT_CATEGORY_MAX_LENGTH,
  INVENTORY_PRODUCT_LOT_NUMBER_MAX_LENGTH,
  INVENTORY_PRODUCT_NAME_MAX_LENGTH,
  INVENTORY_PRODUCT_SEARCH_MAX_LENGTH,
  INVENTORY_PRODUCT_SKU_MAX_LENGTH,
  INVENTORY_STOCK_QUANTITY_MAX,
  isInventoryCurrencyAmountInputValid,
} from "@/lib/inventory/policy";
import { isSupportedQuantity } from "@/lib/quantity";
import { createRouter, protectedProcedure, requireRole } from "../trpc";
import { listOffsetInput } from "./pagination";

const moneyInput = z
  .string()
  .trim()
  .refine(
    isInventoryCurrencyAmountInputValid,
    "Amount must be a valid currency amount.",
  );

const requiredTrimmedString = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);

const optionalTrimmedString = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .optional();

const stockQuantityInput = z
  .number()
  .min(0)
  .max(INVENTORY_STOCK_QUANTITY_MAX)
  .refine(isSupportedQuantity, "Use at most three decimal places.");

const reorderPointInput = z
  .number()
  .int()
  .min(0)
  .max(INVENTORY_STOCK_QUANTITY_MAX);

const expirationDateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiration date must be a valid YYYY-MM-DD date.");

const productCreateInput = z.object({
  name: requiredTrimmedString("Product name", INVENTORY_PRODUCT_NAME_MAX_LENGTH),
  sku: optionalTrimmedString("SKU", INVENTORY_PRODUCT_SKU_MAX_LENGTH),
  category: optionalTrimmedString("Category", INVENTORY_PRODUCT_CATEGORY_MAX_LENGTH),
  unitPrice: moneyInput,
  taxable: z.boolean().default(true),
  costPrice: moneyInput.optional(),
  stockQuantity: stockQuantityInput.default(0),
  reorderPoint: reorderPointInput.default(10),
  lotNumber: optionalTrimmedString(
    "Lot number",
    INVENTORY_PRODUCT_LOT_NUMBER_MAX_LENGTH,
  ),
  expirationDate: expirationDateInput.optional(),
});

function activePracticePredicate(practiceId: string) {
  return sql`exists (
    select 1
    from ${practices}
    where ${practices.id} = ${practiceId}
      and ${practices.deletedAt} is null
  )`;
}

const inventoryManagerProcedure = protectedProcedure.use(
  requireRole("admin", "veterinarian", "technician", "front_desk"),
);
const productPricingProcedure = protectedProcedure.use(
  requireRole("admin", "front_desk"),
);

export const inventoryRouter = createRouter({
  getById: protectedProcedure
    .input(z.object({ id: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      const [product] = await ctx.db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, input.id),
            eq(products.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
            isNull(products.deletedAt),
          ),
        )
        .limit(1);
      if (!product) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Inventory item not found.",
        });
      }
      return product;
    }),

  list: protectedProcedure
    .input(
      z.object({
        search: z
          .string()
          .trim()
          .max(INVENTORY_PRODUCT_SEARCH_MAX_LENGTH)
          .optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: listOffsetInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(products.practiceId, ctx.practiceId),
        activePracticePredicate(ctx.practiceId),
        isNull(products.deletedAt),
      ];
      if (input.search) {
        conditions.push(
          sql`(${ilike(products.name, `%${input.search}%`)} OR ${ilike(products.sku, `%${input.search}%`)})`,
        );
      }
      const [items, countResult] = await Promise.all([
        ctx.db
          .select()
          .from(products)
          .where(and(...conditions))
          .orderBy(asc(products.name), asc(products.id))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(products)
          .where(and(...conditions)),
      ]);
      return {
        items,
        total: Number(countResult[0]?.count ?? 0),
      };
    }),

  create: productPricingProcedure
    .input(productCreateInput)
    .mutation(async ({ ctx, input }) => {
      const [product] = await ctx.db
        .insert(products)
        .values({
          practiceId: ctx.practiceId,
          name: input.name,
          sku: input.sku ?? null,
          category: input.category ?? null,
          unitPrice: input.unitPrice,
          taxable: input.taxable,
          costPrice: input.costPrice ?? null,
          inventoryTracked: true,
          stockQuantity: input.stockQuantity,
          reorderPoint: input.reorderPoint,
          lotNumber: input.lotNumber ?? null,
          expirationDate: input.expirationDate ?? null,
        })
        .returning();
      if (!product) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Product could not be created",
        });
      }
      return product;
    }),

  adjustStock: inventoryManagerProcedure
    .input(
      z.object({
        id: z.string().guid(),
        adjustment: z
          .number()
          .min(-INVENTORY_STOCK_QUANTITY_MAX)
          .max(INVENTORY_STOCK_QUANTITY_MAX)
          .refine(
            (value) => value !== 0 && isSupportedQuantity(value),
            "Use a nonzero quantity with at most three decimal places.",
          ),
        reason: z
          .string()
          .trim()
          .min(1, "Reason is required.")
          .max(INVENTORY_ADJUSTMENT_REASON_MAX_LENGTH),
        operationId: z.string().guid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const operationId = input.operationId ?? randomUUID();
      return ctx.db.transaction(async (tx) => {
        const db = tx as unknown as Database;
        const [current] = await db
          .select({
            id: products.id,
            inventoryTracked: products.inventoryTracked,
            stockQuantity: products.stockQuantity,
          })
          .from(products)
          .where(
            and(
              eq(products.id, input.id),
              eq(products.practiceId, ctx.practiceId),
              activePracticePredicate(ctx.practiceId),
              isNull(products.deletedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!current) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
        }

        const [existing] = await db
          .select({
            productId: inventoryStockAdjustments.productId,
            adjustment: inventoryStockAdjustments.adjustment,
            reason: inventoryStockAdjustments.reason,
          })
          .from(inventoryStockAdjustments)
          .where(
            and(
              eq(inventoryStockAdjustments.practiceId, ctx.practiceId),
              eq(inventoryStockAdjustments.operationId, operationId),
            ),
          )
          .limit(1);
        if (existing) {
          if (
            existing.productId !== input.id ||
            existing.adjustment !== input.adjustment ||
            existing.reason !== input.reason
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This stock adjustment was already recorded with different details. Refresh and review stock before adjusting again.",
            });
          }
          const [product] = await db
            .select()
            .from(products)
            .where(eq(products.id, current.id))
            .limit(1);
          return product!;
        }

        if (current.inventoryTracked === false) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Start stock tracking with a reviewed opening quantity before recording adjustments.",
          });
        }
        const nextQuantity = current.stockQuantity + input.adjustment;
        if (nextQuantity < 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Stock adjustment would make quantity negative.",
          });
        }
        if (nextQuantity > INVENTORY_STOCK_QUANTITY_MAX) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Stock adjustment would exceed the maximum stock quantity.",
          });
        }

        const [product] = await db
          .update(products)
          .set({
            stockQuantity: sql`${products.stockQuantity} + ${input.adjustment}`,
          })
          .where(
            and(
              eq(products.id, current.id),
              eq(products.practiceId, ctx.practiceId),
              eq(products.inventoryTracked, true),
              isNull(products.deletedAt),
              sql`${products.stockQuantity} + ${input.adjustment} >= 0`,
              sql`${products.stockQuantity} + ${input.adjustment} <= ${INVENTORY_STOCK_QUANTITY_MAX}`,
            ),
          )
          .returning();
        if (!product) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Stock adjustment would move quantity outside the allowed stock range.",
          });
        }
        await db.insert(inventoryStockAdjustments).values({
          practiceId: ctx.practiceId,
          productId: product.id,
          operationId,
          adjustment: input.adjustment,
          quantityAfter: product.stockQuantity,
          reason: input.reason,
          adjustedBy: ctx.user.id,
        });
        return product;
      });
    }),
});
