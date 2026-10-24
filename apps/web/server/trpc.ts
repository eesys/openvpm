import { TRPCError, initTRPC } from "@trpc/server";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@openpims/db/client";
import { clients, portalSessions, practices, sessions, users } from "@openpims/db";

export const SESSION_COOKIE = "session_token";
export const PORTAL_SESSION_COOKIE = "portal_session";

const t = initTRPC.context<TRPCContext>().create();

export const createRouter = t.router;
export const publicProcedure = t.procedure;

const requireSession = t.middleware(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      session: ctx.session,
      practiceId: ctx.session.user.practiceId,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireSession);

const requirePortalSession = t.middleware(async ({ ctx, next }) => {
  const token = readCookie(ctx.req.headers.get("cookie"), PORTAL_SESSION_COOKIE);
  const portalClient = token ? await portalClientFromToken(token) : null;
  if (!portalClient) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { portalClient } });
});

export const portalProcedure = t.procedure.use(requirePortalSession);

type StaffRole =
  | "admin"
  | "veterinarian"
  | "technician"
  | "front_desk"
  | "viewer";

export function requireRole(...roles: StaffRole[]) {
  return t.middleware(({ ctx, next }) => {
    const role = ctx.session?.user.role;
    if (!role || !roles.includes(role)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next();
  });
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

export async function createTRPCContext(opts: {
  req: Request;
  resHeaders: Headers;
}) {
  const token = readSessionToken(opts.req.headers.get("cookie"));
  const session = token ? await sessionFromToken(token) : null;
  return {
    db,
    req: opts.req,
    resHeaders: opts.resHeaders,
    session,
  };
}

export function readSessionToken(cookieHeader: string | null): string | null {
  return readCookie(cookieHeader, SESSION_COOKIE);
}

function readCookie(cookieHeader: string | null, cookieName: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) {
      const value = rest.join("=");
      return value || null;
    }
  }
  return null;
}

export function sessionCookie(token: string, expires: Date): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Expires=${expires.toUTCString()}`;
}

async function sessionFromToken(token: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      practiceId: users.practiceId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(practices, eq(practices.id, users.practiceId))
    .where(
      and(
        eq(sessions.sessionToken, token),
        gt(sessions.expires, new Date()),
        isNull(users.deletedAt),
        isNull(practices.deletedAt),
      ),
    )
    .limit(1);

  return row ? { user: row } : null;
}

async function portalClientFromToken(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [row] = await db
    .select({
      id: clients.id,
      practiceId: clients.practiceId,
      firstName: clients.firstName,
      lastName: clients.lastName,
    })
    .from(portalSessions)
    .innerJoin(clients, eq(clients.id, portalSessions.clientId))
    .innerJoin(practices, eq(practices.id, portalSessions.practiceId))
    .where(
      and(
        eq(portalSessions.tokenHash, tokenHash),
        eq(clients.practiceId, portalSessions.practiceId),
        gt(portalSessions.expiresAt, new Date()),
        isNull(portalSessions.revokedAt),
        isNull(clients.deletedAt),
        isNull(practices.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
