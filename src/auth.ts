import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ],
  callbacks: {
    authorized({ auth }) {
      const user = auth?.user;
      if (!user) return false;

      const ownerGitHubId = process.env.OWNER_GITHUB_ID;
      if (ownerGitHubId && user.id && String(user.id) === ownerGitHubId) {
        return true;
      }

      const ownerEmail = process.env.OWNER_EMAIL;
      if (ownerEmail && user.email && user.email === ownerEmail) {
        return true;
      }

      return false;
    },
  },
  trustHost: true,
});
