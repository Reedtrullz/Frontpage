import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { isOwnerUser } from "@/lib/authz";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ],
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
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
