import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";
import { savePersonal } from "@/lib/data";
import { syncToGithub } from "@/lib/github";

const httpUrlSchema = z.string().superRefine((value, ctx) => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        message: "Only http:// and https:// are allowed.",
      });
    }
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Invalid URL.",
    });
  }
});

const personalSchema = z.object({
  name: z.string(),
  title: z.string(),
  location: z.string(),
  bio: z.string(),
  whatIDo: z.array(z.string()),
  skills: z.array(z.string()),
  socials: z.array(
    z.object({
      label: z.string(),
      url: httpUrlSchema,
    }),
  ),
});

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path
        .map((part) => (typeof part === "number" ? `[${part}]` : String(part)))
        .join(".")
        .replaceAll(".[", "[");

      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export async function PUT(req: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isOwnerUser(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const validationResult = personalSchema.safeParse(body);
  if (!validationResult.success) {
    return NextResponse.json({ error: formatZodError(validationResult.error) }, { status: 400 });
  }

  savePersonal(validationResult.data);

  const synced = await syncToGithub([
    {
      path: "public/data/personal.json",
      content: JSON.stringify(validationResult.data, null, 2),
    },
  ]);

  return NextResponse.json({ ok: true, synced });
}
