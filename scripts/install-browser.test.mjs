import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { parseDocument } from "yaml";

const moduleUrl = new URL("./install-browser.mjs", import.meta.url);
async function installer() {
  assert.ok(fs.existsSync(moduleUrl), "bounded installer is missing");
  return (await import(moduleUrl)).runInstaller;
}
function capture() {
  let text = "";
  return { output: { write: (chunk) => { text += chunk; } }, read: () => text };
}
function running(pid) {
  const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  return result.status === 0 && !result.stdout.trim().startsWith("Z");
}
const stalled = `
  const {spawn} = require('node:child_process');
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {stdio:'ignore'});
  process.on('SIGTERM',()=>{});
  console.log('Installing dependencies...');
  console.log('descendant='+child.pid);
  setInterval(()=>{},1000);
`;

test("both browser lanes invoke the bounded installer before their runtime gates", () => {
  const workflow = parseDocument(fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")).toJS();
  for (const job of [workflow.jobs.test, workflow.jobs.browser]) {
    assert.equal(job.steps.filter(step => step.run === "node scripts/install-browser.mjs").length, 1);
    assert.ok(!job.steps.some(step => step.run?.includes("playwright install --with-deps")));
  }
});

test("the installer deadline defaults to and is capped at a bounded 15 minutes", async () => {
  const run = await installer(), { MAX_INSTALL_MS } = await import(moduleUrl);
  assert.equal(MAX_INSTALL_MS, 900_000);
  assert.throws(() => run({ timeoutMs: MAX_INSTALL_MS + 1 }), /Invalid installer platform or deadline/);
  assert.throws(() => run({ timeoutMs: 0 }), /Invalid installer platform or deadline/);
});

test("successful installation preserves output and records browser phase and safe runner metadata", async () => {
  const run = await installer(), logs = capture();
  const result = await run({ command: process.execPath, args: ["-e", "console.log('Installing dependencies...');console.log('Downloading Chromium 1...')"], timeoutMs: 1000, graceMs: 100, output: logs.output, env: { ...process.env, ImageOS: "ubuntu24", ImageVersion: "20261004.327.1", PRIVATE_TOKEN: "never-log-this" } });
  assert.equal(result.code, 0);
  assert.equal(result.phase, "browser-acquisition");
  assert.match(logs.read(), /Downloading Chromium/);
  assert.match(logs.read(), /20261004\.327\.1/);
  assert.match(logs.read(), /elapsed_ms/);
  assert.doesNotMatch(logs.read(), /never-log-this|PRIVATE_TOKEN/);
});

test("nonzero installer exit propagates instead of permitting downstream gates", async () => {
  const run = await installer(), logs = capture();
  const result = await run({ command: process.execPath, args: ["-e", "process.exit(17)"], timeoutMs: 1000, graceMs: 100, output: logs.output });
  assert.equal(result.code, 17);
  assert.equal(result.reason, "exit");
});

test("stalled OS acquisition kills only owned descendants, including those ignoring SIGTERM", async (t) => {
  const run = await installer(), logs = capture();
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
  t.after(() => unrelated.kill("SIGKILL"));
  const result = await run({ command: process.execPath, args: ["-e", stalled], timeoutMs: 1000, graceMs: 100, output: logs.output });
  assert.equal(result.code, 124);
  assert.equal(result.phase, "os-acquisition");
  assert.equal(result.reason, "timeout");
  const pid = Number(logs.read().match(/descendant=(\d+)/)?.[1]);
  assert.ok(pid > 0);
  await delay(100);
  assert.equal(running(pid), false, "owned child must stop");
  assert.equal(running(unrelated.pid), true, "unrelated process must survive");
});

test("Linux CI also terminates sudo-owned installer descendants", { skip: process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" }, async () => {
  const run = await installer(), logs = capture();
  const result = await run({ command: "sudo", args: ["-n", process.execPath, "-e", stalled], timeoutMs: 1000, graceMs: 100, output: logs.output });
  assert.equal(result.code, 124);
  const pid = Number(logs.read().match(/descendant=(\d+)/)?.[1]);
  assert.ok(pid > 0);
  await delay(100);
  assert.equal(running(pid), false);
});

test("cancelling the wrapper terminates its owned installer and exits unsuccessfully", async () => {
  await installer();
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import {runInstaller} from ${JSON.stringify(moduleUrl.href)};
    const result = await runInstaller({command:process.execPath,args:['-e',${JSON.stringify(stalled)}],timeoutMs:3000,graceMs:100});
    process.exitCode = result.code;
  `], { stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  const ready = new Promise(resolve => child.stdout.on("data", chunk => { logs += chunk; if (/descendant=\d+/.test(logs)) resolve(); }));
  const exited = once(child, "exit");
  await ready;
  child.kill("SIGTERM");
  const [code] = await exited;
  assert.equal(code, 143);
  await delay(100);
  assert.equal(running(Number(logs.match(/descendant=(\d+)/)[1])), false);
});
