import { initTRPC, TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@openpims/db/client";
import type { Database } from "@openpims/db/client";
import { practices, users } from "@openpims/db";
import { authOptions } from "@/lib/auth";
import { sessionVersionIsCurrent } from "@/lib/session-version";

type UserRole =
  | "admin"
  | "veterinarian"
  | "technician"
  | "front_desk"
  | "viewer";

interface AppSession extends Session {
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    practiceId: string;
    sessionVersion?: number;
  };
}

export type TRPCContext = {
  db: Database;
  session: AppSession | null;
};

async function activeSessionOrNull(
  session: AppSession | null,
): Promise<AppSession | null> {
  if (!session?.user?.id || !session.user.practiceId) return null;

  const [activeUser] = await db
    .select({
      id: users.id,
      role: users.role,
      sessionVersion: users.sessionVersion,
    })
    .from(users)
    .innerJoin(
      practices,
      and(eq(practices.id, users.practiceId), isNull(practices.deletedAt)),
    )
    .where(
      and(
        eq(users.id, session.user.id),
        eq(users.practiceId, session.user.practiceId),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  if (
    !activeUser ||
    !sessionVersionIsCurrent(session.user.sessionVersion, activeUser.sessionVersion)
  ) {
    return null;
  }

  return {
    ...session,
    user: {
      ...session.user,
      role: activeUser.role,
    },
  };
}

export async function createTRPCContext(): Promise<TRPCContext> {
  const rawSession = (await getServerSession(authOptions)) as AppSession | null;
  return {
    db,
    session: await activeSessionOrNull(rawSession),
  };
}

const t = initTRPC.context<TRPCContext>().create();

export const createRouter = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next, type }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (type === "mutation" && ctx.session.user.role === "viewer") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your account has read-only (viewer) access.",
    });
  }
  return next({
    ctx: {
      session: ctx.session,
      user: ctx.session.user,
      practiceId: ctx.session.user.practiceId,
    },
  });
});
