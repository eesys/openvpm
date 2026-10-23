import { TRPCError, initTRPC } from "@trpc/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@openpims/db/client";
import { practices, sessions, users } from "@openpims/db";

export const SESSION_COOKIE = "session_token";

const t = initTRPC.context<TRPCContext>().create();

export const createRouter = t.router;
export const publicProcedure = t.procedure;

const requireSession = t.middleware(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { session: ctx.session } });
});

export const protectedProcedure = t.procedure.use(requireSession);

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
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
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
