import { NextResponse } from "next/server";
import { getCanonicalPersonal, getCanonicalProjects } from "@/lib/content";

export function GET() {
  return NextResponse.json(
    {
      personal: getCanonicalPersonal(),
      projects: getCanonicalProjects(),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
