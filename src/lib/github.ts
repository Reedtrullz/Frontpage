import { Octokit } from "@octokit/rest";

const GITHUB_REPO = process.env.GITHUB_REPO || "Reedtrullz/Frontpage";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

let octokit: Octokit | null = null;
function getOctokit() {
  if (!octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return null;
    octokit = new Octokit({ auth: token });
  }
  return octokit;
}

export async function syncToGithub(files: { path: string; content: string }[]) {
  const gh = getOctokit();
  if (!gh) {
    console.log("No GITHUB_TOKEN configured — skipping GitHub sync");
    return false;
  }

  const [owner, repo] = GITHUB_REPO.split("/");

  try {
    for (const file of files) {
      const content = Buffer.from(file.content).toString("base64");

      let sha: string | undefined;
      try {
        const { data } = await gh.repos.getContent({
          owner,
          repo,
          path: file.path,
          ref: GITHUB_BRANCH,
        });
        if (!Array.isArray(data)) {
          sha = data.sha;
        }
      } catch {
        // file doesn't exist yet — create it
      }

      await gh.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: file.path,
        message: `Update ${file.path} via admin panel`,
        content,
        branch: GITHUB_BRANCH,
        sha,
      });
    }
    return true;
  } catch (err) {
    console.error("GitHub sync failed:", err);
    return false;
  }
}
