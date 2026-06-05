import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveProjects } from "@/lib/data";
import { syncToGithub } from "@/lib/github";
import { z } from "zod";

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

const httpUrlSchema = z
  .string()
  .refine(isValidHttpUrl, "Must be a valid http/https URL.");

const projectSchema = z.object({
  slug: z.string(),
  name: z.string(),
  shortDescription: z.string(),
  longDescription: z.string(),
  tags: z.array(z.string()),
  techStack: z.array(z.string()),
  status: z.enum(["active", "in-progress", "completed", "paused"]),
  category: z.enum(["defi", "bot", "frontend", "tooling", "infra", "wiki"]),
  repoUrl: httpUrlSchema.optional(),
  liveUrl: httpUrlSchema.optional(),
  featured: z.boolean(),
});

const projectsSchema = z.array(projectSchema);

function formatIssuePath(path: Array<string | number | symbol>): string {
  if (path.length === 0) {
    return "request body";
  }

  let formattedPath = "projects";

  for (const segment of path) {
    if (typeof segment === "number") {
      formattedPath += `[${segment}]`;
      continue;
    }

    formattedPath += `.${String(segment)}`;
  }

  return formattedPath;
}

function validateProjects(body: unknown): string | null {
  const result = projectsSchema.safeParse(body);

  if (result.success) {
    return null;
  }

  const message = result.error.issues
    .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
    .join("; ");

  return message;
}

export async function PUT(req: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerGitHubId = process.env.OWNER_GITHUB_ID;
  const ownerEmail = process.env.OWNER_EMAIL;
  const isOwner = Boolean(
    user &&
      ((ownerGitHubId && user.id && String(user.id) === ownerGitHubId) ||
        (ownerEmail && user.email && user.email === ownerEmail)),
  );
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const validationError = validateProjects(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  saveProjects(body);

  const synced = await syncToGithub([
    {
      path: "public/data/projects.json",
      content: JSON.stringify(body, null, 2),
    },
  ]);

  return NextResponse.json({ ok: true, synced });
}
