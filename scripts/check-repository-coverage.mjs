import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const owner = process.env.GITHUB_OWNER || "Reedtrullz";
const aliases = new Map([
  ["reedtrullz/reedfs", "rfs"],
  ["reedtrullz/handli", "handleplan"],
  ["reedtrullz/innsats-appen", "innsats-appen"],
  ["reedtrullz/hermes-proposals-dashboard", "project-dashboard"],
]);

export function normalizeRepositoryRef(value) {
  const input = value.trim().replace(/\.git\/?$/, "");
  const parts = input.startsWith("http")
    ? (() => {
        const url = new URL(input);
        return url.hostname.toLowerCase() === "github.com"
          ? url.pathname.split("/").filter(Boolean)
          : [];
      })()
    : input.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  return `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
}

export function repositoryAlias(value) {
  const key = normalizeRepositoryRef(value);
  return key ? aliases.get(key) : undefined;
}

export function compareRepositoryCoverage(remote, knownRefs) {
  const known = new Set(
    knownRefs.map(normalizeRepositoryRef).filter((value) => value !== null),
  );
  const covered = [];
  const missing = [];
  for (const repository of remote) {
    const key = normalizeRepositoryRef(repository.fullName);
    if (key && known.has(key)) covered.push(repository.fullName);
    else missing.push(repository.fullName);
  }
  return { covered, missing };
}

export async function fetchPublicRepositories(
  fetchImpl = globalThis.fetch,
  repositoryOwner = owner,
) {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/users/${repositoryOwner}/repos?type=owner&per_page=100&page=${page}`;
    const response = await fetchImpl(url, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      throw new Error(`GitHub API HTTP ${response.status}`);
    }
    const pageRepositories = await response.json();
    if (!Array.isArray(pageRepositories)) {
      throw new Error("GitHub API returned a non-array repository page");
    }
    repositories.push(
      ...pageRepositories.map((repository) => ({
        fullName: repository.full_name,
        fork: repository.fork === true,
      })),
    );
    if (pageRepositories.length < 100) return repositories;
  }
}

function readKnownRepositoryRefs() {
  const projects = JSON.parse(
    fs.readFileSync(path.join(root, "content", "projects.json"), "utf8"),
  );
  const additional = JSON.parse(
    fs.readFileSync(path.join(root, "content", "repositories.json"), "utf8"),
  );
  return [
    ...projects.map((project) => project.repoUrl).filter(Boolean),
    ...additional.map((repository) => repository.repoUrl),
  ];
}

export async function main() {
  try {
    const remote = await fetchPublicRepositories();
    const result = compareRepositoryCoverage(remote, readKnownRepositoryRefs());
    const forkCount = remote.filter((repository) => repository.fork).length;
    console.log(`Public repositories: ${remote.length} (${forkCount} forks)`);
    console.log(`Covered repository links: ${result.covered.length}`);
    if (result.missing.length > 0) {
      console.error("FAIL: missing repository links:");
      for (const name of result.missing) console.error(`- ${name}`);
      return 1;
    }
    console.log(`PASS: all ${remote.length} public repositories are covered`);
    return 0;
  } catch (error) {
    console.error(
      `UNKNOWN: repository coverage could not be checked: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
