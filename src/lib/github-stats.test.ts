import { describe, expect, it } from "vitest";
import {
  shouldCreateGitHubStatsClient,
  summarizeGitHubStatsError,
} from "./github-stats";

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
  it("formats HTTP errors without exposing raw Octokit objects", () => {
    const summary = summarizeGitHubStatsError({
      status: 404,
      response: {
        data: {
          message: "Not Found",
        },
      },
    });

    expect(summary).toBe("HTTP 404: Not Found");
  });

  it("falls back to a normal Error message", () => {
    expect(summarizeGitHubStatsError(new Error("network exploded"))).toBe(
      "network exploded",
    );
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

    expect(summary).toBe("HTTP 403: GitHub API rate limit exceeded");
  });
});
