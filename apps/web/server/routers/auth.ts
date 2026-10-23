import { randomBytes } from "node:crypto";
import { compare, hashSync } from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { sessions, users } from "@openpims/db";
import { z } from "zod";
import {
  createRouter,
  protectedProcedure,
  publicProcedure,
  sessionCookie,
} from "../trpc";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = hashSync("not-the-password", 12);

const loginInput = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(255)
    .transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(128),
});

export const authRouter = createRouter({
  login: publicProcedure.input(loginInput).mutation(async ({ ctx, input }) => {
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
      .limit(1);

    const passwordMatches = await compare(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordMatches) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid email or password",
      });
    }

    const sessionToken = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + SESSION_TTL_MS);
    await ctx.db.insert(sessions).values({
      sessionToken,
      userId: user.id,
      expires,
    });
    ctx.resHeaders.append("set-cookie", sessionCookie(sessionToken, expires));

    return { practiceId: user.practiceId };
  }),

  me: protectedProcedure.query(({ ctx }) => {
    return {
      id: ctx.session.user.id,
      email: ctx.session.user.email,
      name: ctx.session.user.name,
      role: ctx.session.user.role,
      practiceId: ctx.session.user.practiceId,
    };
  }),
});
