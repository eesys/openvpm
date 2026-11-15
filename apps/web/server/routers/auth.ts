import { eq } from "drizzle-orm";
import { users } from "@openpims/db";
import { createRouter, protectedProcedure } from "../trpc";

export const authRouter = createRouter({
  me: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        practiceId: users.practiceId,
        avatarUrl: users.avatarUrl,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    return {
      ...user,
      emailVerified: Boolean(user?.emailVerifiedAt),
    };
  }),
});
