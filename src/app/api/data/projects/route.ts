import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";
import { saveProjectsDraft } from "@/lib/content/drafts";

function validationMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = ["projects", ...issue.path].map(String).join(".");
      return `${path}: ${issue.message}`;
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
    const draft = saveProjectsDraft(await request.json(), {
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
    if (error instanceof Error && /duplicate project/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to save projects draft", error);
    return NextResponse.json(
      { error: "The projects draft could not be saved." },
      { status: 500 },
    );
  }
}
