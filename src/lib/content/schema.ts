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

export const projectGallerySchema = z.array(projectMediaItemSchema).max(8);

const calendarDateSchema = z.string().superRefine((value, ctx) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    ctx.addIssue({ code: "custom", message: "Must be a valid calendar date (YYYY-MM-DD)." });
  }
});

export const projectMilestoneSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  occurredAt: calendarDateSchema,
  title: z.string().trim().min(4).max(120),
  summary: z.string().trim().min(8).max(320),
  scope: evidenceLevelSchema,
  evidenceUrl: httpUrlSchema,
  reviewedAt: utcDateTimeSchema,
  commitSha: z.string().regex(/^[a-f0-9]{7,40}$/).optional(),
}).strict();

export const projectMilestonesSchema = z.array(projectMilestoneSchema).max(20);

export const projectMediaSchema = z
  .object({
    cover: projectMediaItemSchema,
    gallery: projectGallerySchema.optional(),
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
    aliases: z.array(z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be a URL-safe slug.")).max(32).superRefine(uniqueStrings).optional(),
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
    milestones: projectMilestonesSchema.optional(),
    sections: projectSectionsSchema,
    limitations: z.array(z.string().trim().min(1)).max(12).default([]),
  })
  .strict();

export const projectsSchema = z.array(projectSchema).min(1).max(128);

export const publicRepositorySchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be a URL-safe slug."),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(8).max(360),
    repoUrl: httpUrlSchema,
    homepageUrl: httpUrlSchema.optional(),
    fork: z.boolean(),
    upstream: z
      .object({
        name: z.string().trim().min(1).max(100),
        repoUrl: httpUrlSchema,
      })
      .strict()
      .optional(),
    reviewedAt: utcDateTimeSchema,
  })
  .strict();

export const publicRepositoriesSchema = z
  .array(publicRepositorySchema)
  .max(64);

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

export const maintenanceWindowSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
    title: z.string().trim().min(4).max(120),
    description: z.string().trim().min(8).max(320),
    affectedServiceIds: z
      .array(z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80))
      .min(1)
      .max(16)
      .superRefine(uniqueStrings),
    startsAt: utcDateTimeSchema,
    endsAt: utcDateTimeSchema,
    status: z.enum(["planned", "active", "completed"]),
  })
  .strict();

export const maintenanceWindowsSchema = z.array(maintenanceWindowSchema).max(64);

export type ProjectLifecycle = z.infer<typeof lifecycleSchema>;
export type ProjectMaturity = z.infer<typeof maturitySchema>;
export type ProjectEvidenceLevel = z.infer<typeof evidenceLevelSchema>;
export type ProjectCategory = z.infer<typeof projectCategorySchema>;
export type ProjectMedia = z.infer<typeof projectMediaSchema>;
export type ProjectMilestone = z.infer<typeof projectMilestoneSchema>;
export type ProjectEvidence = z.infer<typeof projectEvidenceSchema>;
export type ProjectContent = z.infer<typeof projectSchema>;
export type PublicRepository = z.infer<typeof publicRepositorySchema>;
export type PersonalContent = z.infer<typeof personalSchema>;
export type SocialLink = z.infer<typeof socialLinkSchema>;
export type MaintenanceWindow = z.infer<typeof maintenanceWindowSchema>;

export class ProjectCatalogueValidationError extends Error {}

