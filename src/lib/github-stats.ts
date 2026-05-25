import { Octokit } from "@octokit/rest";

export interface GitHubStats {
  stars: number;
  language: string;
  lastCommitDate: string | null; // ISO string
  lastCommitMessage: string | null;
  updatedAt: string | null;
  fetchedAt: string;
}

// In-memory cache with 5-minute TTL for serverless-friendly stats
const cache = new Map<string, { data: GitHubStats; ts: number }>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function getOctokit(): Octokit | null {
  const token = process.env.GITHUB_TOKEN;
  // Octokit works without auth for public repos (lower rate limit)
  return new Octokit(token ? { auth: token } : {});
}

export async function fetchRepoStats(
  owner: string,
  repo: string,
): Promise<GitHubStats> {
  const key = `${owner}/${repo}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return cached.data;
  }

  const gh = getOctokit();
  if (!gh) {
    return emptyStats();
  }

  try {
    const [{ data: repoData }, { data: commits }] = await Promise.all([
      gh.repos.get({ owner, repo }),
      gh.repos.listCommits({ owner, repo, per_page: 1 }),
    ]);

    const stats: GitHubStats = {
      stars: repoData.stargazers_count ?? 0,
      language: repoData.language ?? "—",
      lastCommitDate: commits[0]?.commit?.author?.date ?? null,
      lastCommitMessage: commits[0]?.commit?.message ?? null,
      updatedAt: repoData.updated_at ?? null,
      fetchedAt: new Date().toISOString(),
    };

    cache.set(key, { data: stats, ts: Date.now() });
    return stats;
  } catch (err) {
    console.error(`GitHub fetch failed for ${owner}/${repo}:`, err);
    const stats = emptyStats();
    cache.set(key, { data: stats, ts: Date.now() });
    return stats;
  }
}

export async function fetchAllRepoStats(
  repos: { owner: string; repo: string }[],
): Promise<Map<string, GitHubStats>> {
  const results = await Promise.allSettled(
    repos.map((r) => fetchRepoStats(r.owner, r.repo)),
  );

  const map = new Map<string, GitHubStats>();
  repos.forEach((r, i) => {
    const result = results[i];
    const key = `${r.owner}/${r.repo}`;
    map.set(
      key,
      result.status === "fulfilled" ? result.value : emptyStats(),
    );
  });
  return map;
}

function emptyStats(): GitHubStats {
  return {
    stars: 0,
    language: "—",
    lastCommitDate: null,
    lastCommitMessage: null,
    updatedAt: null,
    fetchedAt: new Date().toISOString(),
  };
}

/** Extract owner/repo pairs from a list of project repoUrls */
export function extractRepoPairs(
  projects: { repoUrl?: string; slug?: string }[],
): { owner: string; repo: string; slug: string }[] {
  const pairs: { owner: string; repo: string; slug: string }[] = [];
  for (const p of projects) {
    if (!p.repoUrl) continue;
    const parsed = parseRepoUrl(p.repoUrl);
    if (parsed) {
      pairs.push({ ...parsed, slug: p.slug ?? "" });
    }
  }
  return pairs;
}
