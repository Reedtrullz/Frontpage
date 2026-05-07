import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { savePersonal } from "@/lib/data";
import { syncToGithub } from "@/lib/github";

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  savePersonal(body);

  const synced = await syncToGithub([
    {
      path: "public/data/personal.json",
      content: JSON.stringify(body, null, 2),
    },
  ]);

  return NextResponse.json({ ok: true, synced });
}
