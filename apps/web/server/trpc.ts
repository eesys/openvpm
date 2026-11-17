import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@openpims/db/client";
import type { Database } from "@openpims/db/client";
import { practices, users } from "@openpims/db";
import { authOptions } from "@/lib/auth";
import {
  portalSessionTokenFromCookie,
  resolvePortalSession,
  type PortalSessionClient,
} from "@/lib/portal/session";
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
  portalSessionToken?: string | null;
  portalClient?: PortalSessionClient;
  portalSessionId?: string;
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

export async function createTRPCContext(opts?: {
  req?: Request;
}): Promise<TRPCContext> {
  const rawSession = (await getServerSession(authOptions)) as AppSession | null;
  return {
    db,
    session: await activeSessionOrNull(rawSession),
    portalSessionToken: portalSessionTokenFromCookie(
      opts?.req?.headers.get("cookie"),
    ),
  };
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicProcedure = t.procedure;

export const portalProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const portalSession =
    ctx.portalClient && ctx.portalSessionId
      ? { client: ctx.portalClient, sessionId: ctx.portalSessionId }
      : await resolvePortalSession(ctx.db, ctx.portalSessionToken);
  if (!portalSession) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Portal session expired",
    });
  }
  return next({
    ctx: {
      ...ctx,
      portalClient: portalSession.client,
      portalSessionId: portalSession.sessionId,
    },
  });
});

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

export function requireRole(...roles: UserRole[]) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    if (!roles.includes(ctx.session.user.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires one of: ${roles.join(", ")}`,
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
}
