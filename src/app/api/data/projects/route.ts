import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveProjects } from "@/lib/data";
import { syncToGithub } from "@/lib/github";

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
