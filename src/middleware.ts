import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isProtectedRoute = req.nextUrl.pathname.startsWith("/admin") || req.nextUrl.pathname === "/ansible";
  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  const user = req.auth?.user;
  const ownerGitHubId = process.env.OWNER_GITHUB_ID;
  const ownerEmail = process.env.OWNER_EMAIL;

  const isOwner = Boolean(
    user &&
      ((ownerGitHubId && user.id && String(user.id) === ownerGitHubId) ||
        (ownerEmail && user.email && user.email === ownerEmail)),
  );

  if (!isOwner) {
    const signInUrl = new URL("/api/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/ansible"],
};
