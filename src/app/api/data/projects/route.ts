import { auth } from "@/auth";
import { isOwnerSession } from "@/lib/adminAuth";
import { saveProjects } from "@/lib/data";
import { syncToGithub } from "@/lib/github";
import { NextResponse } from "next/server";

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isOwnerSession(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  saveProjects(body);

  const synced = await syncToGithub([
    {
      path: "public/data/projects.json",
      content: JSON.stringify(body, null, 2),
    },
  ]);

  return NextResponse.json({ ok: true, synced });
}
