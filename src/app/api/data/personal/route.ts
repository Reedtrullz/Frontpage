import { NextResponse } from "next/server";
import { z } from "zod";
import { readOwnerMutationJson, OwnerRequestError } from "@/lib/owner-request";
import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";
import {
  DraftConflictError,
  discardPersonalDraft,
  savePersonalDraft,
} from "@/lib/content/drafts";

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
    const input = z.object({content: z.unknown(), expectedRevision: z.string().uuid().nullable()}).strict().parse(await readOwnerMutationJson(request));
    const draft = savePersonalDraft(input.content, {
      baseVersion: process.env.VERSION || "dev",
      expectedRevision: input.expectedRevision,
    });
    return NextResponse.json({
      ok: true,
      state: "draft-saved",
      savedAt: draft.savedAt,
      revision: draft.revision,
    });
  } catch (error) {
    if (error instanceof DraftConflictError) return NextResponse.json({error: error.message, code: error.code, revision: error.latestRevision}, {status: 409});
    if (error instanceof OwnerRequestError) return NextResponse.json({error: error.message}, {status: error.status});
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: validationMessage(error) },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    console.error("Failed to save personal draft", error instanceof Error ? error.name : "Error");
    return NextResponse.json(
      { error: "The personal draft could not be saved." },
      { status: 500 },
    );
  }
}

export async function DELETE(request?: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isOwnerUser(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const input = z.object({expectedRevision: z.string().uuid().nullable()}).strict().parse(await readOwnerMutationJson(request));
    discardPersonalDraft(undefined, input.expectedRevision);
    return NextResponse.json({ok: true, state: 'discarded'});
  } catch (error) {
    if (error instanceof DraftConflictError) return NextResponse.json({error:error.message,code:error.code,revision:error.latestRevision},{status:409});
    if (error instanceof OwnerRequestError) return NextResponse.json({error:error.message},{status:error.status});
    return NextResponse.json({error:'The saved draft could not be discarded.'},{status:error instanceof z.ZodError?400:500});
  }
}
