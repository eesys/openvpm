import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@openpims/db/client";
import { users } from "@openpims/db";
import { nextAuthSecret } from "@/lib/auth-secret";

type StaffRole =
  | "admin"
  | "veterinarian"
  | "technician"
  | "front_desk"
  | "viewer";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: StaffRole;
      practiceId: string;
      sessionVersion?: number;
    };
  }
  interface User {
    id: string;
    email: string;
    name: string;
    role: StaffRole;
    practiceId: string;
    sessionVersion: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: StaffRole;
    practiceId: string;
    sessionVersion?: number;
  }
}

function parseLoginCredentials(
  credentials: Record<"email" | "password", string> | undefined,
): { email: string; password: string } | null {
  const email = credentials?.email?.trim().toLowerCase();
  const password = credentials?.password;
  if (!email || !email.includes("@") || !password) return null;
  return { email, password };
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = parseLoginCredentials(credentials);
        if (!parsed) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.email, parsed.email), isNull(users.deletedAt)))
          .limit(1);
        if (!user) return null;

        const passwordMatches = await compare(parsed.password, user.passwordHash);
        if (!passwordMatches) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          practiceId: user.practiceId,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.practiceId = user.practiceId;
        token.sessionVersion = user.sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.practiceId = token.practiceId;
      session.user.sessionVersion = token.sessionVersion;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: nextAuthSecret(),
};
