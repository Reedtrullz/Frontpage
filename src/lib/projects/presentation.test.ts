import { describe, expect, it } from "vitest";
import { getCanonicalProjects } from "@/lib/content";
import {
  filterPublicRepositories,
  evidenceReviewAge,
  sortProjectMilestones,
  filterProjects,
  repositoryActivity,
  repositoryStatus,
  selectFlagships,
  sortProjects,
} from "./presentation";

const projects = getCanonicalProjects();

describe("project presentation", () => {
  it("reports review age independently and handles invalid or future dates", () => {
    const now = new Date("2026-10-03T00:00:00Z");
    expect(evidenceReviewAge("2026-10-01T00:00:00Z", now)).toEqual({ kind: "known", days: 2 });
    expect(evidenceReviewAge("2026-10-04T00:00:00Z", now)).toEqual({ kind: "unknown" });
    expect(evidenceReviewAge("not-a-date", now)).toEqual({ kind: "invalid" });
  });

  it("orders optional milestones newest first with stable ID tie breaks without mutation", () => {
    const milestones = [
      { id: "zeta", occurredAt: "2026-09-01", title: "First entry", summary: "A source reviewed entry.", scope: "source-reviewed" as const, evidenceUrl: "https://example.com/a", reviewedAt: "2026-09-02T00:00:00Z" },
      { id: "alpha", occurredAt: "2026-09-01", title: "Second entry", summary: "Another source reviewed entry.", scope: "ci-verified" as const, evidenceUrl: "https://example.com/b", reviewedAt: "2026-09-02T00:00:00Z" },
      { id: "newer", occurredAt: "2026-10-01", title: "Newer entry", summary: "The newest recorded entry.", scope: "live-verified" as const, evidenceUrl: "https://example.com/c", reviewedAt: "2026-10-02T00:00:00Z" },
    ];
    expect(sortProjectMilestones(milestones).map((entry) => entry.id)).toEqual(["newer", "alpha", "zeta"]);
    expect(milestones.map((entry) => entry.id)).toEqual(["zeta", "alpha", "newer"]);
    expect(sortProjectMilestones([])).toEqual([]);
  });

  it("sorts flagships by featured rank", () => {
    expect(selectFlagships(projects).map((project) => project.slug)).toEqual([
      "nytt",
      "rfs",
      "rfmc",
      "heimdall",
      "keyspilli",
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

  it("treats current as the active and maintained lifecycle union", () => {
    const filtered = filterProjects(projects, {
      query: "",
      lifecycle: "current",
      maturity: "all",
      category: "all",
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((project) => ["active", "maintained"].includes(project.lifecycle))).toBe(true);
  });

  it("searches repository-only records by name, description, and upstream", () => {
    const repositories = [
      {
        slug: "bunker",
        name: "Bunkerkartet",
        description: "A source-backed map",
        repoUrl: "https://github.com/Reedtrullz/Bunkerkartet",
        fork: false,
        reviewedAt: "2026-09-15T00:00:00Z",
      },
      {
        slug: "fork",
        name: "Forked tool",
        description: "A tool",
        repoUrl: "https://github.com/Reedtrullz/fork",
        fork: true,
        upstream: {
          name: "Upstream Tool",
          repoUrl: "https://github.com/upstream/tool",
        },
        reviewedAt: "2026-09-15T00:00:00Z",
      },
    ];

    expect(filterPublicRepositories(repositories, "bunker")).toHaveLength(1);
    expect(filterPublicRepositories(repositories, "upstream tool")).toHaveLength(1);
    expect(filterPublicRepositories(repositories, "github.com/reedtrullz/fork")).toHaveLength(1);
    expect(filterPublicRepositories(repositories, "missing")).toHaveLength(0);
  });

  it("sorts by the newest evidence without mutating canonical order", () => {
    const before = projects.map((project) => project.slug);
    const sorted = sortProjects(projects, "evidence");

    expect(sorted[0].evidence.reviewedAt >= sorted[1].evidence.reviewedAt).toBe(
      true,
    );
    expect(projects.map((project) => project.slug)).toEqual(before);
  });

  it("distinguishes unavailable stats from an available repository with no commits", () => {
    expect(repositoryActivity(null)).toBeNull();
    expect(
      repositoryActivity({
        status: "unavailable",
        stars: 0,
        language: "—",
        lastCommitDate: null,
        lastCommitMessage: null,
        updatedAt: null,
        fetchedAt: "2026-07-09T19:00:00Z",
      }),
    ).toBeNull();
    expect(
      repositoryActivity({
        status: "available",
        stars: 0,
        language: "—",
        lastCommitDate: null,
        lastCommitMessage: null,
        updatedAt: null,
        fetchedAt: "2026-07-09T19:00:00Z",
      }),
    ).toEqual({
      stars: 0,
      language: null,
      lastCommitDate: null,
      lastCommitMessage: null,
    });
  });

  it("labels missing, unavailable, and available repository activity separately", () => {
    expect(repositoryStatus({}, null)).toBe("no-repository");
    expect(
      repositoryStatus(
        { repoUrl: "https://github.com/Reedtrullz/example" },
        { status: "unavailable", stars: 0, language: "—", lastCommitDate: null, lastCommitMessage: null, updatedAt: null, fetchedAt: "2026-07-09T19:00:00Z" },
      ),
    ).toBe("unavailable");
    expect(
      repositoryStatus(
        { repoUrl: "https://github.com/Reedtrullz/example" },
        { status: "available", stars: 0, language: "—", lastCommitDate: null, lastCommitMessage: null, updatedAt: null, fetchedAt: "2026-07-09T19:00:00Z" },
      ),
    ).toBe("no-commits");
  });
});
