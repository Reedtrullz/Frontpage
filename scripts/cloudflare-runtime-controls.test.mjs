import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { assertLocalBindings, buildConfig, collectRuntimeIdentity, dirBytes, fixtureRecord, sha256, groupAlive, nativeLimits, nativeRuntimeEnv, processIdentity, spawnOwned } from "../tests/cloudflare/runtime.mjs";

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

test("native env confines every Wrangler output path to the scratch root and overrides inherited values", () => {
  const scratch = path.resolve("/measured/scratch");
  const inherited = { HOME: "/home/real", TMPDIR: "/tmp/real", XDG_CACHE_HOME: "/x/cache", WRANGLER_LOG_PATH: "/x/log", WRANGLER_CACHE_DIR: "/x/wc", PATH: "/bin" };
  const { env, dirs } = nativeRuntimeEnv(inherited, scratch);
  for (const name of ["HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "WRANGLER_LOG_PATH", "WRANGLER_REGISTRY_PATH", "WRANGLER_CACHE_DIR"]) {
    assert.ok(path.relative(scratch, env[name]).split(path.sep)[0] !== ".." && !path.isAbsolute(path.relative(scratch, env[name])), name + " escapes scratch: " + env[name]);
  }
  assert.equal(env.PATH, "/bin");
  assert.ok(Object.values(dirs).every(dir => dir.startsWith(scratch + path.sep)));
  // Negative control: the containment predicate used above rejects a path outside the root.
  assert.ok(path.relative(scratch, inherited.HOME).startsWith(".."));
});

test("spawn failure rejects with groupAbsent, leaves no unhandled error and no stray group", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cf-controls-"));
  try {
    await assert.rejects(spawnOwned(path.join(dir, "no-such-binary"), [], { cwd: dir, env: process.env, logDir: dir, scratch: dir, limits: nativeLimits }), error => error.groupAbsent === true && /spawn failed/.test(error.message));
    await delay(50);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an unmeasurable scratch tree ends the run as a poller-error breach and joins the group", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cf-controls-"));
  try {
    await writeFile(path.join(dir, "not-a-dir"), "x");
    const handle = await spawnOwned(process.execPath, ["-e", idle], { cwd: dir, env: process.env, logDir: dir, scratch: path.join(dir, "not-a-dir"), limits: { ...nativeLimits, pollMs: 25 } });
    await until(() => handle.report.breaches.length);
    const report = await handle.stop();
    assert.equal(report.breaches[0].kind, "poller-error");
    assert.ok(report.errors.some(item => item.startsWith("poller:")));
    assert.equal(report.cleanup.groupGone, true);
    assert.equal(groupAlive(handle.pid), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("limits: the elapsed wall clock is enforced when the monotonic clock has not advanced", async t => {
  await owned(idle, { wallMs: 60_000 }, async handle => {
    const real = Date.now;
    t.mock.method(Date, "now", () => real() + 120_000);
    await until(() => handle.report.breaches.length);
    const report = await handle.stop();
    assert.equal(report.breaches[0].kind, "wall-ms");
    assert.ok(report.peak.elapsedMs < 60_000 && report.breaches[0].observed >= 120_000);
    assert.equal(report.cleanup.groupGone, true);
  });
});

test("runtime identity resolves pnpm-style installs from the wrangler edge, probes the binary and hashes fixtures", async () => {
  const key = { "linux-x64": "linux-64", "linux-arm64": "linux-arm64", "darwin-x64": "darwin-64", "darwin-arm64": "darwin-arm64" }[process.platform + "-" + process.arch];
  const dir = await mkdtemp(path.join(tmpdir(), "cf-identity-"));
  try {
    const store = path.join(dir, ".pnpm/wrangler@1/node_modules");
    const pkg = async (base, name, version) => { await mkdir(path.join(base, name), { recursive: true }); await writeFile(path.join(base, name, "package.json"), JSON.stringify({ version })); };
    await pkg(store, "wrangler", "1.0.0"); await pkg(store, "miniflare", "2.0.0"); await pkg(store, "workerd", "3.0.0"); await pkg(store, "@cloudflare/workerd-" + key, "3.0.1");
    await mkdir(path.join(dir, "node_modules"));
    await symlink(path.join(store, "wrangler"), path.join(dir, "node_modules/wrangler"));
    const bin = path.join(store, "@cloudflare/workerd-" + key, "bin/workerd");
    await mkdir(path.dirname(bin)); await writeFile(bin, "#!/bin/sh\necho workerd fake-1\n"); await chmod(bin, 0o755);
    await writeFile(path.join(dir, "a.txt"), "abc");
    const event = path.join(dir, "event.json");
    await writeFile(event, JSON.stringify({ pull_request: { head: { sha: "h".repeat(40) }, base: { sha: "b".repeat(40) } } }));
    const id = await collectRuntimeIdentity(dir, { GITHUB_SHA: "m".repeat(40), GITHUB_EVENT_PATH: event }, ["a.txt", "missing.txt"]);
    assert.deepEqual(id.blocked, []);
    assert.deepEqual(Object.values(id.packages).map(item => item.version), ["1.0.0", "2.0.0", "3.0.0", "3.0.1"]);
    assert.equal(id.workerdVersion.output, "workerd fake-1");
    assert.deepEqual(id.files, { "a.txt": sha256("abc"), "missing.txt": null });
    assert.equal(id.source.prHeadSha, "h".repeat(40));
    assert.equal(id.source.checkoutIsPrHead, false);
    const blocked = await collectRuntimeIdentity(path.join(dir, "empty"), {}, []);
    assert.ok(blocked.blocked.length > 0 && blocked.workerdVersion === undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
  const valid = fixtureRecord("c", "n", Buffer.from("abc"), Buffer.from("zz"));
  assert.deepEqual([valid.decodedBytes, valid.decodedSha256, valid.decodedValid, valid.gzipSha256], [3, sha256("abc"), true, sha256("zz")]);
  const invalid = fixtureRecord("c", "n", null, Buffer.from("not gzip"));
  assert.deepEqual([invalid.decodedBytes, invalid.decodedSha256, invalid.decodedValid], [null, null, false]);
});

