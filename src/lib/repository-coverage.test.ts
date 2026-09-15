import { describe, expect, it } from "vitest";
import { getCanonicalPublicRepositories } from "@/lib/content";
import {
  compareRepositoryCoverage,
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

  it("keeps the six source-reviewed uncovered repositories in the public directory", () => {
    const repositories = getCanonicalPublicRepositories();
    expect(repositories).toHaveLength(6);
    expect(repositories.filter((repository) => repository.fork)).toHaveLength(5);
    expect(repositories.map((repository) => repository.slug)).toEqual([
      "bunkerkartet",
      "flip-smart-runelite-plugin",
      "homebrew-cask",
      "opencodex",
      "osrs-fliphub-plugin-public",
      "tcecosystem-guide",
    ]);
  });
});
