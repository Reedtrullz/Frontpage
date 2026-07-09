import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { isOwnerUser } from "@/lib/authz";

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
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ],
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
