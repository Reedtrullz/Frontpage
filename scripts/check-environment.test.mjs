import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkEnvironment } from "./check-environment.mjs";

const sentinel = "DO_NOT_PRINT_SENTINEL_7f3c";

test("public local profile needs no owner secrets", () => {
  const result = checkEnvironment("public-local", {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingVariables, []);
  assert.deepEqual(result.missingBindings, []);
});

test("owner and collector profiles report missing names without values", () => {
  const owner = checkEnvironment("owner-local", { AUTH_SECRET: sentinel });
  assert.equal(owner.ok, false);
  assert.ok(owner.missingVariables.includes("GITHUB_TOKEN"));
  assert.ok(!JSON.stringify(owner).includes(sentinel));

  const collector = checkEnvironment("collector", {
    FRONTPAGE_METRICS_DIR: "/tmp/metrics",
    FRONTPAGE_UPLOAD_URL: "https://example.test",
    FRONTPAGE_UPLOAD_SECRET_FILE: "/private/token-file",
  });
  assert.equal(collector.ok, false);
  assert.ok(collector.missingFiles.includes("FRONTPAGE_UPLOAD_SECRET_FILE"));
  assert.ok(!JSON.stringify(collector).includes("/private/token-file"));
});

test("cloudflare reports its SQL binding and absent required environment names", () => {
  const result = checkEnvironment("cloudflare", { AUTH_SECRET: sentinel });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingBindings, ["FRONTPAGE_SQL"]);
  assert.ok(result.missingVariables.includes("COLLECTOR_UPLOAD_SECRET"));
  assert.ok(!JSON.stringify(result).includes(sentinel));
});

test("rollback profile requires an explicit flag and a full SHA", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-vault-check-"));
  try {
    const passwordFile = path.join(directory, "vault-password");
    fs.writeFileSync(passwordFile, sentinel);
    assert.equal(checkEnvironment("rollback", { FRONTPAGE_VPS_ROLLBACK: "1", GITHUB_SHA: "a".repeat(40), FRONTPAGE_VAULT_PASSWORD_FILE: passwordFile }).ok, true);
    assert.equal(checkEnvironment("rollback", { FRONTPAGE_VPS_ROLLBACK: "1", GITHUB_SHA: "short", FRONTPAGE_VAULT_PASSWORD_FILE: passwordFile }).ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI output never prints supplied sentinel values", () => {
  const result = spawnSync(process.execPath, ["scripts/check-environment.mjs", "--profile", "owner-local"], {
    encoding: "utf8",
    env: { ...process.env, AUTH_SECRET: sentinel },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /GITHUB_TOKEN/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(sentinel));
});

test("current-state output records source state and never overwrites an existing file", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-current-state-"));
  try {
    const repo = path.join(temp, "repo");
    fs.mkdirSync(repo);
    for (const args of [["init", "-q"], ["config", "user.email", "test@example.invalid"], ["config", "user.name", "Test"]]) {
      const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
    }
    fs.writeFileSync(path.join(repo, "DEPLOYMENT.md"), "source\n");
    for (const args of [["add", "DEPLOYMENT.md"], ["commit", "-qm", "fixture"]]) {
      const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
    }
    const output = path.join(temp, "state.md");
    let run = spawnSync(process.execPath, [fileURLToPath(new URL("./current-state.mjs", import.meta.url)), "--output", output], { cwd: repo, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const generated = fs.readFileSync(output, "utf8");
    assert.match(generated, /full commit SHA: `[a-f0-9]{40}`/);
    assert.match(generated, /dirty entries: 0/);
    assert.match(generated, /DEPLOYMENT.md/);
    run = spawnSync(process.execPath, [fileURLToPath(new URL("./current-state.mjs", import.meta.url)), "--output", output], { cwd: repo, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(fs.readFileSync(output, "utf8"), /DEPLOYMENT.md/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
