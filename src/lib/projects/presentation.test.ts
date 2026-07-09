import { describe, expect, it } from "vitest";
import { getCanonicalProjects } from "@/lib/content";
import {
  filterProjects,
  repositoryActivity,
  selectFlagships,
  sortProjects,
} from "./presentation";

const projects = getCanonicalProjects();

describe("project presentation", () => {
  it("sorts flagships by featured rank", () => {
    expect(selectFlagships(projects).map((project) => project.slug)).toEqual([
      "nytt",
      "rfs",
      "rfmc",
      "heimdall",
    ]);
  });

  it("filters by search, lifecycle, maturity, and category", () => {
    const filtered = filterProjects(projects, {
      query: "flight",
      lifecycle: "active",
      maturity: "flagship",
      category: "all",
    });

    expect(filtered.map((project) => project.slug)).toContain("rfs");
    expect(filtered.every((project) => project.lifecycle === "active")).toBe(
      true,
    );
  });

  it("sorts by the newest evidence without mutating canonical order", () => {
    const before = projects.map((project) => project.slug);
    const sorted = sortProjects(projects, "evidence");

    expect(sorted[0].evidence.reviewedAt >= sorted[1].evidence.reviewedAt).toBe(
      true,
    );
    expect(projects.map((project) => project.slug)).toEqual(before);
  });

  it("represents missing repository activity as null", () => {
    expect(repositoryActivity(null)).toBeNull();
    expect(
      repositoryActivity({
        stars: 0,
        language: "—",
        lastCommitDate: null,
        lastCommitMessage: null,
        updatedAt: null,
        fetchedAt: "2026-07-09T19:00:00Z",
      }),
    ).toBeNull();
  });
});
