import { z } from "zod";

const utcDateTimeSchema = z.string().superRefine((value, ctx) => {
  if (!value.endsWith("Z") || Number.isNaN(Date.parse(value))) {
    ctx.addIssue({
      code: "custom",
      message: "Must be a valid UTC timestamp ending in Z.",
    });
  }
});

const httpUrlSchema = z.string().superRefine((value, ctx) => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      ctx.addIssue({ code: "custom", message: "Must use http or https." });
    }
    if (parsed.username || parsed.password) {
      ctx.addIssue({
        code: "custom",
        message: "Public URLs must not contain credentials.",
      });
    }
  } catch {
    ctx.addIssue({ code: "custom", message: "Must be a valid http URL." });
  }
});

const uniqueStrings = (values: string[], ctx: z.RefinementCtx) => {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({ code: "custom", message: "Values must be unique." });
  }
};

export const lifecycleSchema = z.enum([
  "active",
  "maintained",
  "paused",
  "archived",
]);

export const maturitySchema = z.enum([
  "flagship",
  "stable",
  "experimental",
  "reference",
]);

export const evidenceLevelSchema = z.enum([
  "source-reviewed",
  "ci-verified",
  "live-verified",
]);

export const projectCategorySchema = z.enum([
  "defi",
  "bot",
  "frontend",
  "tooling",
  "infra",
  "wiki",
]);

const projectMediaItemSchema = z
  .object({
    src: z.string().startsWith("/projects/"),
    alt: z.string().trim().min(8).max(240),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    caption: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export const projectMediaSchema = z
  .object({
    cover: projectMediaItemSchema,
    gallery: z.array(projectMediaItemSchema).max(8).optional(),
  })
  .strict();

export const projectEvidenceSchema = z
  .object({
    reviewedAt: utcDateTimeSchema,
    level: evidenceLevelSchema,
    commitSha: z.string().regex(/^[a-f0-9]{7,40}$/).optional(),
    url: httpUrlSchema.optional(),
    note: z.string().trim().min(8).max(320),
  })
  .strict();

export const projectSectionsSchema = z
  .object({
    whatItSolves: z.array(z.string().trim().min(1)).min(1).max(4),
    currentState: z.array(z.string().trim().min(1)).min(1).max(4),
    howItWorks: z.array(z.string().trim().min(1)).min(1).max(4),
    nextPriorities: z.array(z.string().trim().min(1)).max(6).optional(),
  })
  .strict();

export const projectSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be a URL-safe slug."),
    name: z.string().trim().min(1).max(100),
    outcome: z.string().trim().min(8).max(180),
    shortDescription: z.string().trim().min(8).max(360),
    longDescription: z.string().trim().min(8).max(4000),
    lifecycle: lifecycleSchema,
    maturity: maturitySchema,
    category: projectCategorySchema,
    tags: z.array(z.string().trim().min(1).max(48)).max(24).superRefine(uniqueStrings),
    techStack: z
      .array(z.string().trim().min(1).max(64))
      .max(24)
      .superRefine(uniqueStrings),
    featuredRank: z.number().int().positive().max(99).optional(),
    repoUrl: httpUrlSchema.optional(),
    liveUrl: httpUrlSchema.optional(),
    media: projectMediaSchema.optional(),
    healthServiceIds: z
      .array(z.string().trim().min(1).max(80))
      .max(16)
      .superRefine(uniqueStrings)
      .optional(),
    evidence: projectEvidenceSchema,
    sections: projectSectionsSchema,
    limitations: z.array(z.string().trim().min(1)).max(12).default([]),
  })
  .strict();

export const projectsSchema = z.array(projectSchema).min(1).max(128);

export const socialLinkSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    url: httpUrlSchema,
  })
  .strict();

export const personalSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(120),
    location: z.string().trim().min(1).max(120),
    bio: z.string().trim().min(8).max(720),
    whatIDo: z.array(z.string().trim().min(1)).min(1).max(12),
    skills: z.array(z.string().trim().min(1).max(64)).max(40).superRefine(uniqueStrings),
    socials: z.array(socialLinkSchema).max(12),
  })
  .strict();

export type ProjectLifecycle = z.infer<typeof lifecycleSchema>;
export type ProjectMaturity = z.infer<typeof maturitySchema>;
export type ProjectEvidenceLevel = z.infer<typeof evidenceLevelSchema>;
export type ProjectCategory = z.infer<typeof projectCategorySchema>;
export type ProjectMedia = z.infer<typeof projectMediaSchema>;
export type ProjectEvidence = z.infer<typeof projectEvidenceSchema>;
export type ProjectContent = z.infer<typeof projectSchema>;
export type PersonalContent = z.infer<typeof personalSchema>;
export type SocialLink = z.infer<typeof socialLinkSchema>;

export function parseProjects(input: unknown): ProjectContent[] {
  const projects = projectsSchema.parse(input);
  const slugs = new Set<string>();
  const names = new Set<string>();

  for (const project of projects) {
    if (slugs.has(project.slug)) {
      throw new Error(`Duplicate project slug: ${project.slug}`);
    }
    if (names.has(project.name.toLowerCase())) {
      throw new Error(`Duplicate project name: ${project.name}`);
    }
    slugs.add(project.slug);
    names.add(project.name.toLowerCase());
  }

  return projects;
}

export function parsePersonal(input: unknown): PersonalContent {
  return personalSchema.parse(input);
}
