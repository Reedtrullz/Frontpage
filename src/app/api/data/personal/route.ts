import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";
import { savePersonalDraft } from "@/lib/content/drafts";

function validationMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isOwnerUser(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const draft = savePersonalDraft(await request.json(), {
      baseVersion: process.env.VERSION || "dev",
    });
    return NextResponse.json({
      ok: true,
      state: "draft-saved",
      savedAt: draft.savedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: validationMessage(error) },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    console.error("Failed to save personal draft", error);
    return NextResponse.json(
      { error: "The personal draft could not be saved." },
      { status: 500 },
    );
  }
}
