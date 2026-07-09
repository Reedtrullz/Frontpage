import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";
import { NextResponse } from "next/server";

export const proxy = auth((req) => {
  const isProtectedRoute =
    req.nextUrl.pathname.startsWith("/admin") ||
    req.nextUrl.pathname === "/ansible";

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  if (!isOwnerUser(req.auth?.user)) {
    const signInUrl = new URL("/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/ansible"],
};
