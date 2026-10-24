import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
export const base = 'http://127.0.0.1:8788';
export const version = 'c'.repeat(40);
export const secret = 'frontpage-local-runtime-only-secret';
const root = process.cwd();
const scratchParent = path.join(root, '.superpowers/sdd/2026-10-03-all-open-issues');
const scratch = path.join(scratchParent, 'cloudflare-'+randomUUID());
// Active limits for the native run. Enforcement is by sampling (scratch) and by byte counting on
// the child pipes; it is not an OS quota, so a burst can overshoot a cap by up to one poll interval.
export const nativeLimits = Object.freeze({ wallMs: 120_000, perStreamBytes: 1024 * 1024, scratchBytes: 16 * 1024 * 1024, pollMs: 250 });

const allowedVars = {
  AUTH_SECRET: value => value === secret,
  AUTH_URL: value => value === base,
  OWNER_GITHUB_ID: value => value === 'runtime-owner',
  VERSION: value => value === version,
  // Only parsed as a URL; dispatch goes through the local PROPOSALS_ORIGIN_SERVICE binding.
  PROPOSALS_ORIGIN: value => value === 'https://proposals-origin.reidar.tech',
  PROPOSALS_ORIGIN_TOKEN: value => value === 'local-proxy-token',
  COLLECTOR_UPLOAD_SECRET: value => value === 'local-collector-token',
  QA_SEED_KEY: value => /^[0-9a-f]{64}$/.test(value),
};

// Rejects any key or value that could reach beyond the local Worker, its own DO, assets and the local upstream.
export function assertLocalBindings(config, upstream) {
  const allowed = ['name', 'main', 'compatibility_date', 'compatibility_flags', 'assets', 'durable_objects', 'migrations', 'services', 'vars'];
  for (const key of Object.keys(config)) assert.ok(allowed.includes(key), 'unknown config key ' + key);
  assert.equal(config.name, 'frontpage-runtime-test');
  assert.ok(['entry.mjs', 'native-entry.mjs'].some(entry => config.main === path.join(root, 'tests/cloudflare', entry)), 'unknown entry');
  assert.equal(config.compatibility_date, '2026-09-28');
  assert.deepEqual(config.compatibility_flags, ['nodejs_compat']);
  assert.deepEqual(config.assets, { directory: path.join(root, '.open-next/assets'), binding: 'ASSETS' });
  assert.deepEqual(Object.keys(config.durable_objects), ['bindings']);
  assert.ok(config.durable_objects.bindings.length <= 1);
  for (const binding of config.durable_objects.bindings) assert.deepEqual(binding, { name: 'FRONTPAGE', class_name: 'FrontpageDO' });
  assert.deepEqual(config.migrations, [{ tag: 'v1', new_sqlite_classes: ['FrontpageDO'] }]);
  assert.deepEqual(config.services, [{ binding: 'PROPOSALS_ORIGIN_SERVICE', service: 'frontpage-test-upstream' }]);
  assert.deepEqual(upstream, { name: 'frontpage-test-upstream', main: path.join(root, 'tests/cloudflare/upstream.mjs'), compatibility_date: '2026-09-28' });
  for (const [name, value] of Object.entries(config.vars)) {
    assert.ok(Object.hasOwn(allowedVars, name), 'unknown binding var ' + name);
    assert.equal(typeof value, 'string');
    assert.ok(allowedVars[name](value), 'binding value not allowed for ' + name);
  }
}

export function buildConfig({ missingBinding = false, entry = 'entry.mjs', vars = {} } = {}) {
  const upstream = { name: 'frontpage-test-upstream', main: path.join(root, 'tests/cloudflare/upstream.mjs'), compatibility_date: '2026-09-28' };
  const config = {
    name: 'frontpage-runtime-test', main: path.join(root, 'tests/cloudflare', entry), compatibility_date: '2026-09-28', compatibility_flags: ['nodejs_compat'],
    assets: { directory: path.join(root, '.open-next/assets'), binding: 'ASSETS' },
    durable_objects: { bindings: missingBinding ? [] : [{ name: 'FRONTPAGE', class_name: 'FrontpageDO' }] },
    migrations: [{tag: 'v1', new_sqlite_classes: ['FrontpageDO']}],
    services: [{binding: 'PROPOSALS_ORIGIN_SERVICE', service: 'frontpage-test-upstream'}],
    vars: { AUTH_SECRET: secret, AUTH_URL: base, OWNER_GITHUB_ID: 'runtime-owner', VERSION: version, PROPOSALS_ORIGIN: 'https://proposals-origin.reidar.tech', PROPOSALS_ORIGIN_TOKEN: 'local-proxy-token', COLLECTOR_UPLOAD_SECRET: 'local-collector-token', ...vars },
  };
  assertLocalBindings(config, upstream);
  return { config, upstream };
}

