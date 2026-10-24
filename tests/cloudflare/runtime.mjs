import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
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

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const sha256File = file => readFile(file).then(sha256, error => { if (error.code === 'ENOENT') return null; throw error; });

// Walks up from fromDir like Node resolution and returns the realpath identity of the first installed package.
export async function findPackage(fromDir, name) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    try {
      const file = await realpath(path.join(dir, 'node_modules', name, 'package.json'));
      return { version: (await readJson(file)).version, dir: path.dirname(file) };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(dir) === dir) return null;
  }
}

const workerdPlatforms = { 'linux-x64': 'linux-64', 'linux-arm64': 'linux-arm64', 'darwin-x64': 'darwin-64', 'darwin-arm64': 'darwin-arm64' };
const identityFiles = ['package.json', 'pnpm-lock.yaml', 'tests/cloudflare/runtime.mjs', 'tests/cloudflare/runtime.test.mjs', 'scripts/cloudflare-runtime-controls.test.mjs', 'tests/cloudflare/native-entry.mjs', 'tests/cloudflare/upstream.mjs', 'cloudflare/do-entry.mjs', 'src/lib/metrics/cloudflare-store.ts', 'src/lib/metrics/v2/reader.ts', 'src/app/api/owner/metrics/route.ts'];
const probe = (file, args, cwd) => promisify(execFile)(file, args, { cwd, timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, env: { PATH: process.env.PATH ?? '' } }).then(({ stdout }) => stdout.trim().slice(0, 200));

// Identity of what actually ran: installed package versions (resolved from the declared wrangler edge, no app imports),
// the bounded --version of the actual workerd binary, checkout/PR heads and file hashes. Missing proof is BLOCKED, never inferred.
export async function collectRuntimeIdentity(rootDir = root, env = process.env, files = identityFiles) {
  const out = { ns: 'frontpage-native-identity/v1', node: process.version, platform: process.platform, arch: process.arch, blocked: [] };
  const wrangler = await findPackage(rootDir, 'wrangler');
  const miniflare = wrangler && await findPackage(wrangler.dir, 'miniflare');
  const workerd = miniflare && await findPackage(miniflare.dir, 'workerd');
  const key = workerdPlatforms[process.platform + '-' + process.arch];
  const binaryPkg = workerd && key && await findPackage(workerd.dir, '@cloudflare/workerd-' + key);
  const rel = pkg => pkg && { version: pkg.version, path: path.relative(rootDir, pkg.dir) };
  out.packages = { wrangler: rel(wrangler), miniflare: rel(miniflare), workerd: rel(workerd), workerdBinaryPackage: rel(binaryPkg) };
  for (const [name, pkg] of Object.entries(out.packages)) if (!pkg) out.blocked.push('package not resolved: ' + name);
  if (binaryPkg) {
    const binary = path.join(binaryPkg.dir, 'bin', 'workerd');
    try { out.workerdVersion = { output: await probe(binary, ['--version'], rootDir), bytes: (await stat(binary)).size }; } catch (error) { out.blocked.push('workerd --version failed: ' + (error.code ?? error.message)); }
  }
  out.files = Object.fromEntries(await Promise.all(files.map(async file => [file, await sha256File(path.join(rootDir, file))])));
  const source = out.source = { githubSha: env.GITHUB_SHA ?? null, ref: env.GITHUB_REF ?? null, event: env.GITHUB_EVENT_NAME ?? null, checkoutHead: await probe('git', ['rev-parse', 'HEAD'], rootDir).catch(() => null), prHeadSha: null, prBaseSha: null };
  if (env.GITHUB_EVENT_PATH) {
    try {
      if ((await stat(env.GITHUB_EVENT_PATH)).size > 10 * 1024 * 1024) throw new Error('event file too large');
      const pr = (await readJson(env.GITHUB_EVENT_PATH)).pull_request;
      source.prHeadSha = pr?.head?.sha ?? null; source.prBaseSha = pr?.base?.sha ?? null;
    } catch (error) { out.blocked.push('event file unreadable: ' + (error.code ?? error.message)); }
  }
  // A pull_request run checks out a merge commit, so GITHUB_SHA and HEAD are not the reviewed PR head.
  source.checkoutIsPrHead = source.prHeadSha ? source.checkoutHead === source.prHeadSha : null;
  return out;
}

