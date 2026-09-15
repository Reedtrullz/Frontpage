import { describe, expect, it } from "vitest";
import { getCanonicalProject, getCanonicalProjects, getCanonicalPublicRepositories } from "@/lib/content";
import {
  compareRepositoryCoverage,
  fetchPublicRepositories,
  normalizeRepositoryRef,
  repositoryAlias,
} from "../../scripts/check-repository-coverage.mjs";

describe("repository coverage", () => {
  it("normalizes GitHub URLs, refs, and .git suffixes", () => {
    expect(normalizeRepositoryRef("https://github.com/Reedtrullz/ReedFS.git")).toBe(
      "reedtrullz/reedfs",
    );
    expect(normalizeRepositoryRef("Reedtrullz/ReedFS")).toBe(
      "reedtrullz/reedfs",
    );
  });

  it("keeps project aliases visible while matching repository URLs", () => {
    expect(repositoryAlias("Reedtrullz/ReedFS")).toBe("rfs");
    expect(repositoryAlias("Reedtrullz/Handli")).toBe("handleplan");
    expect(repositoryAlias("Reedtrullz/Innsats-appen")).toBe("innsats-appen");
    expect(repositoryAlias("Reedtrullz/hermes-proposals-dashboard")).toBe(
      "project-dashboard",
    );
  });

  it("includes forks and reports only genuinely missing repositories", () => {
    const result = compareRepositoryCoverage(
      [
        { fullName: "Reedtrullz/ReedFS", fork: false },
        { fullName: "Reedtrullz/homebrew-cask", fork: true },
        { fullName: "Reedtrullz/missing", fork: false },
      ],
      ["https://github.com/Reedtrullz/ReedFS", "Reedtrullz/homebrew-cask"],
    );

    expect(result.covered).toEqual([
      "Reedtrullz/ReedFS",
      "Reedtrullz/homebrew-cask",
    ]);
    expect(result.missing).toEqual(["Reedtrullz/missing"]);
  });

  it("fails closed on malformed API records", async () => {
    await expect(
      fetchPublicRepositories(async () => ({
        ok: true,
        json: async () => [{ full_name: "not-a-repository", fork: false }],
      }) as Response),
    ).rejects.toThrow("invalid repository record");
  });

  it("bounds an unexpectedly full paginated response", async () => {
    const fetchPage = async (): Promise<Response> => ({
      ok: true,
      json: async () =>
        Array.from({ length: 100 }, (_, index) => ({
          full_name: `Reedtrullz/repository-${index}`,
          fork: false,
        })),
    } as Response);
    await expect(fetchPublicRepositories(fetchPage)).rejects.toThrow(
      "exceeded the 10-page repository limit",
    );
  });

  it("promotes Bunkerkartet and keeps the five fork records in the public directory", () => {
    const bunkerkartet = getCanonicalProject("bunkerkartet");
    expect(bunkerkartet?.liveUrl).toBe("https://bunker.reidar.tech");
    expect(getCanonicalProjects().filter((project) => project.repoUrl?.endsWith("/Bunkerkartet"))).toHaveLength(1);
    const repositories = getCanonicalPublicRepositories();
    expect(repositories).toHaveLength(5);
    expect(repositories.filter((repository) => repository.fork)).toHaveLength(5);
    expect(repositories.map((repository) => repository.slug)).toEqual([
      "flip-smart-runelite-plugin",
      "homebrew-cask",
      "opencodex",
      "osrs-fliphub-plugin-public",
      "tcecosystem-guide",
    ]);
  });
});
