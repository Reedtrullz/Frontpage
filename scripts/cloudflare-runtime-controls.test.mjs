import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { assertLocalBindings, buildConfig, dirBytes, groupAlive, nativeLimits, processIdentity, spawnOwned } from "../tests/cloudflare/runtime.mjs";

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await delay(25)) { const value = await check(); if (value) return value; }
  throw new Error("condition not reached");
}
const idle = "setInterval(() => {}, 1000);";
// Leader that also starts one grandchild in the same group and prints its pid.
const withGrandchild = ignoreTerm => `
  ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""}
  const g = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify((ignoreTerm ? "process.on('SIGTERM', () => {});" : "") + idle)}], {stdio: 'ignore'});
  console.log('gc ' + g.pid);
  ${idle}`;

async function owned(script, limits, run) {
  const dir = await mkdtemp(path.join(tmpdir(), "cf-controls-"));
  let handle;
  try {
    handle = await spawnOwned(process.execPath, ["-e", script], { cwd: dir, env: process.env, logDir: dir, scratch: dir, limits: { ...nativeLimits, pollMs: 25, ...limits } });
    await run(handle, dir);
  } finally {
    await handle?.stop();
    await rm(dir, { recursive: true, force: true });
  }
}
const grandchildPid = dir => until(async () => (await readFile(path.join(dir, "runtime.stdout.log"), "utf8").catch(() => "")).match(/gc (\d+)/)?.[1]).then(Number);

test("binding guard accepts the exact native and legacy configs", () => {
  for (const options of [{}, { entry: "native-entry.mjs", vars: { QA_SEED_KEY: "a".repeat(64) } }, { missingBinding: true }]) {
    assert.doesNotThrow(() => buildConfig(options));
  }
});

test("binding guard rejects unknown keys, remote values and remote bindings", () => {
  const { config, upstream } = buildConfig();
  const mutations = {
    "unknown var": c => { c.vars.EXTRA = "x"; },
    "remote origin value": c => { c.vars.PROPOSALS_ORIGIN = "https://evil.example"; },
    "remote auth url": c => { c.vars.AUTH_URL = "https://evil.example"; },
    "non-hex seed key": c => { c.vars.QA_SEED_KEY = "short"; },
    "non-string value": c => { c.vars.VERSION = 1; },
    "extra binding kind": c => { c.kv_namespaces = [{ binding: "KV", id: "x" }]; },
    "remote durable object": c => { c.durable_objects.bindings[0].script_name = "other"; },
    "foreign service": c => { c.services[0].service = "other"; },
    "extra service": c => { c.services.push({ binding: "X", service: "other" }); },
    "foreign entry": c => { c.main = "/tmp/entry.mjs"; },
    "remote assets": c => { c.assets.directory = "/tmp/assets"; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const copy = structuredClone(config);
    mutate(copy);
    assert.throws(() => assertLocalBindings(copy, upstream), name);
  }
  assert.throws(() => assertLocalBindings(config, { ...upstream, main: "/tmp/upstream.mjs" }), "foreign upstream");
});

test("owned process group: identity observed, TERM and join leave no member alive", async () => {
  await owned(withGrandchild(false), {}, async (handle, dir) => {
    const gc = await grandchildPid(dir);
    assert.equal(handle.report.identity.pgid, handle.pid);
    assert.deepEqual(await processIdentity(handle.pid), handle.report.identity);
    const report = await handle.stop();
    assert.deepEqual([report.cleanup.term, report.cleanup.kill, report.cleanup.groupGone], [true, false, true]);
    assert.equal(report.cleanup.exit.signal, "SIGTERM");
    assert.deepEqual([alive(handle.pid), alive(gc), groupAlive(handle.pid)], [false, false, false]);
  });
});

test("owned process group: members that ignore SIGTERM are killed and joined", async () => {
  await owned(withGrandchild(true), {}, async (handle, dir) => {
    const gc = await grandchildPid(dir);
    await delay(100);
    const report = await handle.stop();
    assert.deepEqual([report.cleanup.term, report.cleanup.kill, report.cleanup.groupGone], [true, true, true]);
    assert.deepEqual([alive(handle.pid), alive(gc)], [false, false]);
  });
});

test("limits: a quiet child within every cap records no breach", async () => {
  await owned("console.log('ok');" + idle, { wallMs: 5000 }, async handle => {
    await delay(300);
    assert.deepEqual((await handle.stop()).breaches, []);
  });
});

test("limits: wall deadline, per-stream bytes and scratch bytes each stop the group", async () => {
  await owned(idle, { wallMs: 200 }, async handle => {
    await until(() => handle.report.breaches.length);
    assert.equal(handle.report.breaches[0].kind, "wall-ms");
    assert.ok(handle.report.breaches[0].observed >= 200);
    assert.equal((await handle.stop()).cleanup.groupGone, true);
    assert.equal(groupAlive(handle.pid), false);
  });
  await owned("setInterval(() => process.stdout.write('x'.repeat(512)), 10);", { perStreamBytes: 1024 }, async (handle, dir) => {
    await until(() => handle.report.breaches.length);
    const report = await handle.stop();
    assert.equal(report.breaches[0].kind, "stdout-bytes");
    assert.ok(report.peak.stdoutBytes > 1024);
    assert.equal((await readFile(path.join(dir, "runtime.stdout.log"))).length, 1024);
    assert.equal(report.cleanup.groupGone, true);
  });
  await owned("require('node:fs').writeFileSync('big.bin', Buffer.alloc(40000));" + idle, { scratchBytes: 10000 }, async (handle, dir) => {
    await until(() => handle.report.breaches.length);
    const report = await handle.stop();
    assert.equal(report.breaches[0].kind, "scratch-bytes");
    assert.ok(report.breaches[0].observed > 10000 && report.peak.scratchBytes > 10000);
    assert.equal(report.cleanup.groupGone, true);
    assert.ok(await dirBytes(dir) >= 40000);
  });
});

test("dirBytes sums nested files and treats a missing directory as empty", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cf-controls-"));
  try {
    await mkdir(path.join(dir, "sub"));
    await writeFile(path.join(dir, "a"), Buffer.alloc(10));
    await writeFile(path.join(dir, "sub", "b"), Buffer.alloc(5));
    assert.equal(await dirBytes(dir), 15);
    assert.equal(await dirBytes(path.join(dir, "missing")), 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
