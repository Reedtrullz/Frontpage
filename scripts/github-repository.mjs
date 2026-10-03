const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const repoPattern = /^[A-Za-z0-9_.-]{1,100}$/;

function makeRepository(owner, repo) {
  const normalizedRepo = repo.replace(/\.git$/i, "");
  if (!ownerPattern.test(owner) || !repoPattern.test(normalizedRepo)) return null;
  return {
    owner,
    repo: normalizedRepo,
    key: `${owner.toLowerCase()}/${normalizedRepo.toLowerCase()}`,
  };
}

export function normalizeGitHubRepository(value) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || /[\s\\%?#]/.test(input)) return null;

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(input)) {
    const match = input.match(/^https:\/\/([^/]+)(\/.*)?$/i);
    if (!match || match[1].toLowerCase() !== "github.com") return null;
    const rawPath = match[2] ?? "";
    if (!rawPath.startsWith("/")) return null;
    const segments = rawPath.slice(1).split("/");
    if (segments.at(-1) === "") segments.pop();
    if (segments.length !== 2 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
      return null;
    }
    return makeRepository(segments[0], segments[1]);
  }

  const segments = input.split("/");
  if (segments.length !== 2 || segments.some((segment) => !segment)) return null;
  return makeRepository(segments[0], segments[1]);
}
