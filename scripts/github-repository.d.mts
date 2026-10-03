export interface NormalizedGitHubRepository {
  owner: string;
  repo: string;
  key: string;
}

export function normalizeGitHubRepository(value: string): NormalizedGitHubRepository | null;
