import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { apiKeys, practices } from "@openpims/db";
import { z } from "zod";
import { API_SCOPES, generateApiKey } from "@/lib/api-auth";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const adminProcedure = protectedProcedure.use(requireRole("admin"));

const publicApiKey = {
  id: apiKeys.id,
  name: apiKeys.name,
  keyPrefix: apiKeys.keyPrefix,
  scopes: apiKeys.scopes,
  lastUsedAt: apiKeys.lastUsedAt,
  createdAt: apiKeys.createdAt,
};

function uniqueScopes(scopes: string[]) {
  return new Set(scopes).size === scopes.length;
}

export const apiKeysRouter = createRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select(publicApiKey)
      .from(apiKeys)
      .where(and(eq(apiKeys.practiceId, ctx.practiceId), isNull(apiKeys.deletedAt)))
      .orderBy(desc(apiKeys.createdAt));
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(128),
        scopes: z
          .array(z.enum(API_SCOPES))
          .min(1)
          .max(API_SCOPES.length)
          .refine(uniqueScopes, "API key scopes must be unique."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [practice] = await ctx.db
        .select({ id: practices.id })
        .from(practices)
        .where(and(eq(practices.id, ctx.practiceId), isNull(practices.deletedAt)))
        .limit(1);
      if (!practice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
      }

      const { raw, prefix, keyHash } = await generateApiKey();
      const [created] = await ctx.db
        .insert(apiKeys)
        .values({
          practiceId: ctx.practiceId,
          name: input.name,
          scopes: input.scopes,
          keyPrefix: prefix,
          keyHash,
        })
        .returning(publicApiKey);
      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "API key was not created",
        });
      }
      return { ...created, key: raw };
    }),

  revoke: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [revoked] = await ctx.db
        .update(apiKeys)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, input.id),
            eq(apiKeys.practiceId, ctx.practiceId),
            isNull(apiKeys.deletedAt),
          ),
        )
        .returning({ id: apiKeys.id });
      if (!revoked) {
        throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
      }
      return { success: true as const };
    }),
});
