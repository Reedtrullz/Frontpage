import { Octokit } from "@octokit/rest";
import { normalizeGitHubRepository as parseGitHubRepository } from "../../scripts/github-repository.mjs";

export interface GitHubStats {
  status: "available" | "unavailable";
  stars: number;
  language: string;
  lastCommitDate: string | null;
  lastCommitMessage: string | null;
  updatedAt: string | null;
  fetchedAt: string;
}

interface GitHubStatsClient {
  repos: {
    get(args: { owner: string; repo: string }): Promise<{ data: {
      stargazers_count?: number | null;
      language?: string | null;
      updated_at?: string | null;
    } }>;
    listCommits(args: { owner: string; repo: string; per_page: number }): Promise<{ data: Array<{
      commit?: { author?: { date?: string | null } | null; message?: string | null };
    }> }>;
  };
}

const cache = new Map<string, { data: GitHubStats; ts: number }>();
const inFlight = new Map<string, Promise<GitHubStats>>();
const TTL_MS = 5 * 60 * 1000;
const noopOctokitLog = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export type GitHubStatsEnv =
  | NodeJS.ProcessEnv
  | Partial<Record<"GITHUB_TOKEN" | "GITHUB_STATS_ALLOW_UNAUTHENTICATED", string | undefined>>;

export function normalizeGitHubRepository(value: string) {
  return parseGitHubRepository(value);
}

export function shouldCreateGitHubStatsClient(env: GitHubStatsEnv = process.env): boolean {
  return Boolean(env.GITHUB_TOKEN) || env.GITHUB_STATS_ALLOW_UNAUTHENTICATED === "true";
}

function getOctokit(): GitHubStatsClient | null {
  if (!shouldCreateGitHubStatsClient()) return null;
  const token = process.env.GITHUB_TOKEN;
  return new Octokit(
    token
      ? { auth: token, log: noopOctokitLog, request: { timeout: 2500 } }
      : { log: noopOctokitLog, request: { timeout: 2500 } },
  );
}

function objectProperty<T>(value: unknown, key: string): T | undefined {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  return (value as Record<string, unknown>)[key] as T | undefined;
}

export function summarizeGitHubStatsError(error: unknown): string {
  const status = objectProperty<unknown>(error, "status");
  const code = objectProperty<unknown>(error, "code");
  const providerMessage = objectProperty<string>(
    objectProperty<unknown>(objectProperty<unknown>(error, "response"), "data"),
    "message",
  );
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
    if (status === 429 || (status === 403 && providerMessage?.toLowerCase().includes("rate limit"))) {
      return `GitHub rate limit (HTTP ${status})`;
    }
    if (status === 401) return "GitHub authentication failed (HTTP 401)";
    if (status === 403) return "GitHub access forbidden (HTTP 403)";
    if (status === 404) return "GitHub repository not found (HTTP 404)";
    if (status === 408) return "GitHub request timed out (HTTP 408)";
    if (status >= 500) return `GitHub service unavailable (HTTP ${status})`;
    return `GitHub API error (HTTP ${status})`;
  }
  if (typeof code === "string") {
    if (["ETIMEDOUT", "ESOCKETTIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
      return "GitHub network timeout";
    }
    if (["ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "ENOTFOUND"].includes(code)) {
      return "GitHub network unavailable";
    }
    return "GitHub network error";
  }
  if (error instanceof Error && error.name === "TimeoutError") return "GitHub request timed out";
  return "GitHub request failed";
}

export async function fetchRepoStats(
  owner: string,
  repo: string,
  clientOverride?: GitHubStatsClient,
): Promise<GitHubStats> {
  const normalized = parseGitHubRepository(`${owner}/${repo}`);
  if (!normalized) return emptyStats();
  const { key } = normalized;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;
  const current = inFlight.get(key);
  if (current) return current;

  const client = clientOverride ?? getOctokit();
  if (!client) return emptyStats();

  const request = Promise.resolve().then(async () => {
    try {
      const [{ data: repoData }, { data: commits }] = await Promise.all([
        client.repos.get({ owner: normalized.owner, repo: normalized.repo }),
        client.repos.listCommits({ owner: normalized.owner, repo: normalized.repo, per_page: 1 }),
      ]);
      const stats: GitHubStats = {
        status: "available",
        stars: repoData.stargazers_count ?? 0,
        language: repoData.language ?? "—",
        lastCommitDate: commits[0]?.commit?.author?.date ?? null,
        lastCommitMessage: commits[0]?.commit?.message ?? null,
        updatedAt: repoData.updated_at ?? null,
        fetchedAt: new Date().toISOString(),
      };
      cache.set(key, { data: stats, ts: Date.now() });
      return stats;
    } catch (error) {
      console.warn(`GitHub stats unavailable for ${key}: ${summarizeGitHubStatsError(error)}`);
      return emptyStats();
    }
  });
  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }
}

export async function fetchAllRepoStats(
  repos: { owner: string; repo: string }[],
): Promise<Map<string, GitHubStats>> {
  const results = await Promise.allSettled(repos.map((repo) => fetchRepoStats(repo.owner, repo.repo)));
  const map = new Map<string, GitHubStats>();
  repos.forEach((repo, index) => {
    const normalized = parseGitHubRepository(`${repo.owner}/${repo.repo}`);
    if (!normalized) return;
    const result = results[index];
    map.set(normalized.key, result?.status === "fulfilled" ? result.value : emptyStats());
  });
  return map;
}

function emptyStats(): GitHubStats {
  return {
    status: "unavailable",
    stars: 0,
    language: "—",
    lastCommitDate: null,
    lastCommitMessage: null,
    updatedAt: null,
    fetchedAt: new Date().toISOString(),
  };
}

/** Extract owner/repo pairs from canonical project repository URLs. */
export function extractRepoPairs(
  projects: { repoUrl?: string; slug?: string }[],
): { owner: string; repo: string; key: string; slug: string }[] {
  const pairs: { owner: string; repo: string; key: string; slug: string }[] = [];
  for (const project of projects) {
    if (!project.repoUrl) continue;
    const normalized = parseGitHubRepository(project.repoUrl);
    if (normalized) pairs.push({ ...normalized, slug: project.slug ?? "" });
  }
  return pairs;
}