// Fails (harness BLOCKED) unless the identity is complete; a missing proof is never a qualified native run.
export function assertIdentityComplete(id) {
  const problems = [...id.blocked];
  for (const name of ['node', 'platform', 'arch']) if (!id[name]) problems.push('missing ' + name);
  for (const [name, pkg] of Object.entries(id.packages ?? {})) if (!pkg?.version) problems.push('missing package ' + name);
  if (!id.workerdVersion?.output) problems.push('missing workerd version');
  for (const [file, hash] of Object.entries(id.files ?? {})) if (!/^[0-9a-f]{64}$/.test(hash ?? '')) problems.push('missing sha256 ' + file);
  if (!/^[0-9a-f]{40}$/.test(id.source?.checkoutHead ?? '')) problems.push('missing checkout head');
  if (id.source?.event === 'pull_request') for (const key of ['prHeadSha', 'prBaseSha']) if (!/^[0-9a-f]{40}$/.test(id.source[key] ?? '')) problems.push('missing ' + key);
  assert.deepEqual(problems, [], 'native identity incomplete (BLOCKED)');
}

// One record per authored fixture: exact decoded bytes/hash when the payload is valid, only the compressed identity when it is not.
export function fixtureRecord(caseName, name, decoded, compressed) {
  return { case: caseName, name, decodedBytes: decoded?.length ?? null, decodedSha256: decoded ? sha256(decoded) : null, decodedValid: Boolean(decoded), gzipBytes: compressed.length, gzipSha256: sha256(compressed) };
}

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

