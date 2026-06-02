import { auth } from "@/auth";
import { isOwnerSession } from "@/lib/adminAuth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isProtectedPath = req.nextUrl.pathname.startsWith("/admin") || req.nextUrl.pathname === "/ansible";
  if (!isProtectedPath) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const signInUrl = new URL("/api/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (!isOwnerSession(req.auth)) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/ansible"],
};
