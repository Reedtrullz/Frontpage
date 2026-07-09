import { describe, expect, it } from "vitest";
import { parseProjects, projectSchema } from "./schema";

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
});
