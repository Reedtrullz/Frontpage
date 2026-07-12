import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { isOwnerUser } from "@/lib/authz";

function isLoopbackAuthUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function getProviders() {
  const providers: Provider[] = [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ];

  const testToken = process.env.FRONTPAGE_E2E_OWNER_TOKEN;
  if (process.env.FRONTPAGE_E2E_OWNER !== "1" || !testToken || !isLoopbackAuthUrl(process.env.AUTH_URL)) {
    return providers;
  }

  providers.push(
    Credentials({
      id: "e2e-owner",
      name: "E2E owner",
      credentials: {
        token: { label: "Test token", type: "password" },
      },
      authorize(credentials) {
        if (credentials?.token !== testToken) return null;

        return {
          id: process.env.OWNER_GITHUB_ID || "e2e-owner",
          email: "owner@example.test",
          name: "E2E Owner",
        };
      },
    }),
  );

  return providers;
}

function getGitHubProfileId(profile: unknown): string | undefined {
  if (!profile || typeof profile !== "object" || !("id" in profile)) {
    return undefined;
  }

  const { id } = profile as { id?: unknown };
  if (typeof id === "string" || typeof id === "number") {
    return String(id);
  }

  return undefined;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  providers: getProviders(),
  callbacks: {
    jwt({ token, profile }) {
      const githubProfileId = getGitHubProfileId(profile);
      if (githubProfileId) {
        token.githubId = githubProfileId;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const githubId = typeof token.githubId === "string" ? token.githubId : undefined;
        const subjectId = typeof token.sub === "string" ? token.sub : undefined;
        const sessionUserId = githubId ?? subjectId;
        if (sessionUserId) {
          session.user.id = sessionUserId;
        }
      }

      return session;
    },
    authorized({ auth }) {
      const user = auth?.user;
      if (!user) return false;

      return isOwnerUser(user);
    },
  },
  trustHost: true,
});
