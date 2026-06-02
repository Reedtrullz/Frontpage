import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

type GitHubProfile = {
  login?: unknown;
  id?: unknown;
};

type TokenWithGitHubIdentity = {
  githubLogin?: string;
  githubId?: string;
};

type SessionUserWithGitHubIdentity = {
  githubLogin?: string;
  githubId?: string;
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    jwt({ token, profile }) {
      const githubProfile = profile as GitHubProfile | undefined;
      const tokenWithGitHubIdentity = token as typeof token & TokenWithGitHubIdentity;

      if (typeof githubProfile?.login === "string") {
        tokenWithGitHubIdentity.githubLogin = githubProfile.login;
      }
      if (typeof githubProfile?.id === "number" || typeof githubProfile?.id === "string") {
        tokenWithGitHubIdentity.githubId = String(githubProfile.id);
      }
      return token;
    },
    session({ session, token }) {
      const tokenWithGitHubIdentity = token as typeof token & TokenWithGitHubIdentity;
      const sessionUser = session.user as (typeof session.user & SessionUserWithGitHubIdentity) | undefined;

      if (sessionUser && typeof tokenWithGitHubIdentity.githubLogin === "string") {
        sessionUser.githubLogin = tokenWithGitHubIdentity.githubLogin;
      }
      if (sessionUser && typeof tokenWithGitHubIdentity.githubId === "string") {
        sessionUser.githubId = tokenWithGitHubIdentity.githubId;
      }
      return session;
    },
  },
  trustHost: true,
});
