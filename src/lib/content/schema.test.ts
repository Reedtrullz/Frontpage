import { describe, expect, it } from "vitest";
import { parseProjects, preserveProjectSlugAliases, projectGallerySchema, projectMilestonesSchema, projectSchema, resolveProjectSlug } from "./schema";

const validProject = {
  slug: "sample-project",
  name: "Sample Project",
  outcome: "Helps people inspect a real result.",
  shortDescription: "A concise project summary.",
  longDescription: "A longer project explanation.",
  lifecycle: "active",
  maturity: "flagship",
  category: "tooling",
  tags: ["sample"],
  techStack: ["TypeScript"],
  featuredRank: 1,
  repoUrl: "https://github.com/Reedtrullz/sample-project",
  evidence: {
    reviewedAt: "2026-07-09T12:00:00Z",
    level: "source-reviewed",
    note: "Source and current posture reviewed.",
  },
  sections: {
    whatItSolves: ["Makes the problem understandable."],
    currentState: ["Active within the stated scope."],
    howItWorks: ["Uses explicit evidence."],
  },
  limitations: ["No production deployment is claimed."],
};

describe("canonical project content", () => {
  it("accepts a fully labelled project posture", () => {
    expect(projectSchema.parse(validProject)).toMatchObject({
      lifecycle: "active",
      maturity: "flagship",
    });
  });

  it("rejects duplicate project slugs", () => {
    expect(() =>
      parseProjects([
        validProject,
        { ...validProject, name: "Second project" },
      ]),
    ).toThrow(/duplicate project slug/i);
  });

  it("rejects non-http project links", () => {
    expect(() =>
      projectSchema.parse({ ...validProject, liveUrl: "javascript:alert(1)" }),
    ).toThrow(/http/i);
  });

  it("rejects credentials embedded in public URLs", () => {
    expect(() =>
      projectSchema.parse({
        ...validProject,
        liveUrl: "https://token:secret@example.com/product",
      }),
    ).toThrow(/credentials/i);
  });

  it("requires gallery JSON to be an array and bounds it to eight items", () => {
    expect(projectGallerySchema.safeParse([]).success).toBe(true);
    for (const value of [{}, null, "image", 4]) expect(projectGallerySchema.safeParse(value).success).toBe(false);
    const item = { src: "/projects/sample/image.webp", alt: "An illustrative project view", width: 800, height: 500 };
    expect(projectGallerySchema.safeParse(Array.from({ length: 8 }, () => item)).success).toBe(true);
    expect(projectGallerySchema.safeParse(Array.from({ length: 9 }, () => item)).success).toBe(false);
  });

  it("resolves renamed project aliases directly to the current slug", () => {
    const renamed = projectSchema.parse({ ...validProject, slug: "current-name", aliases: ["first-name", "previous-name"] });
    expect(resolveProjectSlug("first-name", [renamed])).toEqual({ kind: "redirect", project: renamed });
    expect(resolveProjectSlug("current-name", [renamed])).toEqual({ kind: "current", project: renamed });
    expect(resolveProjectSlug("missing", [renamed])).toEqual({ kind: "not-found" });
  });

  it("keeps every prior slug across repeated project renames", () => {
    const original = projectSchema.parse(validProject);
    const second = preserveProjectSlugAliases({ ...original, slug: "second-name" }, original.slug);
    const renamedBack = preserveProjectSlugAliases({ ...second, slug: original.slug }, second.slug);
    expect(renamedBack.aliases).toEqual(["second-name"]);
    const third = preserveProjectSlugAliases({ ...renamedBack, slug: "third-name" }, renamedBack.slug);
    expect(third.aliases).toEqual(["second-name", "sample-project"]);
    expect(resolveProjectSlug("sample-project", [third])).toEqual({ kind: "redirect", project: third });
    expect(resolveProjectSlug("second-name", [third])).toEqual({ kind: "redirect", project: third });
  });

  it("rejects global canonical and alias collisions and duplicate milestone IDs", () => {
    expect(() => parseProjects([
      { ...validProject, aliases: ["legacy-name"] },
      { ...validProject, slug: "legacy-name", name: "Second project" },
    ])).toThrow(/collision/i);
    expect(() => parseProjects([{ ...validProject, milestones: [
      { id: "same", occurredAt: "2026-01-01", title: "First milestone", summary: "A recorded source milestone.", scope: "source-reviewed", evidenceUrl: "https://example.com/evidence", reviewedAt: "2026-01-02T00:00:00Z" },
      { id: "same", occurredAt: "2026-01-02", title: "Second milestone", summary: "Another recorded source milestone.", scope: "ci-verified", evidenceUrl: "https://example.com/ci", reviewedAt: "2026-01-03T00:00:00Z" },
    ] }])).toThrow(/duplicate milestone/i);
  });

  it("keeps empty timelines optional and rejects invalid dates or more than twenty milestones", () => {
    const milestone = { id: "fixture", occurredAt: "2026-10-02", title: "Synthetic fixture", summary: "A source-scoped synthetic test entry.", scope: "source-reviewed", evidenceUrl: "https://example.com/evidence", reviewedAt: "2026-10-03T00:00:00Z" };
    expect(projectMilestonesSchema.parse([])).toEqual([]);
    expect(projectMilestonesSchema.safeParse([{ ...milestone, occurredAt: "2026-02-30" }]).success).toBe(false);
    expect(projectMilestonesSchema.safeParse(Array.from({ length: 21 }, (_, index) => ({ ...milestone, id: `fixture-${index}` }))).success).toBe(false);
  });
});
