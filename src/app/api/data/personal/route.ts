import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { savePersonal } from "@/lib/data";
import { syncToGithub } from "@/lib/github";

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function validatePersonalUrls(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;

  const socials = (body as { socials?: Array<{ url?: unknown }> }).socials;
  if (!Array.isArray(socials)) return null;

  for (let index = 0; index < socials.length; index += 1) {
    const url = socials[index]?.url;
    if (typeof url === "string" && !isValidUrl(url)) {
      return `Invalid URL for socials[${index}].url. Only http:// and https:// are allowed.`;
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
  const validationError = validatePersonalUrls(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  savePersonal(body);

  const synced = await syncToGithub([
    {
      path: "public/data/personal.json",
      content: JSON.stringify(body, null, 2),
    },
  ]);

  return NextResponse.json({ ok: true, synced });
}
