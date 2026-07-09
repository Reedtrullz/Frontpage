import { Octokit } from "@octokit/rest";
import type { GitPublicationClient } from "@/lib/content/publication";

function repositoryConfig(): { owner: string; repo: string; branch: string } {
  const repository = process.env.GITHUB_REPO || "Reedtrullz/Frontpage";
  const [owner, repo, ...extra] = repository.split("/");
  if (!owner || !repo || extra.length > 0) {
    throw new Error("GITHUB_REPO must use the owner/repository format.");
  }
  return {
    owner,
    repo,
    branch: process.env.GITHUB_BRANCH || "main",
  };
}

export function createGitHubPublicationClient(): GitPublicationClient | null {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  const octokit = new Octokit({ auth: token });
  const { owner, repo, branch } = repositoryConfig();

  return {
    async getHead() {
      const { data: ref } = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      const { data: commit } = await octokit.git.getCommit({
        owner,
        repo,
        commit_sha: ref.object.sha,
      });
      return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
    },
    async createBlob(content) {
      const { data } = await octokit.git.createBlob({
        owner,
        repo,
        content,
        encoding: "utf-8",
      });
      return data.sha;
    },
    async createTree(baseTreeSha, files) {
      const { data } = await octokit.git.createTree({
        owner,
        repo,
        base_tree: baseTreeSha,
        tree: files.map((file) => ({
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: file.blobSha,
        })),
      });
      return data.sha;
    },
    async createCommit(input) {
      const { data } = await octokit.git.createCommit({
        owner,
        repo,
        message: input.message,
        tree: input.treeSha,
        parents: [input.parentSha],
      });
      return data.sha;
    },
    async updateHead(commitSha) {
      await octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: commitSha,
        force: false,
      });
    },
    getCommitUrl(commitSha) {
      return `https://github.com/${owner}/${repo}/commit/${commitSha}`;
    },
  };
}
