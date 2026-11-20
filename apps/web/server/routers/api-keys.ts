import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { apiKeys, practices } from "@openpims/db";
import type { Database } from "@openpims/db/client";
import {
  API_SCOPES,
  apiScopesHaveValidDependencies,
  generateApiKey,
} from "@/lib/api-auth";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const adminProcedure = protectedProcedure.use(requireRole("admin"));

function activePracticePredicate(practiceId: string) {
  return sql`exists (
    select 1
    from ${practices}
    where ${practices.id} = ${practiceId}
      and ${practices.deletedAt} is null
  )`;
}

async function assertActivePractice(db: Database, practiceId: string) {
  const [practice] = await db
    .select({ id: practices.id })
    .from(practices)
    .where(and(eq(practices.id, practiceId), isNull(practices.deletedAt)))
    .limit(1);
  if (!practice) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
  }
}

export const apiKeysRouter = createRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    await assertActivePractice(ctx.db, ctx.practiceId);
    return ctx.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.practiceId, ctx.practiceId),
          activePracticePredicate(ctx.practiceId),
          isNull(apiKeys.deletedAt),
        ),
      )
      .orderBy(desc(apiKeys.createdAt));
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        scopes: z
          .array(z.enum(API_SCOPES))
          .min(1)
          .max(API_SCOPES.length)
          .refine(
            (scopes) => new Set(scopes).size === scopes.length,
            "API key scopes must be unique.",
          )
          .refine(
            apiScopesHaveValidDependencies,
            "agent:write requires agent:run or *.",
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertActivePractice(ctx.db, ctx.practiceId);
      const { raw, prefix, hash } = await generateApiKey();
      const [created] = await ctx.db
        .insert(apiKeys)
        .values({
          practiceId: ctx.practiceId,
          name: input.name,
          scopes: input.scopes,
          keyPrefix: prefix,
          keyHash: hash,
        })
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          scopes: apiKeys.scopes,
          createdAt: apiKeys.createdAt,
        });
      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "API key was not created",
        });
      }
      return { ...created, key: raw };
    }),

  revoke: adminProcedure
    .input(z.object({ id: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const [revoked] = await ctx.db
        .update(apiKeys)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, input.id),
            eq(apiKeys.practiceId, ctx.practiceId),
            activePracticePredicate(ctx.practiceId),
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