export async function dirBytes(dir, seen, rel = '') {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  let total = 0;
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    const relPath = path.join(rel, entry.name);
    try {
      if (entry.isDirectory()) total += await dirBytes(target, seen, relPath);
      else { const size = (await lstat(target)).size; total += size; seen?.(relPath, size); }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return total;
}

// Diagnostic only: observes the sizes of the poller's own dirBytes walk (no extra I/O, no file contents) and keeps the
// largest topN relative paths. Past maxEntries it stops considering files (truncated) while dirBytes keeps summing every byte.
export function inventoryTracker(maxEntries = 20_000, topN = 20) {
  const top = [];
  let filesSeen = 0, truncated = false;
  const seen = (rel, size) => {
    if (filesSeen >= maxEntries) { truncated = true; return; }
    filesSeen++;
    if (top.length < topN || size > top[top.length - 1].size) {
      top.push({ rel, size });
      top.sort((a, b) => b.size - a.size || (a.rel < b.rel ? -1 : 1));
      if (top.length > topN) top.pop();
    }
  };
  const snapshot = (atMs, walkMs) => {
    const redact = rel => { const clean = rel.replace(/[0-9a-f]{64,}/gi, '<hex64>'); return clean.length > 200 ? '...' + clean.slice(-197) : clean; };
    const out = { scope: 'poller dirBytes walk of the measured scratch root; lstat apparent file sizes only, no contents; sampled, not an OS quota; byte sum covers all files past entryCap', atMs, walkMs, filesSeen, entryCap: maxEntries, truncated, top: top.map(({ rel, size }) => ({ path: redact(rel), size })) };
    while (out.top.length && JSON.stringify(out).length > 7000) out.top.pop();
    return out;
  };
  return { seen, snapshot };
}

// Bounded (default 8 KiB) JSON of an owned handle's report for appending to an error before scratch is deleted.
export function ownedReportText(handle, maxBytes = 8192) {
  const { report } = handle;
  const last = handle.inventory();
  const inventory = report.inventory ?? (last ? { ...last, stale: 'no breach recorded; last completed walk, files may have been removed by the exiting child' } : { missing: 'no completed scratch walk' });
  const view = { identity: report.identity, limits: report.limits, breaches: report.breaches, peak: report.peak, cleanup: report.cleanup, errors: report.errors.slice(0, 5).map(item => String(item).slice(0, 200)), inventory: { ...inventory, top: inventory.top && [...inventory.top] } };
  let text = JSON.stringify(view);
  while (Buffer.byteLength(text) > maxBytes && view.inventory.top?.length) { view.inventory.top.pop(); text = JSON.stringify(view); }
  return Buffer.byteLength(text) > maxBytes ? JSON.stringify({ ...view, inventory: { missing: 'report exceeded ' + maxBytes + ' bytes' } }).slice(0, maxBytes) : text;
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
// A spawnOwned rejection carries groupAbsent: true when no member of the group can exist (callers may delete
// scratch) or false when ownership could not be proven (callers must retain scratch).
export async function spawnOwned(file, args, { cwd, env, logDir, scratch: watched, limits }) {
  const startedAt = performance.now();
  const wallStartedAt = Date.now();
  const child = spawn(file, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const errors = [];
  const exited = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.on('error', error => { errors.push(String(error)); if (!child.pid) resolve({ code: null, signal: null }); });
  });
  if (!child.pid) {
    await exited;
    throw Object.assign(new Error('spawn failed: ' + errors.join('; ')), { groupAbsent: true });
  }
  const identity = await processIdentity(child.pid);
  if (!identity || identity.pgid !== child.pid) {
    child.kill('SIGKILL');
    await exited;
    // Only the child pid was signalled; absence of its group is claimed only if the group id is observably gone.
    throw Object.assign(new Error('child is not the leader of its own process group: ' + JSON.stringify(identity)), { groupAbsent: !groupAlive(child.pid) });
  }
  const report = { identity, limits, breaches: [], errors, peak: { scratchBytes: 0, stdoutBytes: 0, stderrBytes: 0, elapsedMs: 0, elapsedWallMs: 0 }, cleanup: null };
  let stopPromise;
  let hasExited = false;
  let lastInventory = null;
  void exited.then(() => { hasExited = true; });
  const breach = (kind, limit, observed) => {
    if (report.breaches.some(item => item.kind === kind)) return;
    report.breaches.push({ kind, limit, observed });
    // Taken before stop() can SIGTERM the group, because Wrangler removes .wrangler/tmp on that signal.
    report.inventory ??= lastInventory ? { ...lastInventory, breachAtMs: Math.round(performance.now() - startedAt) } : { missing: 'no completed scratch walk before this breach' };
    stop().catch(error => { report.cleanup = { ...report.cleanup, error: String(error) }; });
  };
  const sinks = ['stdout', 'stderr'].map(name => {
    const sink = createWriteStream(path.join(logDir, 'runtime.' + name + '.log'), { flags: 'a' });
    sink.on('error', error => errors.push(name + ' sink: ' + error));
    child[name].on('error', error => errors.push(name + ' pipe: ' + error));
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
      // The monotonic clock may pause while the machine sleeps, so the elapsed wall clock is checked too.
      report.peak.elapsedMs = Math.round(performance.now() - startedAt);
      report.peak.elapsedWallMs = Date.now() - wallStartedAt;
      if (report.peak.elapsedWallMs > limits.wallMs) breach('wall-ms', limits.wallMs, report.peak.elapsedWallMs);
      const tracker = inventoryTracker();
      const walkStartedAt = performance.now();
      const bytes = await dirBytes(watched, tracker.seen);
      lastInventory = tracker.snapshot(Math.round(performance.now() - startedAt), Math.round(performance.now() - walkStartedAt));
      report.peak.scratchBytes = Math.max(report.peak.scratchBytes, bytes);
      if (bytes > limits.scratchBytes) breach('scratch-bytes', limits.scratchBytes, bytes);
    } catch (error) {
      // An unmeasurable scratch tree cannot be held to its cap, so it ends the run.
      errors.push('poller: ' + error);
      breach('poller-error', 0, String(error));
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
  return { pid: child.pid, report, stop, hasExited: () => hasExited, inventory: () => lastInventory };
}

// Every path Wrangler may write to (log, dev registry, cache, hidden .wrangler/tmp via cwd, XDG and temp dirs, HOME)
// is placed under the measured scratch root. Variables are the ones present in Wrangler 4.152.0 source:
// WRANGLER_LOG_PATH, WRANGLER_REGISTRY_PATH, WRANGLER_CACHE_DIR, XDG_CONFIG_HOME, XDG_CACHE_HOME, cwd/config dir.
export function nativeRuntimeEnv(baseEnv, scratchRoot) {
  const dirs = Object.fromEntries(['cwd', 'home', 'tmp', 'logs', 'registry', 'cache', 'xdg-config', 'xdg-cache'].map(name => [name, path.join(scratchRoot, 'wrangler-' + name)]));
  const env = {
    ...baseEnv, WRANGLER_SEND_METRICS: 'false', HOME: dirs.home, TMPDIR: dirs.tmp, XDG_CONFIG_HOME: dirs['xdg-config'], XDG_CACHE_HOME: dirs['xdg-cache'],
    WRANGLER_LOG_PATH: dirs.logs, WRANGLER_REGISTRY_PATH: dirs.registry, WRANGLER_CACHE_DIR: dirs.cache,
  };
  return { env, dirs };
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
// Guarantee: everything the Wrangler process writes goes under nativeScratch (see nativeRuntimeEnv) and is sampled
// every pollMs against the 16 MiB cap; this is sampling, not an OS quota, so a burst can overshoot by one interval.
// Prebuilt .open-next assets and installed node_modules are read-only inputs and are not measured.
// Scratch is deleted only after the owned process group is proven gone; otherwise it is retained and the error says so.
async function startNativeRuntime() {
  const nativeScratch = path.join(scratchParent, 'cloudflare-native-' + randomUUID());
  const qaKey = randomBytes(32).toString('hex');
  const removeScratch = async () => {
    await rm(nativeScratch, { recursive: true, force: true });
    await stat(nativeScratch).then(() => { throw new Error('native scratch was not removed'); }, error => { if (error.code !== 'ENOENT') throw error; });
  };
  let owned;
  try {
    const { config, upstream } = buildConfig({ entry: 'native-entry.mjs', vars: { QA_SEED_KEY: qaKey } });
    const { env, dirs } = nativeRuntimeEnv(process.env, nativeScratch);
    for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true });
    await writeFile(path.join(nativeScratch, 'main.json'), JSON.stringify(config));
    await writeFile(path.join(nativeScratch, 'upstream.json'), JSON.stringify(upstream));
    owned = await spawnOwned(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--config', path.join(nativeScratch,'main.json'), '--config', path.join(nativeScratch,'upstream.json'), '--port', '8788', '--persist-to', path.join(nativeScratch,'state')], { cwd: dirs.cwd, env, logDir: nativeScratch, scratch: nativeScratch, limits: nativeLimits });
  } catch (error) {
    if (error.groupAbsent === false) error.message += '; scratch retained at ' + nativeScratch + ' because group absence is unproven';
    else await removeScratch();
    throw error;
  }
  const stop = async () => {
    let report;
    try { report = await owned.stop(); } catch (error) { throw new Error('scratch retained at ' + nativeScratch + ' because the owned group was not proven gone: ' + error.message, { cause: error }); }
    if (!report.cleanup.groupGone) throw new Error('scratch retained at ' + nativeScratch + ': group still present after stop');
    await removeScratch();
    return report;
  };
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (owned.report.breaches.length) throw new Error('native limit breached: ' + JSON.stringify(owned.report.breaches));
      if (owned.hasExited()) throw new Error('Wrangler exited before readiness');
      try { const response = await fetch(base+'/api/health', {signal: AbortSignal.timeout(1500)}); if (response.status === 200) return { stop, qaKey, report: owned.report, scratch: nativeScratch }; } catch {}
      await delay(200);
    }
    throw new Error('Wrangler readiness deadline exceeded');
  } catch (error) {
    try { await stop(); } catch (cleanupError) { error.message += '; cleanup: ' + cleanupError.message; }
    error.message += '; owned report: ' + ownedReportText(owned);
    throw error;
  }
}
