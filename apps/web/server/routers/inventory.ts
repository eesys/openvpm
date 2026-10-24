import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { products } from "@openpims/db";
import { z } from "zod";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const STOCK_MAX = 2_147_483_647;

const inventoryManager = protectedProcedure.use(
  requireRole("admin", "veterinarian", "technician", "front_desk"),
);

const threeDecimalPlaces = (value: number) =>
  Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6;

export const inventoryRouter = createRouter({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(products.practiceId, ctx.practiceId),
        isNull(products.deletedAt),
      );
      const [items, countResult] = await Promise.all([
        ctx.db
          .select()
          .from(products)
          .where(where)
          .orderBy(products.name, products.id)
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ count: sql<number>`count(*)` }).from(products).where(where),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  create: inventoryManager
    .input(
      z.object({
        name: z.string().trim().min(1).max(255),
        unitPrice: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/),
        stockQuantity: z
          .number()
          .min(0)
          .max(STOCK_MAX)
          .refine(threeDecimalPlaces, "Use at most three decimal places.")
          .default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [product] = await ctx.db
        .insert(products)
        .values({
          practiceId: ctx.practiceId,
          name: input.name,
          unitPrice: input.unitPrice,
          inventoryTracked: true,
          stockQuantity: input.stockQuantity,
          reorderPoint: 10,
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

  adjustStock: inventoryManager
    .input(
      z.object({
        id: z.string().uuid(),
        adjustment: z
          .number()
          .min(-STOCK_MAX)
          .max(STOCK_MAX)
          .refine(
            (value) => value !== 0 && threeDecimalPlaces(value),
            "Use a nonzero quantity with at most three decimal places.",
          ),
        reason: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [current] = await ctx.db
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
            isNull(products.deletedAt),
          ),
        )
        .limit(1);
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
      }
      if (!current.inventoryTracked) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Start stock tracking with a reviewed opening quantity before recording adjustments.",
        });
      }
      const next = current.stockQuantity + input.adjustment;
      if (next < 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Stock adjustment would make quantity negative.",
        });
      }
      if (next > STOCK_MAX) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Stock adjustment would exceed the maximum stock quantity.",
        });
      }

      const [product] = await ctx.db
        .update(products)
        .set({
          stockQuantity: sql`${products.stockQuantity} + ${input.adjustment}`,
        })
        .where(
          and(
            eq(products.id, input.id),
            eq(products.practiceId, ctx.practiceId),
            eq(products.inventoryTracked, true),
            isNull(products.deletedAt),
            sql`${products.stockQuantity} + ${input.adjustment} >= 0`,
            sql`${products.stockQuantity} + ${input.adjustment} <= ${STOCK_MAX}`,
          ),
        )
        .returning();
      if (!product) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Stock adjustment would move quantity outside the allowed stock range.",
        });
      }
      return product;
    }),
});