export async function dirBytes(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  let total = 0;
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    try { total += entry.isDirectory() ? await dirBytes(target) : (await lstat(target)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return total;
}

export async function processIdentity(pid) {
  try {
    const { stdout } = await promisify(execFile)('ps', ['-o', 'pid=,pgid=,lstart=', '-p', String(pid)]);
    const match = stdout.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return match ? { pid: Number(match[1]), pgid: Number(match[2]), start: match[3].replace(/\s+/g, ' ') } : null;
  } catch { return null; }
}

export function groupAlive(pgid) {
  try { process.kill(-pgid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

async function groupGone(pgid, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (groupAlive(pgid)) { if (performance.now() > deadline) return false; await delay(50); }
  return true;
}

// Starts file as the leader of its own process group, records the observed pid/pgid/start identity,
// enforces the limits while it runs, and on stop() terminates and joins the whole group.
export async function spawnOwned(file, args, { cwd, env, logDir, scratch: watched, limits }) {
  const startedAt = performance.now();
  const child = spawn(file, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  if (!child.pid) throw new Error('spawn failed');
  const identity = await processIdentity(child.pid);
  if (!identity || identity.pgid !== child.pid) {
    child.kill('SIGKILL');
    await exited;
    throw new Error('child is not the leader of its own process group: ' + JSON.stringify(identity));
  }
  const report = { identity, limits, breaches: [], peak: { scratchBytes: 0, stdoutBytes: 0, stderrBytes: 0, elapsedMs: 0 }, cleanup: null };
  let stopPromise;
  let hasExited = false;
  void exited.then(() => { hasExited = true; });
  const breach = (kind, limit, observed) => {
    if (report.breaches.some(item => item.kind === kind)) return;
    report.breaches.push({ kind, limit, observed });
    stop().catch(error => { report.cleanup = { ...report.cleanup, error: String(error) }; });
  };
  const sinks = ['stdout', 'stderr'].map(name => {
    const sink = createWriteStream(path.join(logDir, 'runtime.' + name + '.log'), { flags: 'a' });
    let seen = 0;
    child[name].on('data', chunk => {
      const room = Math.max(0, limits.perStreamBytes - seen);
      if (room) sink.write(chunk.subarray(0, room));
      seen += chunk.length;
      report.peak[name + 'Bytes'] = seen;
      if (seen > limits.perStreamBytes) breach(name + '-bytes', limits.perStreamBytes, seen);
    });
    return sink;
  });
  const wallTimer = setTimeout(() => breach('wall-ms', limits.wallMs, Math.round(performance.now() - startedAt)), limits.wallMs);
  let polling = false;
  const poller = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      report.peak.elapsedMs = Math.round(performance.now() - startedAt);
      const bytes = await dirBytes(watched);
      report.peak.scratchBytes = Math.max(report.peak.scratchBytes, bytes);
      if (bytes > limits.scratchBytes) breach('scratch-bytes', limits.scratchBytes, bytes);
    } finally { polling = false; }
  }, limits.pollMs);
  const signalGroup = signal => { try { process.kill(-identity.pgid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  function stop() {
    stopPromise ??= (async () => {
      clearInterval(poller);
      clearTimeout(wallTimer);
      report.peak.elapsedMs = Math.round(performance.now() - startedAt);
      const cleanup = report.cleanup = { identityChecked: null, term: false, kill: false };
      if (groupAlive(identity.pgid)) {
        const current = await processIdentity(identity.pid);
        cleanup.identityChecked = current ? current.start === identity.start && current.pgid === identity.pgid : 'leader-already-exited';
        if (cleanup.identityChecked === false) throw new Error('pid identity changed; refusing to signal the group');
        signalGroup('SIGTERM'); cleanup.term = true;
        if (!await groupGone(identity.pgid, 5000)) {
          signalGroup('SIGKILL'); cleanup.kill = true;
          if (!await groupGone(identity.pgid, 5000)) throw new Error('process group did not exit after SIGKILL');
        }
      }
      cleanup.exit = await exited;
      cleanup.groupGone = !groupAlive(identity.pgid);
      await Promise.all(sinks.map(sink => new Promise(resolve => sink.end(resolve))));
      return report;
    })();
    return stopPromise;
  }
  return { pid: child.pid, report, stop, hasExited: () => hasExited };
}

export async function startRuntime({ missingBinding = false, native = false } = {}) {
  if (native) return startNativeRuntime();
  const { config, upstream } = buildConfig({ missingBinding });
  await mkdir(scratch, { recursive: true });
  await writeFile(path.join(scratch, 'main.json'), JSON.stringify(config));
  await writeFile(path.join(scratch, 'upstream.json'), JSON.stringify(upstream));
  const output = await open(path.join(scratch, 'runtime.log'), 'a');
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', path.join(scratch,'main.json'), '--config', path.join(scratch,'upstream.json'), '--port', '8788', '--persist-to', path.join(scratch,'state')], { cwd: root, stdio: ['ignore', output.fd, output.fd], env: {...process.env, WRANGLER_SEND_METRICS: 'false'} });
  const stop = async () => { child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null) child.kill('SIGKILL'); await output.close(); };
  try {
    for(let attempt=0;attempt<150;attempt++) {
      if(child.exitCode !== null) throw new Error('Wrangler exited; inspect local runtime.log');
      try { const response = await fetch(base+'/api/health', {signal: AbortSignal.timeout(1500)}); if(response.status === (missingBinding ? 500 : 200)) return {stop}; } catch {}
      await delay(200);
    }
    throw new Error('Wrangler readiness deadline exceeded; inspect local runtime.log');
  } catch(error) { await stop(); throw error; }
}

// Native run: fresh persistence/session, SUT behind native-entry.mjs, active limits, own process group.
async function startNativeRuntime() {
  const nativeScratch = path.join(scratchParent, 'cloudflare-native-' + randomUUID());
  const qaKey = randomBytes(32).toString('hex');
  const { config, upstream } = buildConfig({ entry: 'native-entry.mjs', vars: { QA_SEED_KEY: qaKey } });
  await mkdir(nativeScratch, { recursive: true });
  await writeFile(path.join(nativeScratch, 'main.json'), JSON.stringify(config));
  await writeFile(path.join(nativeScratch, 'upstream.json'), JSON.stringify(upstream));
  const owned = await spawnOwned(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', path.join(nativeScratch,'main.json'), '--config', path.join(nativeScratch,'upstream.json'), '--port', '8788', '--persist-to', path.join(nativeScratch,'state')], { cwd: root, env: {...process.env, WRANGLER_SEND_METRICS: 'false'}, logDir: nativeScratch, scratch: nativeScratch, limits: nativeLimits });
  const stop = async () => {
    try { return await owned.stop(); } finally {
      await rm(nativeScratch, { recursive: true, force: true });
      await stat(nativeScratch).then(() => { throw new Error('native scratch was not removed'); }, error => { if (error.code !== 'ENOENT') throw error; });
    }
  };
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (owned.report.breaches.length) throw new Error('native limit breached: ' + JSON.stringify(owned.report.breaches));
      if (owned.hasExited()) throw new Error('Wrangler exited before readiness');
      try { const response = await fetch(base+'/api/health', {signal: AbortSignal.timeout(1500)}); if (response.status === 200) return { stop, qaKey, report: owned.report, scratch: nativeScratch }; } catch {}
      await delay(200);
    }
    throw new Error('Wrangler readiness deadline exceeded');
  } catch (error) { await stop(); throw error; }
}
