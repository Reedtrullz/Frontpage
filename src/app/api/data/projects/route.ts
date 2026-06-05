import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveProjects } from "@/lib/data";
import { syncToGithub } from "@/lib/github";

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function validateProjectUrls(body: unknown): string | null {
  if (!Array.isArray(body)) return null;

  for (let projectIndex = 0; projectIndex < body.length; projectIndex += 1) {
    const project = body[projectIndex] as {
      repoUrl?: unknown;
      liveUrl?: unknown;
      socials?: Array<{ url?: unknown }>;
    };

    if (typeof project?.repoUrl === "string" && !isValidUrl(project.repoUrl)) {
      return `Invalid URL for projects[${projectIndex}].repoUrl. Only http:// and https:// are allowed.`;
    }

    if (typeof project?.liveUrl === "string" && !isValidUrl(project.liveUrl)) {
      return `Invalid URL for projects[${projectIndex}].liveUrl. Only http:// and https:// are allowed.`;
    }

    if (Array.isArray(project?.socials)) {
      for (let socialIndex = 0; socialIndex < project.socials.length; socialIndex += 1) {
        const url = project.socials[socialIndex]?.url;
        if (typeof url === "string" && !isValidUrl(url)) {
          return `Invalid URL for projects[${projectIndex}].socials[${socialIndex}].url. Only http:// and https:// are allowed.`;
        }
      }
    }
  }

  return null;
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
  const validationError = validateProjectUrls(body);
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
