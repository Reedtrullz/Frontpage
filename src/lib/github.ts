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

function getGithubErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown GitHub error";
}

function logGithubSyncError(filePath: string, error: unknown) {
  const message = getGithubErrorMessage(error);
  const status = typeof error === "object" && error && "status" in error ? (error as { status?: number }).status : undefined;
  const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : undefined;

  if (status === 401 || (status === 403 && !message.toLowerCase().includes("rate limit"))) {
    console.error(`GitHub sync failed for ${filePath}: authentication/authorization error`, error);
    return;
  }

  if (status === 429 || (status === 403 && message.toLowerCase().includes("rate limit"))) {
    console.error(`GitHub sync failed for ${filePath}: rate limit exceeded`, error);
    return;
  }

  if (code && ["ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) {
    console.error(`GitHub sync failed for ${filePath}: network error (${code})`, error);
    return;
  }

  console.error(`GitHub sync failed for ${filePath}: ${message}`, error);
}

export async function syncToGithub(files: { path: string; content: string }[]) {
  const gh = getOctokit();
  if (!gh) {
    console.log("No GITHUB_TOKEN configured — skipping GitHub sync");
    return false;
  }

  const [owner, repo] = GITHUB_REPO.split("/");

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
    } catch (error: unknown) {
      if (typeof error === "object" && error && "status" in error && (error as { status?: number }).status === 404) {
        // file doesn't exist yet — create it
      } else {
        logGithubSyncError(file.path, error);
        return false;
      }
    }

    try {
      await gh.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: file.path,
        message: `Update ${file.path} via admin panel`,
        content,
        branch: GITHUB_BRANCH,
        sha,
      });
    } catch (error: unknown) {
      logGithubSyncError(file.path, error);
      return false;
    }
  }

  return true;
}
