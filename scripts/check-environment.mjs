#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[a-f0-9]{40}$/;
const PROFILES = {
  "public-local": { variables: [], bindings: [], files: [] },
  "owner-local": {
    variables: ["AUTH_SECRET", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "OWNER_GITHUB_ID", "GITHUB_TOKEN"],
    bindings: [],
    files: [],
  },
  cloudflare: {
    variables: ["AUTH_SECRET", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "OWNER_GITHUB_ID", "GITHUB_TOKEN", "COLLECTOR_UPLOAD_SECRET", "PROPOSALS_ORIGIN", "PROPOSALS_ORIGIN_TOKEN"],
    bindings: ["FRONTPAGE_SQL"],
    files: [],
  },
  collector: {
    variables: ["FRONTPAGE_METRICS_DIR", "FRONTPAGE_UPLOAD_URL", "FRONTPAGE_UPLOAD_SECRET_FILE"],
    bindings: [],
    files: ["FRONTPAGE_UPLOAD_SECRET_FILE"],
  },
  rollback: { variables: ["FRONTPAGE_VPS_ROLLBACK", "GITHUB_SHA", "FRONTPAGE_VAULT_PASSWORD_FILE"], bindings: [], files: ["FRONTPAGE_VAULT_PASSWORD_FILE"] },
};

export function checkEnvironment(profile, env = process.env) {
  const contract = PROFILES[profile];
  if (!contract) {
    return { ok: false, profile, error: "Unknown profile. Choose public-local, owner-local, cloudflare, collector, or rollback." };
  }
  const missingVariables = contract.variables.filter((name) => !env[name]?.trim());
  const missingBindings = contract.bindings.filter((name) => !env[name]?.trim());
  const missingFiles = contract.files.filter((name) => {
    if (!env[name]?.trim()) return true;
    try {
      accessSync(env[name], constants.R_OK);
      return false;
    } catch {
      return true;
    }
  });
  const invalid = [];
  if (profile === "rollback") {
    if (env.FRONTPAGE_VPS_ROLLBACK?.trim() && env.FRONTPAGE_VPS_ROLLBACK !== "1") {
      invalid.push("FRONTPAGE_VPS_ROLLBACK (must equal 1)");
    }
    if (env.GITHUB_SHA?.trim() && !FULL_SHA.test(env.GITHUB_SHA)) {
      invalid.push("GITHUB_SHA (must be a full lowercase commit SHA)");
    }
  }
  return { ok: missingVariables.length === 0 && missingBindings.length === 0 && missingFiles.length === 0 && invalid.length === 0, profile, missingVariables, missingBindings, missingFiles, invalid };
}

function parseProfile(args) {
  if (args.length !== 2 || args[0] !== "--profile") return null;
  return args[1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profile = parseProfile(process.argv.slice(2));
  if (!profile) {
    console.error("Usage: node scripts/check-environment.mjs --profile public-local|owner-local|cloudflare|collector|rollback");
    process.exitCode = 2;
  } else {
    const result = checkEnvironment(profile);
    if (result.error) {
      console.error(result.error);
      process.exitCode = 2;
    } else {
      console.log(`Environment profile: ${profile}`);
      for (const [label, names] of [["Missing variables", result.missingVariables], ["Missing bindings", result.missingBindings], ["Missing/unreadable files", result.missingFiles], ["Invalid values", result.invalid]]) {
        if (names.length) console.log(`${label}: ${names.join(", ")}`);
      }
      if (result.ok) console.log("Required configuration is present.");
      else process.exitCode = 1;
    }
  }
}
