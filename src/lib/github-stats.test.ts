import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractRepoPairs,
  fetchRepoStats,
  normalizeGitHubRepository,
  shouldCreateGitHubStatsClient,
  summarizeGitHubStatsError,
} from "./github-stats";
import type { Octokit } from "@octokit/rest";
import { getCanonicalProjects } from "@/lib/content";

describe("extractRepoPairs", () => {
  it("includes linked nonfeatured projects for homepage activity", () => {
    const projects = getCanonicalProjects();
    const pairs = extractRepoPairs(projects);

    expect(pairs).toHaveLength(19);
    expect(pairs.some((pair) => pair.slug === "codex-antigravity-auth")).toBe(true);
  });

  it("extracts only exact HTTPS repository paths and carries normalized keys", () => {
    expect(extractRepoPairs([
      { slug: "valid", repoUrl: "https://github.com/Reedtrullz/Frontpage.git/" },
      { slug: "evil-host", repoUrl: "https://github.com.evil.test/Reedtrullz/Frontpage" },
      { slug: "extra-route", repoUrl: "https://github.com/Reedtrullz/Frontpage/issues" },
    ])).toEqual([{ owner: "Reedtrullz", repo: "Frontpage", key: "reedtrullz/frontpage", slug: "valid" }]);
  });
});

describe("normalizeGitHubRepository", () => {
  it("accepts exact HTTPS URLs and deliberate owner/repo refs with case-insensitive keys", () => {
    expect(normalizeGitHubRepository("https://github.com/Reedtrullz/Frontpage.git/")).toEqual({
      owner: "Reedtrullz", repo: "Frontpage", key: "reedtrullz/frontpage",
    });
    expect(normalizeGitHubRepository("REEDTRULLZ/FrontPage")).toEqual({
      owner: "REEDTRULLZ", repo: "FrontPage", key: "reedtrullz/frontpage",
    });
  });

  it.each([
    "http://github.com/owner/repo",
    "https://github.com.evil.test/owner/repo",
    "https://user@github.com/owner/repo",
    "https://github.com/owner/repo/issues",
    "https://github.com/owner/repo?tab=readme",
    "https://github.com/owner/repo#readme",
    "https://example.test/https://github.com/owner/repo",
    "owner/repo/extra",
  ])("rejects non-repository reference %s", (value) => {
    expect(normalizeGitHubRepository(value)).toBeNull();
  });
});

describe("shouldCreateGitHubStatsClient", () => {
  it("requires a token unless unauthenticated stats are explicitly enabled", () => {
    expect(shouldCreateGitHubStatsClient({})).toBe(false);
    expect(shouldCreateGitHubStatsClient({ GITHUB_TOKEN: "token" })).toBe(true);
    expect(
      shouldCreateGitHubStatsClient({
        GITHUB_STATS_ALLOW_UNAUTHENTICATED: "true",
      }),
    ).toBe(true);
  });
});

describe("summarizeGitHubStatsError", () => {
  it("maps provider messages to bounded categories without exposing raw text", () => {
    const summary = summarizeGitHubStatsError({
      status: 404,
      response: {
        data: {
          message: `Not Found ${"private-provider-detail".repeat(100)}`,
        },
      },
    });

    expect(summary).toBe("GitHub repository not found (HTTP 404)");
    expect(summary.length).toBeLessThan(64);
    expect(summary).not.toContain("private-provider-detail");
  });

  it("uses bounded network error categories", () => {
    expect(summarizeGitHubStatsError({ code: "ETIMEDOUT", message: "secret timeout endpoint" })).toBe("GitHub network timeout");
    expect(summarizeGitHubStatsError(new Error("network exploded"))).toBe("GitHub request failed");
  });

  it("collapses GitHub rate-limit details into a short summary", () => {
    const summary = summarizeGitHubStatsError({
      status: 403,
      response: {
        data: {
          message:
            "API rate limit exceeded for 195.1.46.208. See docs for details.",
        },
      },
    });

    expect(summary).toBe("GitHub rate limit (HTTP 403)");
  });
});

function fakeClient(
  repoData: unknown,
  commits: unknown,
): Octokit {
  return {
    repos: {
      get: vi.fn().mockResolvedValue({ data: repoData }),
      listCommits: vi.fn().mockResolvedValue({ data: commits }),
    },
  } as unknown as Octokit;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("fetchRepoStats in-flight coalescing", () => {
  it("shares one repository-and-commit fetch pair across case variants", async () => {
    const repoResult = deferred<{ data: object }>();
    const commitResult = deferred<{ data: object[] }>();
    const client = {
      repos: {
        get: vi.fn(() => repoResult.promise),
        listCommits: vi.fn(() => commitResult.promise),
      },
    } as unknown as Octokit;
    const repo = `parallel-${Date.now()}`;
    const first = fetchRepoStats("Reedtrullz", repo, client);
    const second = fetchRepoStats("reedtrullz", repo.toUpperCase(), client);
    await Promise.resolve();
    expect(client.repos.get).toHaveBeenCalledTimes(1);
    expect(client.repos.listCommits).toHaveBeenCalledTimes(1);
    repoResult.resolve({ data: { stargazers_count: 17, language: "TypeScript", updated_at: "2026-10-01T00:00:00Z" } });
    commitResult.resolve({ data: [{ commit: { author: { date: "2026-10-02T00:00:00Z" }, message: "test" } }] });
    const [firstStats, secondStats] = await Promise.all([first, second]);
    expect([firstStats, secondStats]).toMatchObject([
      { status: "available", stars: 17 }, { status: "available", stars: 17 },
    ]);
    const cached = await fetchRepoStats("reedtrullz", repo.toUpperCase(), fakeClient({}, []));
    expect(cached).toBe(firstStats);
  });

  it("clears failed in-flight work and retries after the settled five-minute cache expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    const repo = `retry-${Date.now()}`;
    const failed = fakeClient(
      {},
      [],
    );
    vi.mocked(failed.repos.get).mockRejectedValue({ status: 404, response: { data: { message: "private-provider-detail" } } });
    const unavailable = await fetchRepoStats("Reedtrullz", repo, failed);
    expect(unavailable.status).toBe("unavailable");
    const cached = await fetchRepoStats("reedtrullz", repo.toUpperCase(), fakeClient({}, []));
    expect(cached).toBe(unavailable);
    expect(failed.repos.get).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const recovered = await fetchRepoStats(
      "REEDTRULLZ", repo,
      fakeClient({ stargazers_count: 2, language: "Python", updated_at: null }, []),
    );
    expect(recovered).toMatchObject({ status: "available", stars: 2, language: "Python" });
  });
});
