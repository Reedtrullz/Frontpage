#!/usr/bin/env node
import { accessSync, constants, readFileSync } from "node:fs";
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
    bindings: [],
    files: [],
  },
  collector: {
    variables: ["FRONTPAGE_METRICS_DIR", "FRONTPAGE_UPLOAD_URL", "FRONTPAGE_UPLOAD_SECRET_FILE"],
    bindings: [],
    files: ["FRONTPAGE_UPLOAD_SECRET_FILE"],
  },
  rollback: { variables: ["FRONTPAGE_VPS_ROLLBACK", "GITHUB_SHA", "FRONTPAGE_VAULT_PASSWORD_FILE"], bindings: [], files: ["FRONTPAGE_VAULT_PASSWORD_FILE"] },
};

function parseWranglerJsonc(configPath) {
  const source = readFileSync(configPath, "utf8");
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      if (index >= source.length) throw new Error("unterminated comment");
      index += 1;
    } else output += char;
  }
  // JSONC permits trailing commas. This pass only removes commas outside strings.
  let normalized = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];
    if (inString) {
      normalized += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      normalized += char;
    } else if (char === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(output[nextIndex] ?? "")) nextIndex += 1;
      if (output[nextIndex] !== "}" && output[nextIndex] !== "]") normalized += char;
    } else normalized += char;
  }
  return JSON.parse(normalized);
}

function inspectCloudflareConfig(configPath) {
  if (!configPath) return {
    missingBindings: [],
    unverifiedConfiguration: ["Wrangler FRONTPAGE binding and SQLite migration (config not inspected)"],
    invalid: [],
  };
  try {
    const config = parseWranglerJsonc(configPath);
    const bindings = config?.durable_objects?.bindings;
    const hasFrontpageBinding = Array.isArray(bindings)
      && bindings.some((binding) => binding?.name === "FRONTPAGE" && binding?.class_name === "FrontpageDO");
    const hasSqliteMigration = Array.isArray(config?.migrations)
      && config.migrations.some((migration) => Array.isArray(migration?.new_sqlite_classes) && migration.new_sqlite_classes.includes("FrontpageDO"));
    const missingBindings = [];
    if (!hasFrontpageBinding) missingBindings.push("FRONTPAGE (Wrangler durable_objects binding)");
    if (!hasSqliteMigration) missingBindings.push("FrontpageDO (Wrangler SQLite migration)");
    return { missingBindings, unverifiedConfiguration: [], invalid: [] };
  } catch {
    return { missingBindings: [], unverifiedConfiguration: [], invalid: ["Wrangler config (missing, unreadable, or invalid JSONC)"] };
  }
}

export function checkEnvironment(profile, env = process.env, { wranglerConfigPath } = {}) {
  const contract = PROFILES[profile];
  if (!contract) {
    return { ok: false, profile, error: "Unknown profile. Choose public-local, owner-local, cloudflare, collector, or rollback." };
  }
  const missingVariables = contract.variables.filter((name) => !env[name]?.trim());
  const configInspection = profile === "cloudflare" ? inspectCloudflareConfig(wranglerConfigPath) : { missingBindings: [], unverifiedConfiguration: [], invalid: [] };
  const missingBindings = [...contract.bindings.filter((name) => !env[name]?.trim()), ...configInspection.missingBindings];
  const missingFiles = contract.files.filter((name) => {
    if (!env[name]?.trim()) return true;
    try {
      accessSync(env[name], constants.R_OK);
      return false;
    } catch {
      return true;
    }
  });
  const invalid = [...configInspection.invalid];
  if (profile === "rollback") {
    if (env.FRONTPAGE_VPS_ROLLBACK?.trim() && env.FRONTPAGE_VPS_ROLLBACK !== "1") {
      invalid.push("FRONTPAGE_VPS_ROLLBACK (must equal 1)");
    }
    if (env.GITHUB_SHA?.trim() && !FULL_SHA.test(env.GITHUB_SHA)) {
      invalid.push("GITHUB_SHA (must be a full lowercase commit SHA)");
    }
  }
  return { ok: missingVariables.length === 0 && missingBindings.length === 0 && missingFiles.length === 0 && invalid.length === 0 && configInspection.unverifiedConfiguration.length === 0, profile, missingVariables, missingBindings, missingFiles, unverifiedConfiguration: configInspection.unverifiedConfiguration, invalid };
}

function parseArguments(args) {
  if (args[0] !== "--profile" || !args[1]) return null;
  if (args.length === 2) return { profile: args[1] };
  if (args.length === 4 && args[2] === "--wrangler-config" && args[3]) return { profile: args[1], wranglerConfigPath: args[3] };
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArguments(process.argv.slice(2));
  if (!args) {
    console.error("Usage: node scripts/check-environment.mjs --profile public-local|owner-local|cloudflare|collector|rollback [--wrangler-config <wrangler.jsonc>]");
    process.exitCode = 2;
  } else {
    const { profile } = args;
    const result = checkEnvironment(profile, process.env, args);
    if (result.error) {
      console.error(result.error);
      process.exitCode = 2;
    } else {
      console.log(`Environment profile: ${profile}`);
      for (const [label, names] of [["Missing variables", result.missingVariables], ["Missing bindings", result.missingBindings], ["Unverified configuration", result.unverifiedConfiguration], ["Missing/unreadable files", result.missingFiles], ["Invalid values", result.invalid]]) {
        if (names.length) console.log(`${label}: ${names.join(", ")}`);
      }
      if (result.ok) console.log("Required configuration is present.");
      else process.exitCode = 1;
    }
  }
}
