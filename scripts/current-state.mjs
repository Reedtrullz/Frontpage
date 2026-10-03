#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function parseWorktrees(text) {
  return text.split(/\n\n+/).filter(Boolean).map((block) => {
    const fields = Object.fromEntries(block.split("\n").map((line) => {
      const split = line.indexOf(" ");
      return split < 0 ? [line, ""] : [line.slice(0, split), line.slice(split + 1)];
    }));
    return { path: fields.worktree, head: fields.HEAD, branch: fields.branch?.replace("refs/heads/", "") ?? "detached" };
  });
}

export function generateCurrentState({ cwd = process.cwd(), now = new Date() } = {}) {
  const branch = git(cwd, ["branch", "--show-current"]) || "detached";
  const sha = git(cwd, ["rev-parse", "HEAD"]);
  const dirtyEntries = git(cwd, ["status", "--porcelain=v1"]).split("\n").filter(Boolean).length;
  const worktrees = parseWorktrees(git(cwd, ["worktree", "list", "--porcelain"]));
  const sourceCandidates = [
    "AGENTS.md", "README.md", "DEPLOYMENT.md", "Dockerfile", "package.json", "package-lock.json",
    ".github/workflows/ci.yml", "ansible-playbook.yml", "ops/ansible/container-preflight.yml",
    "ops/ansible/container-swap.yml", "wrangler.jsonc", "src/app/api/health/route.ts",
  ];
  const tracked = new Set(git(cwd, ["ls-files", "--", ...sourceCandidates]).split("\n").filter(Boolean));
  return [
    `# Generated Frontpage current state`,
    "",
    `- generated at: ${now.toISOString()}`,
    `- branch: ${branch}`,
    `- full commit SHA: \`${sha}\``,
    `- dirty entries: ${dirtyEntries}`,
    `- git worktrees: ${worktrees.length}`,
    "",
    "## Worktrees",
    "",
    ...worktrees.map((item) => `- \`${item.branch}\` at \`${item.path}\` (${item.head})`),
    "",
    "## Source inventory",
    "",
    ...[...tracked].sort().map((file) => `- \`${file}\``),
    "",
    "## Evidence limits",
    "",
    "This local snapshot does not claim current CI, deployment, domain, or production health. Query those systems separately and record their source and observation time.",
    "",
  ].join("\n");
}

function outputArgument(args) {
  const index = args.indexOf("--output");
  if (index < 0 || !args[index + 1] || args.length !== 2) return null;
  return args[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = outputArgument(process.argv.slice(2));
  if (!target) {
    console.error("Usage: node scripts/current-state.mjs --output <new-file>");
    process.exitCode = 2;
  } else {
    try {
      const absolute = path.resolve(target);
      mkdirSync(path.dirname(absolute), { recursive: true });
      const fd = openSync(absolute, "wx", 0o644);
      try {
        writeFileSync(fd, generateCurrentState());
      } finally {
        closeSync(fd);
      }
      console.log(`Generated local current-state inventory at ${absolute}`);
    } catch (error) {
      console.error(error?.code === "EEXIST" ? "Output already exists; choose a new file to preserve existing notes." : "Could not generate current-state inventory.");
      process.exitCode = 1;
    }
  }
}