export function parseProjects(input: unknown): ProjectContent[] {
  const projects = projectsSchema.parse(input);
  const slugs = new Set<string>();
  const names = new Set<string>();
  const identifiers = new Map<string, string>();

  for (const project of projects) {
    const allSlugs = [project.slug, ...(project.aliases ?? [])];
    if (new Set(allSlugs).size !== allSlugs.length) throw new ProjectCatalogueValidationError(`Project ${project.slug} has duplicate or self-referential aliases.`);
    if ((project.milestones ?? []).some((milestone, index, milestones) => milestones.findIndex((item) => item.id === milestone.id) !== index)) throw new ProjectCatalogueValidationError(`Project ${project.slug} has duplicate milestone IDs.`);
    for (const slug of allSlugs) {
      const owner = identifiers.get(slug);
      if (owner) {
        if (owner === project.slug && slug === project.slug) throw new ProjectCatalogueValidationError(`Duplicate project slug: ${slug}`);
        throw new ProjectCatalogueValidationError(`Project slug or alias collision: ${slug} belongs to both ${owner} and ${project.slug}.`);
      }
      identifiers.set(slug, project.slug);
    }
    if (slugs.has(project.slug)) throw new ProjectCatalogueValidationError(`Duplicate project slug: ${project.slug}`);
    if (names.has(project.name.toLowerCase())) {
      throw new ProjectCatalogueValidationError(`Duplicate project name: ${project.name}`);
    }
    slugs.add(project.slug);
    names.add(project.name.toLowerCase());
  }

  return projects;
}

export type ProjectSlugResolution =
  | { kind: "current"; project: ProjectContent }
  | { kind: "redirect"; project: ProjectContent }
  | { kind: "not-found" };

export function resolveProjectSlug(slug: string, projects: readonly ProjectContent[]): ProjectSlugResolution {
  const current = projects.find((project) => project.slug === slug);
  if (current) return { kind: "current", project: current };
  const aliased = projects.find((project) => project.aliases?.includes(slug));
  return aliased ? { kind: "redirect", project: aliased } : { kind: "not-found" };
}

export function preserveProjectSlugAliases(project: ProjectContent, previousSlug: string): ProjectContent {
  if (!previousSlug || previousSlug === project.slug) return project;
  return { ...project, aliases: Array.from(new Set([...(project.aliases ?? []), previousSlug])) };
}

export function parsePublicRepositories(input: unknown): PublicRepository[] {
  const repositories = publicRepositoriesSchema.parse(input);
  const slugs = new Set<string>();
  const refs = new Set<string>();
  for (const repository of repositories) {
    if (slugs.has(repository.slug)) {
      throw new Error(`Duplicate public repository slug: ${repository.slug}`);
    }
    if (refs.has(repository.repoUrl.toLowerCase())) {
      throw new Error(`Duplicate public repository URL: ${repository.repoUrl}`);
    }
    slugs.add(repository.slug);
    refs.add(repository.repoUrl.toLowerCase());
  }
  return repositories;
}

export function parsePersonal(input: unknown): PersonalContent {
  return personalSchema.parse(input);
}

export function parseMaintenanceWindows(
  input: unknown,
  knownPublicServiceIds?: ReadonlySet<string>,
): MaintenanceWindow[] {
  const windows = maintenanceWindowsSchema.parse(input);
  const ids = new Set<string>();
  for (const window of windows) {
    if (ids.has(window.id)) throw new Error(`Duplicate maintenance id: ${window.id}`);
    ids.add(window.id);
    if (Date.parse(window.endsAt) <= Date.parse(window.startsAt)) {
      throw new Error(`Maintenance end must be after start: ${window.id}`);
    }
    for (const serviceId of window.affectedServiceIds) {
      if (knownPublicServiceIds && !knownPublicServiceIds.has(serviceId)) {
        throw new Error(`Unknown public service id: ${serviceId}`);
      }
    }
  }
  for (let leftIndex = 0; leftIndex < windows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < windows.length; rightIndex += 1) {
      const left = windows[leftIndex]!;
      const right = windows[rightIndex]!;
      const sharesService = left.affectedServiceIds.some((id) => right.affectedServiceIds.includes(id));
      const overlaps =
        Date.parse(left.startsAt) < Date.parse(right.endsAt) &&
        Date.parse(right.startsAt) < Date.parse(left.endsAt);
      if (sharesService && overlaps) {
        throw new Error(`Maintenance windows overlap for an affected service: ${left.id}, ${right.id}`);
      }
    }
  }
  return windows;
}
