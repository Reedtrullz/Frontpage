import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseDocument } from "yaml";

const workflowText = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const workflowDocument = parseDocument(workflowText, { version: "1.2" });
assert.deepEqual(workflowDocument.errors, [], "workflow YAML parses without errors");
const workflow = workflowDocument.toJS();
const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

test("workflow preserves stacked issue branch filters and owner transport regression", () => {
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.deepEqual(workflow.on.pull_request.branches, ["main", "codex/frontpage-*"]);
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
  assert.ok(workflow.jobs.test.steps.some((step) => step.run === "node --test ops/owner-state-transport.test.mjs"));
});

test("CI uses exact Node and Ansible pins and runs all operational script regressions", () => {
  assert.equal(workflow.env.NODE_VERSION, "22.22.3");
  const testRuns = workflow.jobs.test.steps.map((step) => step.run).filter(Boolean);
  assert.ok(testRuns.includes("node --test --test-concurrency=1 scripts/*.test.mjs"));
  assert.ok(testRuns.some((run) => run.includes("pip install -r ops/requirements-ansible.txt")));
  assert.ok(testRuns.some((run) => run.includes("ansible-galaxy collection install -r ops/ansible/requirements.yml")));
  assert.ok(!workflowText.includes("ssh-keyscan"));
  assert.ok(!workflowText.includes("npm install --no-save"));
  assert.ok(!dockerfile.includes("npm install --no-save"));
});

test("preload pins the trusted host and every SSH invocation uses the configured identity strictly", () => {
  const preload = workflow.jobs.preload;
  assert.deepEqual(preload.permissions, { contents: "read", packages: "read" });
  const installPin = preload.steps.find((step) => step.name === "Install verified RackNerd host key");
  assert.ok(installPin);
  assert.equal(installPin.env.RACKNERD_KNOWN_HOSTS, "${{ secrets.RACKNERD_KNOWN_HOSTS }}");
  assert.match(installPin.run, /node scripts\/install-known-hosts\.mjs/);
  const sshScript = preload.steps.filter((step) => step.run).map((step) => step.run).join("\n").replace(/\\\n\s*/g, " ");
  const sshCalls = [...sshScript.matchAll(/(?:^|\s)(ssh\s+-i[^\n]*)/g)].map((match) => match[1]);
  assert.equal(sshCalls.length, 2);
  for (const call of sshCalls) {
    assert.match(call, /-i .*id_ed25519_racknerd/);
    assert.match(call, /IdentitiesOnly=yes/);
    assert.match(call, /IdentityAgent=none/);
    assert.match(call, /StrictHostKeyChecking=yes/);
    assert.match(call, /UserKnownHostsFile=.*known_hosts/);
  }
});

test("Docker validation builds and smoke-tests each Linux architecture on dispatch", () => {
  const dockerCheck = workflow.jobs["docker-check"];
  assert.match(dockerCheck.if, /workflow_dispatch/);
  assert.deepEqual(dockerCheck.strategy.matrix.include.map((entry) => entry.platform), ["linux/amd64", "linux/arm64"]);
  const names = dockerCheck.steps.map((step) => step.name);
  assert.ok(names.indexOf("Set up QEMU") < names.indexOf("Set up Docker Buildx"));
  assert.ok(dockerCheck.steps.some((step) => step.uses === "docker/setup-qemu-action@v4"));
  const nodeSetup = dockerCheck.steps.find((step) => step.uses === "actions/setup-node@v6");
  assert.ok(nodeSetup);
  assert.equal(nodeSetup.with["node-version"], "${{ env.NODE_VERSION }}");
  const build = dockerCheck.steps.find((step) => step.name === "Build image");
  assert.equal(build.with.platforms, "${{ matrix.platform }}");
  assert.equal(build.with.load, true);
  assert.ok(dockerCheck.steps.some((step) => step.run?.includes("tests/docker-runtime-smoke.mjs")));
  for (const name of ["publish", "deploy-cloudflare", "preload"]) {
    assert.match(workflow.jobs[name].if, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  }
});

test("exact-domain release verification follows the deployed Worker SHA check", () => {
  const steps = workflow.jobs["deploy-cloudflare"].steps;
  const worker = steps.findIndex((step) => step.name === "Verify Worker commit");
  const domain = steps.findIndex((step) => step.name === "Verify intended domain release");
  assert.ok(worker >= 0 && domain > worker);
  assert.match(steps[domain].run, /node scripts\/verify-release\.mjs/);
  assert.match(steps[domain].run, /https:\/\/reidar\.tech/);
});
