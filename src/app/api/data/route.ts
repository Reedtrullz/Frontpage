import { NextResponse } from "next/server";
import { getPersonal, getProjects } from "@/lib/data";

export function GET() {
  return NextResponse.json({
    personal: getPersonal(),
    projects: getProjects(),
  });
}
