import { NextResponse } from "next/server";
import {z} from "zod";
import {readOwnerMutationJson,OwnerRequestError} from "@/lib/owner-request";
import {findPublicationIntent} from "@/lib/content/publication-intents";
import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";
import { getCanonicalPersonal, getCanonicalProjects } from "@/lib/content";
import { readDraftBundle } from "@/lib/content/drafts";
import {
  publishCanonicalContent,
  summarizePublicationError,
} from "@/lib/content/publication";
import { createGitHubPublicationClient } from "@/lib/github";

export async function POST(request?: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isOwnerUser(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const input = z.object({reviewedRevisions:z.object({personal:z.string().uuid().nullable(),projects:z.string().uuid().nullable()}).strict()}).strict().parse(await readOwnerMutationJson(request));
    const drafts = readDraftBundle();
    const existingIntent = findPublicationIntent(input.reviewedRevisions);
    if (!drafts.personal && !drafts.projects && !existingIntent) {
      return NextResponse.json(
        { error: "There is no saved draft to publish.", state: "clean" },
        { status: 409 },
      );
    }

    const baseVersions = new Set(
      [drafts.personal?.baseVersion, drafts.projects?.baseVersion].filter(
        (value): value is string => Boolean(value),
      ),
    );
    if (baseVersions.size !== 1 && !existingIntent) {
      return NextResponse.json(
        {
          error: "Drafts were saved from different deployed versions. Refresh and save again.",
          state: "conflict",
        },
        { status: 409 },
      );
    }

    const client = createGitHubPublicationClient();
    if (!client) {
      return NextResponse.json(
        {
          error: "GitHub publication is not configured.",
          state: "publish-failed",
        },
        { status: 503 },
      );
    }

    const result = await publishCanonicalContent(
      {
        personal: drafts.personal?.content ?? getCanonicalPersonal(),
        projects: drafts.projects?.content ?? getCanonicalProjects(),
        baseVersion: existingIntent?.baseSha ?? [...baseVersions][0],
        reviewedRevisions: input.reviewedRevisions,
      },
      client,
    );

    if (result.kind === "published" || result.kind === "published-recovery-pending") {
      return NextResponse.json({
        ok: true,
        state: result.kind === "published" ? "awaiting-deploy" : "published-recovery-pending",
        ...("message" in result ? {message: result.message} : {}),
        commitSha: result.commitSha,
        commitUrl: result.commitUrl,
      });
    }

    return NextResponse.json(
      { error: result.message, state: result.kind },
      { status: result.kind === "conflict" ? 409 : 502 },
    );
  } catch (error) {
    if (error instanceof OwnerRequestError) return NextResponse.json({error:error.message},{status:error.status});
    if (error instanceof z.ZodError) return NextResponse.json({error:"Invalid reviewed publication request."},{status:400});
    console.error(
      "Failed to publish content",
      summarizePublicationError(error),
    );
    return NextResponse.json(
      { error: "Content publication could not be completed.", state: "publish-failed" },
      { status: 500 },
    );
  }
}
