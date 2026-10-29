#!/usr/bin/env node
// Test-only hosted fixture: freezes before/candidate reader bundles against the installed pnpm graph, builds an immutable
// image from that graph (no installer phase), and runs guarded one-shot units. Commands: selfcheck | ci | m.
// ci prepares + qualifies guards with identical one-row probe units (both variants, both targets); it collects NO portfolio samples.
// m refuses unless the admitted protocol hash matches AND a passing, re-judged qualification.json is bound to this image/manifest/protocol.
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FAULTS } from './reader-m-fixture.mjs';
import { findPackage } from '../../tests/cloudflare/runtime.mjs';

const MIB = 1048576;
// The Node image ships no CA store, so workerd's outbound TLS setup fails. The hosted runner's public bundle is copied into the image (offline, verification stays on).
export const CA_SOURCE = '/etc/ssl/certs/ca-certificates.crt';
export const CA_IMAGE_PATH = '/etc/ssl/certs/ca-certificates.crt';
// The pinned base has no OpenSSL config and none is added. Node's permission model denies reading the absent default /etc/ssl/openssl.cnf (EACCES), so guarded units point at an absent path under the already readable /image to get the benign ENOENT.
export const OPENSSL_CONF_ABSENT = '/image/out/openssl.cnf';
export const CA_OUT_PATH = '/image/out/ca-certificates.crt'; // same bytes as CA_IMAGE_PATH (kept for workerd), readable under --allow-fs-read=/image
// Counts decoded bytes seen by the reader's gunzipSync. With {info:true} zlib returns {buffer,engine}; otherwise a Buffer (never read Buffer.buffer, the backing ArrayBuffer). The native result is returned unchanged.
export const OBSERVER = "import {gunzipSync as g, gzipSync} from 'node:zlib'; export {gzipSync}; export function gunzipSync(...a){const r=g(...a);const c=globalThis.t15Counters;if(c){const n=(a[1]&&a[1].info===true?r.buffer:r).byteLength;if(c.files===1)c.manifest+=n;else c.decoded+=n;}return r;}";
const PEM = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+?-----END CERTIFICATE-----/g;
export function readPublicCa(file = CA_SOURCE) {
  const st = fs.lstatSync(file);
  assert.ok(st.isFile(), 'CA bundle is not a regular file');
  assert.ok(st.size > 0 && st.size <= MIB, 'CA bundle size');
  const bytes = fs.readFileSync(file), body = bytes.toString('latin1');
  assert.ok(!/PRIVATE KEY/.test(body), 'CA bundle holds key material');
  const blocks = body.match(PEM) ?? [];
  assert.ok(blocks.length > 0, 'CA bundle has no certificates');
  assert.match(body.replace(PEM, '').replace(/^#.*$/gm, ''), /^\s*$/, 'CA bundle has non-certificate content');
  for (const b of blocks) new X509Certificate(b);
  return { bytes, source: file, size: bytes.length, sha256: sha(bytes), certificates: blocks.length };
}
const here = path.dirname(fileURLToPath(import.meta.url));
export const NODE_IMAGE = 'node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752';
const NODE_VERSION = 'v' + /node:(\d+\.\d+\.\d+)/.exec(NODE_IMAGE)[1];
export const READER = 'src/lib/metrics/v2/reader.ts';
export const PINS = {
  before: { commit: '683b0af0c5d5aa71933a731f108ff8cc5ba6e11e', blob: 'bf6bee6cc7eff7b363b4fbb5e3bafbc48719a6f8' },
  candidate: { commit: 'd4180dbc68810e8e5c33dfc285c6b6f080ce1c39', blob: 'b632bfc560defa03fdbf97a1566de22555728bae' },
};
const QUERIES = ['1h', '24h', '7d', '30d'].flatMap((r) => [[r, 'host'], [r, 'workloads']]);
// Target-specific envelopes are frozen here (and hashed into the protocol) before any observation; the DO row maps the supported 512MiB DB envelope.
export const TARGETS = Object.freeze({
  local: Object.freeze({ pids: 32, cpus: 0.5, memory: 128 * MIB, node: Object.freeze(['--permission', '--allow-fs-read=/image', '--allow-fs-read=/tmp', '--allow-fs-write=/tmp']) }),
  do: Object.freeze({ pids: 128, cpus: 1, memory: 512 * MIB, node: Object.freeze([]) }),
});
// 16MiB combined scratch = container tmpfs+shm reservation (7MiB) + host-owned writable paths (out dir incl. bundles, manifests, unit records; <=9MiB).
export const PROTOCOL = {
  version: 2, queries: QUERIES, targets: Object.keys(TARGETS), faults: FAULTS,
  slots: { pilotBefore: 10, warmup: 4, measured: 20, pairs: 10 },
  fixtures: { qualification: 'one row, first query only, identical for both variants and targets', measurement: 'full authored window, 8 queries' },
  limits: { scratchBytes: 16 * MIB, tmpfsBytes: 6 * MIB, shmBytes: MIB, hostBytes: 9 * MIB, unitSeconds: 120, streamBytes: MIB, chunks: 32, decodedTotalBytes: 32 * MIB, memberBytes: 4 * MIB, manifestBytes: 512 * 1024, paths: 256, targets: TARGETS },
  stats: { reference: 'work/portfolio-performance/tools/decisions.py', seed: 1127, bootstrap: 2000, confidence: 0.95, primaryRelative: 0.05, noiseMultiple: 2, secondaryRelative: 0.05 },
  primary: { local: 'cpuMicros (process.cpuUsage per query)', do: 'cgroupCpuMicros (container cpu.stat around dispatch)', wall: 'wallMs host-side elapsed' },
  secondaryNoIncrease: ['parse', 'files', 'decoded', 'manifest', 'compressed', 'sql'],
  semantic: 'per-query output hash must be identical before and candidate',
};
export const sha = (b) => createHash('sha256').update(b).digest('hex');
export const protocolSha = () => sha(JSON.stringify(PROTOCOL));
export const blobOid = (b) => createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
export function assertBlob(bytes, oid) { assert.equal(blobOid(bytes), oid, 'pinned git blob mismatch'); }
export const overBudget = (hostBytes) => hostBytes + PROTOCOL.limits.tmpfsBytes + PROTOCOL.limits.shmBytes > PROTOCOL.limits.scratchBytes;
export function dirBytes(dir) {
  let total = 0;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : []) { try { const s = fs.lstatSync(path.join(dir, f)); if (s.isFile()) total += s.size; } catch { /* removed while walking */ } }
  return total;
}

export function hasSymlink(dir) { try { return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).some((e) => e.isSymbolicLink()); } catch { return false; } }

// Control subprocesses (docker CLI) get a sanitized env whose HOME/TMP/cache dirs (Node, Bun, SDK, XDG) live inside the run-owned dir under out, so the host guard sees them.
export function controlEnv(out, runDir, base = process.env) {
  const sub = Object.fromEntries(['home', 'tmp', 'cache', 'docker'].map((k) => [k, path.join(runDir, k)]));
  for (const d of Object.values(sub)) fs.mkdirSync(d, { recursive: true });
  assert.ok(fs.realpathSync(runDir).startsWith(fs.realpathSync(out) + path.sep) && !hasSymlink(runDir), 'run dir escapes out');
  const env = { PATH: (base.PATH ?? '').split(path.delimiter).filter((p) => path.isAbsolute(p)).join(path.delimiter), HOME: sub.home, TMPDIR: sub.tmp, TMP: sub.tmp, TEMP: sub.tmp, BUN_TMPDIR: sub.tmp,
    XDG_CACHE_HOME: sub.cache, XDG_CONFIG_HOME: sub.cache, XDG_DATA_HOME: sub.cache, XDG_STATE_HOME: sub.cache, npm_config_cache: sub.cache, BUN_INSTALL: sub.cache, BUN_INSTALL_CACHE_DIR: sub.cache, NODE_COMPILE_CACHE: sub.cache };
  assert.ok(env.PATH, 'no absolute PATH');
  // Counted, empty docker config (no credentials, contexts or auth copies); only an explicit daemon endpoint is forwarded, else the default local socket.
  env.DOCKER_CONFIG = sub.docker;
  if (base.DOCKER_HOST) env.DOCKER_HOST = base.DOCKER_HOST;
  return env;
}

// Removal needs the rm acknowledgement (or a clean "no such container") AND a successful docker ps listing the exact name as absent; a failed or killed probe is not absence.
export const removalVerdict = (rm, ps, name) => ps.status === 0 && ps.killed === null && ps.stdout.trim() === '' && rm.killed === null
  && ((rm.status === 0 && rm.stdout.trim() === name) || (rm.status !== 0 && /No such container/i.test(rm.stderr)));

// Optional native binaries belong to their owning package (strict pnpm graph): resolve from that package manifest, not the repo or miniflare.
export const owned = (r, pkg, sub) => createRequire(r.resolve(pkg + '/package.json')).resolve(sub);

// Strict pnpm: miniflare is a transitive dependency of wrangler (and workerd of miniflare), so walk the declared edges like the native runtime identity does.
export async function installedGraph(root) {
  const wrangler = await findPackage(root, 'wrangler');
  const miniflare = wrangler && await findPackage(wrangler.dir, 'miniflare');
  const workerd = miniflare && await findPackage(miniflare.dir, 'workerd');
  assert.ok(wrangler && miniflare && workerd, 'installed graph incomplete: wrangler -> miniflare -> workerd');
  return { wrangler, miniflare, workerd };
}

export const qualificationUnits = () => Object.keys(TARGETS).flatMap((target) => Object.keys(PINS).map((variant) => ({ variant, target, mode: 'probe', fixture: 'one' })));

export function schedule(target) {
  assert.ok(TARGETS[target], 'unknown target');
  const s = [];
  for (let i = 0; i < 10; i++) s.push({ phase: 'pilot', pair: i, variant: 'before' });
  for (let i = 0; i < 4; i++) s.push({ phase: 'warmup', pair: i, variant: i % 2 ? 'candidate' : 'before' });
  for (let p = 0; p < 10; p++) for (const variant of (p % 2 ? ['candidate', 'before'] : ['before', 'candidate'])) s.push({ phase: 'measured', pair: p, variant });
  return s.map((x, index) => ({ ...x, target, index }));
}

export function guardArgs(name, image, target, unit) {
  const t = TARGETS[target]; assert.ok(t, 'unknown target');
  return ['create', '--pull', 'never', '--name', name, '--label', 'portfolio.guard=' + name, '--user', '1000:1000', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--network', 'none', '--read-only', '--init', '--pids-limit', String(t.pids), '--cpus', String(t.cpus),
    '--memory', String(t.memory), '--memory-swap', String(t.memory), '--log-driver', 'none', '--shm-size', String(PROTOCOL.limits.shmBytes),
    '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=' + PROTOCOL.limits.tmpfsBytes + ',mode=1777', '--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp', '--env', 'SSL_CERT_FILE=' + CA_OUT_PATH, '--env', 'OPENSSL_CONF=' + OPENSSL_CONF_ABSENT,
    '--env', 'UNIT=' + JSON.stringify(unit), '--entrypoint', '/usr/bin/timeout', image, '--signal=KILL', String(PROTOCOL.limits.unitSeconds - 12),
    '/usr/local/bin/node', ...t.node, '/image/out/unit.mjs'];
}

export function checkInspect(info, name, imageId, target) {
  const t = TARGETS[target], h = info.HostConfig ?? {};
  const bad = (why) => { throw new Error('guard readback: ' + why); };
  if (info.Name !== '/' + name) bad('name');
  if (info.Image !== imageId) bad('image');
  if (info.Config?.User !== '1000:1000') bad('user');
  if (h.NetworkMode !== 'none') bad('network');
  if (h.ReadonlyRootfs !== true) bad('readonly');
  if (h.Privileged) bad('privileged');
  if (h.Init !== true) bad('init');
  if (JSON.stringify(h.CapDrop) !== '["ALL"]' || !(h.CapAdd == null || h.CapAdd.length === 0)) bad('caps');
  if (!(h.SecurityOpt ?? []).includes('no-new-privileges')) bad('no-new-privileges');
  if (h.PidsLimit !== t.pids) bad('pids');
  if (h.Memory !== t.memory || h.MemorySwap !== t.memory) bad('memory');
  if (h.NanoCpus !== t.cpus * 1e9) bad('cpus');
  if (h.ShmSize !== PROTOCOL.limits.shmBytes) bad('shm');
  if (h.LogConfig?.Type !== 'none') bad('log');
  const opts = String(h.Tmpfs?.['/tmp'] ?? '').split(',');
  if (JSON.stringify(Object.keys(h.Tmpfs ?? {})) !== '["/tmp"]' || !opts.includes('size=' + PROTOCOL.limits.tmpfsBytes) || !['noexec', 'nosuid', 'nodev'].every((o) => opts.includes(o))) bad('tmpfs');
  if ((h.Binds ?? []).length || (info.Mounts ?? []).some((m) => m.Type !== 'tmpfs' || m.Destination !== '/tmp')) bad('mounts');
}

// The docker CLI status is not the child's status; only the container State is.
export function checkTerminal(s) {
  assert.equal(s.ExitCode, 0, 'container exit code ' + s.ExitCode);
  assert.equal(s.OOMKilled, false, 'container OOM killed');
  assert.equal(s.Running, false, 'container still running');
  assert.equal(s.Status, 'exited', 'container status ' + s.Status);
  assert.equal(s.Pid, 0, 'own pid not 0');
}

// One child, one absolute deadline, one combined stdout+stderr cap. SIGKILL on either.
export function runBounded(cmd, args, { deadline, maxBytes = MIB, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, killed = null, done = false;
    const kill = (why) => { if (!killed) { killed = why; child.kill('SIGKILL'); } };
    const finish = (status) => { if (!done) { done = true; clearTimeout(timer); resolve({ status, stdout, stderr, bytes, killed }); } };
    const timer = setTimeout(() => kill('deadline'), Math.max(0, deadline - Date.now()));
    const take = (isOut) => (chunk) => { bytes += chunk.length; if (bytes > maxBytes) kill('cap'); else if (isOut) stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8'); };
    child.stdout.on('data', take(true)); child.stderr.on('data', take(false));
    child.on('error', (e) => { killed = killed ?? 'error'; stderr += String(e); finish(null); });
    child.on('close', (status) => finish(status));
  });
}

// Exactly one JSON line, within the stream cap.
// Full child output (already capped at 1MiB combined by runBounded), stored before any assertion so a failed unit stays diagnosable.
export const cliReceipt = (s) => ({ status: s.status, killed: s.killed, bytes: s.bytes, stdout: s.stdout, stderr: s.stderr });
// The first concrete unit failure outranks any later aggregate judgement such as the unit count.
export const firstFailure = (recs) => { const i = recs.findIndex((r) => r.error); return i < 0 ? null : 'unit ' + i + ': ' + recs[i].error + ' | stderr: ' + String(recs[i].cli?.stderr ?? '').slice(-1200); };

export function boundedJson(stdout) {
  assert.ok(stdout.length <= PROTOCOL.limits.streamBytes, 'stream cap');
  const lines = stdout.trimEnd().split('\n');
  assert.equal(lines.length, 1, 'control output must be one line');
  return JSON.parse(lines[0]);
}

export function checkReceipts(out, unit) {
  assert.deepEqual(out.unit, unit, 'unit echo');
  const expected = unit.fixture === 'one' ? [QUERIES[0]] : QUERIES;
  assert.equal(out.receipts.length, expected.length, 'receipt count');
  out.receipts.forEach((r, i) => {
    assert.deepEqual([r.query.range, r.query.view], expected[i], 'query order');
    assert.match(r.hash, /^[0-9a-f]{64}$/, 'hash');
    const cpu = unit.target === 'local' ? r.cpuMicros : r.cgroupCpuMicros;
    assert.ok(Number.isFinite(cpu) && cpu >= 0 && Number.isFinite(r.wallMs) && r.wallMs >= 0, 'timing');
    for (const k of ['parse', 'files', 'decoded', 'manifest', 'compressed', 'sql']) if (k in r.counters) assert.ok(Number.isInteger(r.counters[k]) && r.counters[k] >= 0, 'counter ' + k);
  });
  return out.receipts;
}

// Qualification verdict recomputed from unit records; stored pass flags and worker self-assertions are never trusted.
export function judge(recs) {
  const want = qualificationUnits(), DENIED = 'ERR_ACCESS_DENIED';
  assert.equal(recs.length, want.length, 'unit count');
  recs.forEach((r, i) => {
    assert.deepEqual(r.unit, want[i], 'unit identity');
    assert.equal(r.error, null, 'unit error: ' + r.error);
    assert.equal(r.guardOk, true, 'guard readback'); assert.equal(r.removed, true, 'teardown');
    const t = r.terminal ?? {};
    checkTerminal({ ExitCode: t.exit, OOMKilled: t.oom, Pid: t.pid, Running: t.running, Status: t.status });
    const o = r.out; assert.ok(o, 'missing output');
    checkReceipts(o, r.unit);
    assert.equal(o.node, NODE_VERSION, 'runtime node version');
    if (r.unit.target === 'local') {
      assert.deepEqual(o.probes, { writeSource: DENIED, readPrivate: DENIED, child: DENIED }, 'local guard probes');
      assert.deepEqual(o.faults, [], 'local faults');
    } else {
      assert.deepEqual(Object.keys(o.probes), ['isolateFs'], 'do probes');
      assert.ok(typeof o.probes.isolateFs?.denied === 'string' && !('read' in o.probes.isolateFs), 'isolate fs read not denied');
      assert.deepEqual(o.faults, FAULTS.map(([fault, expected]) => ({ fault, expected, code: expected })), 'fault classes');
    }
  });
  assert.equal(new Set(recs.map((r) => r.out.receipts[0].hash)).size, 1, 'canary semantic mismatch');
  return true;
}

const CONTROL = new Set(['manifest.json', 'freeze.json', 'qualification.json', 'image.id', 'Dockerfile', 'Dockerfile.dockerignore']);
export function verifyManifest(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const listed = Object.keys(manifest.files).sort();
  const actual = fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile() && !CONTROL.has(f) && !/^units[\\/][^\\/]+\.json$/.test(f)).sort();
  assert.deepEqual(actual, listed, 'file set changed');
  for (const f of listed) assert.equal(sha(fs.readFileSync(path.join(dir, f))), manifest.files[f], 'stale hash ' + f);
  for (const f of ['Dockerfile', 'Dockerfile.dockerignore']) assert.equal(sha(fs.readFileSync(path.join(dir, f))), manifest.control?.[f], 'stale control ' + f);
  assert.equal(manifest.protocolSha, protocolSha(), 'protocol drift');
  return manifest;
}

// Generated control files are bound here: freeze -> manifest/protocol/image.id.
export function verifyBinding(dir) {
  const freezeBytes = fs.readFileSync(path.join(dir, 'freeze.json'));
  const freeze = JSON.parse(freezeBytes);
  assert.equal(sha(fs.readFileSync(path.join(dir, 'manifest.json'))), freeze.manifestSha, 'manifest drift');
  assert.equal(freeze.protocolSha, protocolSha(), 'freeze protocol drift');
  assert.equal(fs.readFileSync(path.join(dir, 'image.id'), 'utf8').trim(), freeze.imageId, 'image.id drift');
  return { freeze, freezeSha: sha(freezeBytes) };
}

export function verifyQualification(dir, bound) {
  const q = JSON.parse(fs.readFileSync(path.join(dir, 'qualification.json'), 'utf8'));
  assert.equal(q.pass, true, 'qualification not passed');
  assert.equal(q.protocolSha, protocolSha(), 'qualification protocol'); assert.equal(q.manifestSha, bound.freeze.manifestSha, 'qualification manifest');
  assert.equal(q.imageId, bound.freeze.imageId, 'qualification image'); assert.equal(q.freezeSha, bound.freezeSha, 'qualification freeze');
  judge(q.units);
  return q;
}

// Every non-node_modules src/ file esbuild resolved must be byte-identical at the pinned commit; the reader itself is checked by blob pin.
export function checkClosure(inputs, root, pinned) {
  const rows = [];
  for (const f of inputs) {
    const file = path.join(root, f);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue; // virtual esbuild inputs
    const bytes = fs.readFileSync(file);
    if (f.startsWith('src/')) { const old = pinned(f); assert.ok(old, 'closure file absent at pin: ' + f); assert.equal(blobOid(bytes), blobOid(old), 'closure drift: ' + f); }
    rows.push({ file: f, sha256: sha(bytes) });
  }
  return rows;
}

// docker COPY keeps symlinks as symlinks: every pnpm link must resolve inside the copied tree.
export function checkSymlinks(nm) {
  const base = fs.realpathSync(nm); let n = 0;
  for (const e of fs.readdirSync(nm, { recursive: true, withFileTypes: true })) if (e.isSymbolicLink()) {
    const link = path.join(e.parentPath, e.name);
    let real; try { real = fs.realpathSync(link); } catch { throw new Error('dangling symlink ' + link); }
    if (real !== base && !real.startsWith(base + path.sep)) throw new Error('symlink escapes node_modules: ' + link);
    n++;
  }
  return n;
}

function selfcheck() {
  const results = [];
  const check = (name, fn) => { fn(); results.push(name); };
  const throwsFor = (fn) => assert.throws(fn);
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'readerm-'));
  check('blob-oid-empty', () => assert.equal(blobOid(Buffer.alloc(0)), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'));
  check('blob-mismatch-rejected', () => throwsFor(() => assertBlob(Buffer.from('model reconstruction'), PINS.before.blob)));
  check('schedule', () => {
    for (const t of Object.keys(TARGETS)) {
      const s = schedule(t);
      assert.equal(s.length, 34);
      assert.ok(s.slice(0, 10).every((x) => x.phase === 'pilot' && x.variant === 'before'));
      assert.equal(s.filter((x) => x.phase === 'warmup').length, 4);
      const m = s.filter((x) => x.phase === 'measured');
      assert.equal(m.length, 20);
      for (let p = 0; p < 10; p++) assert.deepEqual(m.slice(2 * p, 2 * p + 2).map((x) => x.variant), p % 2 ? ['candidate', 'before'] : ['before', 'candidate']);
    }
    throwsFor(() => schedule('x'));
  });
  const unit = { variant: 'before', target: 'local', mode: 'probe', fixture: 'one' };
  check('guard-args', () => {
    const a = guardArgs('n', 'sha256:i', 'local', unit).join(' ');
    for (const f of ['--cap-drop ALL', '--network none', '--read-only', 'no-new-privileges', '--user 1000:1000', '--pids-limit 32', '--memory 134217728', 'size=6291456', '--shm-size 1048576', '--permission', 'SSL_CERT_FILE=/image/out/ca-certificates.crt', 'OPENSSL_CONF=/image/out/openssl.cnf']) assert.ok(a.includes(f), f);
    assert.ok(a.includes('--allow-fs-read=/image') && OPENSSL_CONF_ABSENT.startsWith('/image/') && !a.includes('--allow-fs-read=/etc'));
    assert.ok(!guardArgs('n', 'i', 'do', unit).join(' ').includes('--permission'));
    assert.ok(guardArgs('n', 'i', 'do', unit).includes(String(512 * MIB)));
  });
  check('envelopes-frozen-and-scratch-budget', () => {
    assert.ok(Object.isFrozen(TARGETS) && Object.isFrozen(TARGETS.local) && TARGETS.local.memory === 128 * MIB && TARGETS.do.memory === 512 * MIB);
    const l = PROTOCOL.limits;
    assert.ok(l.tmpfsBytes + l.shmBytes + l.hostBytes <= l.scratchBytes && l.hostBytes >= 8 * MIB);
    assert.ok(!overBudget(l.hostBytes) && overBudget(l.hostBytes + 1));
  });
  const good = (target) => { const t = TARGETS[target]; return { Name: '/n', Image: 'sha256:i', Config: { User: '1000:1000' }, Mounts: [{ Type: 'tmpfs', Destination: '/tmp' }],
    HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false, Init: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], PidsLimit: t.pids, Memory: t.memory, MemorySwap: t.memory,
      NanoCpus: t.cpus * 1e9, ShmSize: MIB, LogConfig: { Type: 'none' }, Tmpfs: { '/tmp': 'rw,nosuid,nodev,noexec,size=' + PROTOCOL.limits.tmpfsBytes + ',mode=1777' }, Binds: null } }; };
  check('inspect-accepts-compliant', () => { checkInspect(good('local'), 'n', 'sha256:i', 'local'); checkInspect(good('do'), 'n', 'sha256:i', 'do'); });
  check('inspect-rejects-weakened', () => {
    const mut = [(i) => { i.HostConfig.NetworkMode = 'bridge'; }, (i) => { i.HostConfig.ReadonlyRootfs = false; }, (i) => { i.HostConfig.CapDrop = []; }, (i) => { i.HostConfig.Privileged = true; },
      (i) => { i.HostConfig.Memory *= 2; }, (i) => { i.HostConfig.PidsLimit = -1; }, (i) => { i.Config.User = 'root'; }, (i) => { i.HostConfig.Binds = ['/:/host']; },
      (i) => { i.HostConfig.Tmpfs['/tmp'] = 'size=99999999'; }, (i) => { i.HostConfig.Tmpfs['/tmp'] = 'rw,nosuid,nodev,noexec,size=' + PROTOCOL.limits.tmpfsBytes + '0'; }, (i) => { i.HostConfig.Tmpfs['/tmp'] = 'size=' + PROTOCOL.limits.tmpfsBytes; },
      (i) => { i.Image = 'sha256:other'; }, (i) => { i.HostConfig.SecurityOpt = []; }, (i) => { i.Mounts.push({ Type: 'bind', Destination: '/x' }); }];
    for (const m of mut) { const i = good('local'); m(i); throwsFor(() => checkInspect(i, 'n', 'sha256:i', 'local')); }
  });
  check('terminal-state', () => {
    const ok = { ExitCode: 0, OOMKilled: false, Pid: 0, Running: false, Status: 'exited' };
    checkTerminal(ok);
    for (const bad of [{ ExitCode: 137 }, { OOMKilled: true }, { Pid: 9 }, { Running: true }, { Status: 'created' }]) throwsFor(() => checkTerminal({ ...ok, ...bad }));
  });
  check('control-output-limits', () => {
    assert.deepEqual(boundedJson('{"a":1}\n'), { a: 1 });
    throwsFor(() => boundedJson('x'.repeat(MIB + 1)));
    throwsFor(() => boundedJson('{"a":1}\n{"b":2}\n'));
    throwsFor(() => boundedJson('not json'));
  });
  check('receipts', () => {
    const q = (i) => ({ range: QUERIES[i][0], view: QUERIES[i][1] });
    const mk = (n = 8) => ({ unit: { ...unit, mode: 'measure', fixture: 'full' }, receipts: QUERIES.slice(0, n).map((_, i) => ({ query: q(i), counters: { parse: 1 }, cpuMicros: 5, wallMs: 1, hash: 'a'.repeat(64) })) });
    const u = { ...unit, mode: 'measure', fixture: 'full' };
    assert.equal(checkReceipts(mk(), u).length, 8);
    assert.equal(checkReceipts({ ...mk(1), unit }, unit).length, 1);
    throwsFor(() => checkReceipts({ ...mk(8), unit }, unit));
    let o = mk(); o.receipts.reverse(); throwsFor(() => checkReceipts(o, u));
    o = mk(); o.receipts.pop(); throwsFor(() => checkReceipts(o, u));
    o = mk(); o.receipts[0].cpuMicros = -1; throwsFor(() => checkReceipts(o, u));
    o = mk(); o.receipts[0].hash = 'zz'; throwsFor(() => checkReceipts(o, u));
    o = mk(); o.unit.variant = 'candidate'; throwsFor(() => checkReceipts(o, u));
  });
  const recs = () => qualificationUnits().map((u) => {
    const local = u.target === 'local';
    const out = { unit: u, node: NODE_VERSION, receipts: [{ query: { range: '1h', view: 'host', resource: null }, counters: { parse: 1 }, wallMs: 1, hash: 'a'.repeat(64), [local ? 'cpuMicros' : 'cgroupCpuMicros']: 5 }],
      probes: local ? { writeSource: 'ERR_ACCESS_DENIED', readPrivate: 'ERR_ACCESS_DENIED', child: 'ERR_ACCESS_DENIED' } : { isolateFs: { denied: 'EACCES' } },
      faults: local ? [] : FAULTS.map(([fault, expected]) => ({ fault, expected, code: expected })) };
    return { unit: u, guardOk: true, out, terminal: { exit: 0, oom: false, pid: 0, running: false, status: 'exited' }, removed: true, error: null };
  });
  check('qualification-judge', () => {
    assert.equal(qualificationUnits().length, 4); assert.equal(FAULTS.length, 10);
    assert.ok(judge(recs()));
    const bad = [(r) => { r[0].out.probes.child = 'ALLOWED'; }, (r) => { r[1].out.receipts[0].hash = 'b'.repeat(64); }, (r) => { r[3].out.faults.pop(); }, (r) => { r[3].out.faults[2].code = 'too_large'; },
      (r) => { r[0].out.node = 'v20.0.0'; }, (r) => { r[2].error = 'boom'; }, (r) => { r[0].terminal.oom = true; }, (r) => { r[2].out.probes.isolateFs = { read: 4 }; }, (r) => { r[0].guardOk = false; }, (r) => { r[0].removed = false; }, (r) => { r.pop(); }];
    for (const m of bad) { const r = recs(); m(r); throwsFor(() => judge(r)); }
  });
  check('qualification-binding', () => {
    const d = tmp();
    try {
      const write = (f, c) => fs.writeFileSync(path.join(d, f), typeof c === 'string' ? c : JSON.stringify(c));
      write('manifest.json', { files: {}, control: {}, protocolSha: protocolSha() }); write('image.id', 'sha256:img\n');
      const freeze = { imageId: 'sha256:img', manifestSha: sha(fs.readFileSync(path.join(d, 'manifest.json'))), protocolSha: protocolSha() };
      write('freeze.json', freeze);
      const bound = verifyBinding(d);
      const qual = { pass: true, protocolSha: protocolSha(), manifestSha: freeze.manifestSha, imageId: freeze.imageId, freezeSha: bound.freezeSha, units: recs() };
      write('qualification.json', qual); verifyQualification(d, bound);
      for (const m of [(q) => { q.pass = false; }, (q) => { q.protocolSha = 'x'; }, (q) => { q.imageId = 'sha256:o'; }, (q) => { q.freezeSha = 'x'; }, (q) => { q.units[0].out.probes.writeSource = 'ALLOWED'; }, (q) => { q.units = []; }]) {
        const q = structuredClone(qual); m(q); write('qualification.json', q); throwsFor(() => verifyQualification(d, bound));
      }
      fs.rmSync(path.join(d, 'qualification.json')); throwsFor(() => verifyQualification(d, bound));
      write('image.id', 'sha256:other'); throwsFor(() => verifyBinding(d));
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  check('manifest-stale-tamper-and-control-files', () => {
    const d = tmp();
    try {
      fs.writeFileSync(path.join(d, 'a.mjs'), 'a'); fs.writeFileSync(path.join(d, 'Dockerfile'), 'F'); fs.writeFileSync(path.join(d, 'Dockerfile.dockerignore'), 'I'); fs.writeFileSync(path.join(d, 'image.id'), 'sha256:x');
      fs.writeFileSync(path.join(d, 'freeze.json'), '{}'); fs.mkdirSync(path.join(d, 'units')); fs.writeFileSync(path.join(d, 'units', '000.json'), '{}');
      const write = (proto = protocolSha()) => fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ files: { 'a.mjs': sha('a') }, control: { Dockerfile: sha('F'), 'Dockerfile.dockerignore': sha('I') }, protocolSha: proto }));
      write(); verifyManifest(d);
      fs.writeFileSync(path.join(d, 'a.mjs'), 'b'); throwsFor(() => verifyManifest(d));
      fs.writeFileSync(path.join(d, 'a.mjs'), 'a'); fs.writeFileSync(path.join(d, 'extra.mjs'), ''); throwsFor(() => verifyManifest(d));
      fs.rmSync(path.join(d, 'extra.mjs')); fs.writeFileSync(path.join(d, 'Dockerfile.evil'), ''); throwsFor(() => verifyManifest(d));
      fs.rmSync(path.join(d, 'Dockerfile.evil')); fs.writeFileSync(path.join(d, 'units', 'x.mjs'), ''); throwsFor(() => verifyManifest(d));
      fs.rmSync(path.join(d, 'units', 'x.mjs')); fs.writeFileSync(path.join(d, 'Dockerfile.dockerignore'), 'tampered'); throwsFor(() => verifyManifest(d));
      fs.writeFileSync(path.join(d, 'Dockerfile.dockerignore'), 'I'); write('stale'); throwsFor(() => verifyManifest(d));
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  check('closure-and-symlinks', () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'src')); fs.writeFileSync(path.join(d, 'src', 't.ts'), 'now');
      assert.equal(checkClosure(['src/t.ts', '<stdin>', 'variant:reader'], d, () => Buffer.from('now')).length, 1);
      throwsFor(() => checkClosure(['src/t.ts'], d, () => Buffer.from('then')));
      throwsFor(() => checkClosure(['src/t.ts'], d, () => null));
      fs.mkdirSync(path.join(d, 'nm', '.pnpm', 'p'), { recursive: true });
      fs.symlinkSync('.pnpm/p', path.join(d, 'nm', 'ok')); assert.equal(checkSymlinks(path.join(d, 'nm')), 1);
      fs.symlinkSync('../src', path.join(d, 'nm', 'escape')); throwsFor(() => checkSymlinks(path.join(d, 'nm')));
      fs.rmSync(path.join(d, 'nm', 'escape')); fs.symlinkSync('nowhere', path.join(d, 'nm', 'dangling')); throwsFor(() => checkSymlinks(path.join(d, 'nm')));
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  check('owner-anchored-native-resolution', () => {
    const d = tmp();
    try {
      for (const p of ['own/node_modules/pkg', 'own/node_modules/native/bin', 'root/node_modules']) fs.mkdirSync(path.join(d, p), { recursive: true });
      fs.writeFileSync(path.join(d, 'own/node_modules/pkg/package.json'), '{"name":"pkg"}'); fs.writeFileSync(path.join(d, 'own/node_modules/native/bin/x'), 'b'); fs.writeFileSync(path.join(d, 'root/package.json'), '{}');
      fs.symlinkSync('../../own/node_modules/pkg', path.join(d, 'root/node_modules/pkg'));
      const r = createRequire(path.join(d, 'root/package.json'));
      throwsFor(() => r.resolve('native/bin/x')); // the repo context cannot see the owner's optional dependency
      assert.equal(fs.readFileSync(owned(r, 'pkg', 'native/bin/x'), 'utf8'), 'b');
      throwsFor(() => owned(r, 'missing', 'native/bin/x'));
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  check('control-env-run-owned-and-budgeted', () => {
    const d = tmp(), other = tmp(), realCfg = tmp();
    try {
      const run = path.join(d, '.run', '0');
      fs.writeFileSync(path.join(realCfg, 'config.json'), '{"auths":{"x":{}}}');
      const env = controlEnv(d, run, { PATH: '/usr/bin:rel/bin:/bin', HOME: '/h', DOCKER_HOST: 'unix:///x', DOCKER_CONFIG: realCfg, DOCKER_CONTEXT: 'c', DOCKER_CERT_PATH: realCfg, SECRET: 's' });
      assert.equal(env.PATH, '/usr/bin:/bin'); assert.equal(env.DOCKER_HOST, 'unix:///x'); assert.ok(!('SECRET' in env));
      assert.ok(env.DOCKER_CONFIG.startsWith(run + path.sep) && fs.readdirSync(env.DOCKER_CONFIG).length === 0, 'docker config is run-owned and empty');
      for (const k of ['DOCKER_CONTEXT', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY']) assert.ok(!(k in env), k);
      for (const k of ['HOME', 'TMPDIR', 'TMP', 'XDG_CACHE_HOME', 'npm_config_cache', 'BUN_INSTALL_CACHE_DIR', 'BUN_TMPDIR']) assert.ok(env[k].startsWith(run + path.sep), k);
      throwsFor(() => controlEnv(d, run, { PATH: 'rel' }));
      fs.writeFileSync(path.join(run, 'cache', 'big'), Buffer.alloc(PROTOCOL.limits.hostBytes + 1));
      assert.ok(overBudget(dirBytes(d)), 'caches count against the combined budget');
      fs.rmSync(path.join(run, 'cache', 'big')); assert.ok(!hasSymlink(run));
      fs.symlinkSync(other, path.join(run, 'cache', 'esc')); assert.ok(hasSymlink(run)); throwsFor(() => controlEnv(d, run, { PATH: '/bin' }));
      fs.rmSync(path.join(run, 'cache', 'esc')); fs.symlinkSync(other, path.join(d, '.run2')); throwsFor(() => controlEnv(d, path.join(d, '.run2'), { PATH: '/bin' }));
    } finally { for (const x of [d, other, realCfg]) fs.rmSync(x, { recursive: true, force: true }); }
  });
  check('removal-verdict', () => {
    const rm = { status: 0, killed: null, stdout: 'n\n', stderr: '' }, none = { status: 0, killed: null, stdout: '', stderr: '' };
    assert.ok(removalVerdict(rm, none, 'n'));
    assert.ok(removalVerdict({ status: 1, killed: null, stdout: '', stderr: 'Error response: No such container: n' }, none, 'n'));
    for (const [a, b] of [[rm, { ...none, status: 1 }], [rm, { ...none, killed: 'deadline' }], [rm, { ...none, stdout: 'n\n' }], [{ ...rm, killed: 'deadline' }, none],
      [{ status: 1, killed: null, stdout: '', stderr: 'Cannot connect to the Docker daemon' }, none], [{ ...rm, stdout: 'other\n' }, none]]) assert.ok(!removalVerdict(a, b, 'n'));
  });
  check('public-ca-bundle', () => {
    const d = tmp(), f = (name, content) => { const p = path.join(d, name); fs.writeFileSync(p, content); return p; };
    try {
      const pem = rootCertificates.slice(0, 3).join('\n') + '\n';
      const ok = readPublicCa(f('ok', '# comment\n' + pem));
      assert.deepEqual([ok.certificates, ok.size, ok.sha256], [3, ok.bytes.length, sha(ok.bytes)]);
      for (const [name, content] of [['empty', ''], ['big', pem + ' '.repeat(MIB)], ['key', pem + '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'], ['junk', 'not a certificate'], ['trail', pem + 'extra\n'],
        ['badcert', '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n']]) throwsFor(() => readPublicCa(f(name, content)));
      fs.symlinkSync(path.join(d, 'ok'), path.join(d, 'link')); throwsFor(() => readPublicCa(path.join(d, 'link')));
      throwsFor(() => readPublicCa(d)); throwsFor(() => readPublicCa(path.join(d, 'absent')));
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  return results;
}

async function selfcheckAsync() {
  // workerd rejects non-handler exports: the shared fixture (needed by Node unit code) has data exports, the dedicated worker entry must not.
  const shared = await import('./reader-m-fixture.mjs'), entry = await import('./reader-m-worker.mjs');
  const bad = (m) => Object.entries(m).filter(([, v]) => !(typeof v === 'function' || (v && typeof v.fetch === 'function'))).map(([k]) => k).sort();
  assert.deepEqual(bad(shared), ['FAULTS', 'now', 'queries']);
  assert.deepEqual(Object.keys(entry).sort(), ['ReaderDO', 'default']);
  assert.ok(entry.ReaderDO === shared.ReaderDO && entry.default === shared.default && bad(entry).length === 0);
  assert.ok(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').includes("entryPoints: [path.join(here, 'reader-m-worker.mjs')]"), 'worker bundle must use the dedicated entry');
  const obs = await import('data:text/javascript,' + encodeURIComponent(OBSERVER));
  const zlib = await import('node:zlib');
  const text = '\u00e5\u00f8 \u20ac \ud83d\ude00 '.repeat(50), want = Buffer.byteLength(text), gz = zlib.gzipSync(text);
  const withCounters = (fn) => { globalThis.t15Counters = { files: 1, manifest: 0, decoded: 0 }; try { fn(); const c = globalThis.t15Counters; return c; } finally { delete globalThis.t15Counters; } };
  let res;
  assert.equal(withCounters(() => { res = obs.gunzipSync(gz, { info: true }); }).manifest, want);
  assert.ok(want > text.length && res.buffer.toString() === text && res.engine && typeof res.engine.bytesWritten === 'number', 'info result preserved');
  let plain;
  assert.equal(withCounters(() => { plain = obs.gunzipSync(gz); }).manifest, want);
  assert.ok(Buffer.isBuffer(plain) && plain.toString() === text);
  globalThis.t15Counters = { files: 2, manifest: 0, decoded: 0 };
  obs.gunzipSync(gz, { info: true }); obs.gunzipSync(gz);
  assert.deepEqual(globalThis.t15Counters, { files: 2, manifest: 0, decoded: 2 * want }); delete globalThis.t15Counters;
  for (const bad of [Buffer.from('not gzip'), gz.subarray(0, gz.length - 8)]) for (const o of [undefined, { info: true }]) {
    globalThis.t15Counters = { files: 2, manifest: 0, decoded: 0 };
    assert.throws(() => obs.gunzipSync(bad, o)); assert.equal(globalThis.t15Counters.decoded, 0); delete globalThis.t15Counters;
  }
  globalThis.t15Counters = { files: 2, manifest: 0, decoded: 0 };
  assert.throws(() => obs.gunzipSync(gz, { maxOutputLength: 8 })); assert.equal(globalThis.t15Counters.decoded, 0); delete globalThis.t15Counters;
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'readerm-graph-'));
  try { // structural regression only (hand-authored strict-pnpm layout, no installed dependencies); the hosted native stage is the real qualification
    const store = path.join(tree, 'root/node_modules/.pnpm');
    const pkg = (dir, name, version) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version })); };
    pkg(path.join(store, 'w/node_modules/wrangler'), 'wrangler', '4.0.0'); pkg(path.join(store, 'm/node_modules/miniflare'), 'miniflare', '4.1.0'); pkg(path.join(store, 'm/node_modules/workerd'), 'workerd', '1.2.0');
    fs.writeFileSync(path.join(tree, 'root/package.json'), '{}');
    fs.symlinkSync('.pnpm/w/node_modules/wrangler', path.join(tree, 'root/node_modules/wrangler'));
    fs.symlinkSync('../../m/node_modules/miniflare', path.join(store, 'w/node_modules/miniflare'));
    const root = path.join(tree, 'root');
    assert.throws(() => createRequire(path.join(root, 'package.json')).resolve('miniflare/package.json')); // the pre-repair repo-anchored lookup
    const g = await installedGraph(root);
    assert.deepEqual([g.wrangler.version, g.miniflare.version, g.workerd.version], ['4.0.0', '4.1.0', '1.2.0']);
    fs.rmSync(path.join(store, 'w/node_modules/miniflare'));
    await assert.rejects(installedGraph(root), /installed graph incomplete/);
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
  const hung = await runBounded(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { deadline: Date.now() + 300 });
  assert.equal(hung.killed, 'deadline');
  const loud = await runBounded(process.execPath, ['-e', "process.stdout.write('x'.repeat(600));process.stderr.write('y'.repeat(600));setInterval(()=>{},1000)"], { deadline: Date.now() + 5000, maxBytes: 1000 });
  assert.equal(loud.killed, 'cap');
  const fine = await runBounded(process.execPath, ['-e', "console.log('ok')"], { deadline: Date.now() + 5000 });
  assert.deepEqual([fine.killed, fine.status, fine.stdout], [null, 0, 'ok\n']);
  const missing = await runBounded('/nonexistent/binary', [], { deadline: Date.now() + 2000 });
  assert.equal(missing.killed, 'error');
  const failed = await runBounded(process.execPath, ['-e', "process.stderr.write('HEAD-'+'z'.repeat(2000)+'-TAIL');process.exit(1)"], { deadline: Date.now() + 5000 });
  const cli = cliReceipt(failed);
  assert.ok(cli.status === 1 && cli.stderr.startsWith('HEAD-') && cli.stderr.endsWith('-TAIL') && cli.stderr.length === 2010 && cli.bytes <= MIB, 'full failed output retained');
  assert.match(firstFailure([{ error: 'terminal exit 1', cli }, {}, {}]), /^unit 0: terminal exit 1 \| stderr: z+-TAIL$/);
  assert.equal(dirBytes(path.join(os.tmpdir(), 'readerm-absent-' + process.pid)), 0);
  return ['worker-entry-boundary', 'transitive-miniflare-resolution', 'bounded-process-deadline', 'bounded-process-combined-cap', 'bounded-process-spawn-error', 'failed-unit-output-receipt', 'observer-real-gzip'];
}

const git = (...a) => { const r = spawnSync('git', a, { maxBuffer: 16 * MIB }); assert.equal(r.status, 0, 'git ' + a.join(' ') + ': ' + r.stderr); return r.stdout; };
const pinnedBlob = (commit) => (f) => { const r = spawnSync('git', ['cat-file', 'blob', commit + ':' + f], { maxBuffer: 16 * MIB }); return r.status === 0 ? r.stdout : null; };

async function prepare(out) {
  const root = process.cwd(), outRel = path.relative(root, out);
  assert.ok(!outRel.startsWith('..') && outRel, 'out must be inside the checkout (docker context)');
  const require = createRequire(path.join(root, 'package.json'));
  const esbuild = require('esbuild');
  const ca = readPublicCa(); // fail before any native work if the hosted trust bundle is unusable
  fs.rmSync(out, { recursive: true, force: true });
  const links = checkSymlinks(path.join(root, 'node_modules'));
  const blobs = {};
  for (const [v, pin] of Object.entries(PINS)) {
    if (spawnSync('git', ['cat-file', '-e', pin.commit + ':' + READER]).status !== 0) git('fetch', '--no-tags', '--depth=1', 'origin', pin.commit);
    blobs[v] = git('cat-file', 'blob', pin.commit + ':' + READER);
    assertBlob(blobs[v], pin.blob);
  }
  const resolveDir = path.join(root, path.dirname(READER));
  const common = { bundle: true, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent', metafile: true, absWorkingDir: root };
  const observer = OBSERVER;
  for (const v of Object.keys(PINS)) {
    const dir = path.join(out, 'variants', v); fs.mkdirSync(dir, { recursive: true });
    const reader = await esbuild.build({ ...common, stdin: { contents: blobs[v].toString(), loader: 'ts', resolveDir, sourcefile: root + '/' + READER }, packages: 'external', outfile: path.join(dir, 'reader.mjs') });
    const worker = await esbuild.build({ ...common, entryPoints: [path.join(here, 'reader-m-worker.mjs')], outfile: path.join(dir, 'worker.mjs'), nodePaths: [path.join(root, 'node_modules')],
      plugins: [{ name: 'variant', setup(b) {
        b.onResolve({ filter: /^@t15\/reader$/ }, () => ({ path: 'reader', namespace: 'variant' }));
        b.onLoad({ filter: /.*/, namespace: 'variant' }, () => ({ contents: blobs[v].toString(), loader: 'ts', resolveDir }));
        b.onResolve({ filter: /^node:zlib$/ }, (a) => (a.importer.endsWith('cloudflare-store.ts') ? { path: 'zobs', namespace: 'zobs' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'zobs' }, () => ({ contents: observer, loader: 'js' }));
      } }] });
    const own = (m) => Object.keys(m.inputs).filter((f) => f !== READER);
    fs.writeFileSync(path.join(dir, 'closure.json'), JSON.stringify({ reader: checkClosure(own(reader.metafile), root, pinnedBlob(PINS[v].commit)), worker: checkClosure(own(worker.metafile), root, pinnedBlob(PINS[v].commit)) }));
  }
  fs.copyFileSync(path.join(here, 'reader-m-fixture.mjs'), path.join(out, 'fixture.mjs'));
  fs.copyFileSync(path.join(here, 'reader-m-unit.mjs'), path.join(out, 'unit.mjs'));
  fs.writeFileSync(path.join(out, 'ca-certificates.crt'), ca.bytes);
  assert.ok(!fs.existsSync(path.join(out, 'openssl.cnf')), 'openssl.cnf must stay absent from the image context');
  fs.writeFileSync(path.join(out, 'protocol.json'), JSON.stringify(PROTOCOL));
  const { miniflare, workerd } = await installedGraph(root);
  const ver = (r, p) => JSON.parse(fs.readFileSync(r.resolve(p + '/package.json'), 'utf8')).version;
  const binary = (r, pkg, sub) => sha(fs.readFileSync(owned(r, pkg, sub)));
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const workerdBin = await findPackage(workerd.dir, '@cloudflare/workerd-linux-' + (arch === 'x64' ? '64' : 'arm64'));
  assert.ok(workerdBin, 'workerd binary package not installed');
  const graph = { node: process.version, links, lock: sha(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), esbuild: ver(require, 'esbuild'), miniflare: miniflare.version, workerd: workerd.version,
    esbuildBinary: binary(require, 'esbuild', '@esbuild/linux-' + arch + '/bin/esbuild'), workerdBinary: sha(fs.readFileSync(path.join(workerdBin.dir, 'bin/workerd'))),
    openssl: { conf: 'ABSENT', paths: ['/etc/ssl/openssl.cnf', OPENSSL_CONF_ABSENT] }, ca: { source: ca.source, size: ca.size, sha256: ca.sha256, certificates: ca.certificates, imagePath: CA_IMAGE_PATH } };
  const docker = { Dockerfile: 'FROM ' + NODE_IMAGE + '\nCOPY --chmod=0555 node_modules /image/node_modules\nCOPY --chmod=0555 ' + outRel + ' /image/out\nCOPY --chmod=0444 ' + outRel + '/ca-certificates.crt ' + CA_IMAGE_PATH + '\nRUN test ! -e /etc/ssl/openssl.cnf && test ! -e ' + OPENSSL_CONF_ABSENT + '\nUSER 1000:1000\nWORKDIR /image\n',
    'Dockerfile.dockerignore': '*\n!node_modules\n!' + outRel + '\n' + outRel + '/Dockerfile*\n' + outRel + '/image.id\n' + outRel + '/freeze.json\n' + outRel + '/qualification.json\n' + outRel + '/units\n' };
  const files = {};
  for (const f of fs.readdirSync(out, { recursive: true })) if (fs.statSync(path.join(out, f)).isFile()) files[f] = sha(fs.readFileSync(path.join(out, f)));
  const control = Object.fromEntries(Object.entries(docker).map(([f, c]) => [f, sha(c)]));
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ pins: PINS, nodeImage: NODE_IMAGE, graph, files, control, protocolSha: protocolSha() }));
  for (const [f, c] of Object.entries(docker)) fs.writeFileSync(path.join(out, f), c);
  assert.ok(!overBudget(dirBytes(out)), 'host scratch over budget before image build');
  const iid = path.join(out, 'image.id');
  const built = spawnSync('docker', ['build', '--network', 'none', '-f', path.join(out, 'Dockerfile'), '--iidfile', iid, '.'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * MIB, env: { ...process.env, DOCKER_BUILDKIT: '1' } });
  assert.equal(built.status, 0, String(built.stderr).slice(-2000));
  const imageId = fs.readFileSync(iid, 'utf8').trim();
  const freeze = { imageId, manifestSha: sha(fs.readFileSync(path.join(out, 'manifest.json'))), protocolSha: protocolSha() };
  fs.writeFileSync(path.join(out, 'freeze.json'), JSON.stringify(freeze));
  return freeze;
}

const active = new Map(); // container name -> its run-owned control env
const cleanup = () => { for (const [n, env] of active) spawnSync('docker', ['rm', '-f', n], { timeout: 10000, env }); };

// Returns the unit record (also written to disk) even when the unit failed; rec.error is the negative receipt.
async function runUnit(out, freeze, unit, index) {
  const L = PROTOCOL.limits, start = Date.now();
  const workEnd = start + (L.unitSeconds - 10) * 1000, caseEnd = start + L.unitSeconds * 1000; // one 120s wall for the whole case, 10s reserved for teardown
  const name = 'reader-m-' + sha(String(Math.random()) + index).slice(0, 16);
  const rec = { unit, name, control: [], guardOk: false, out: null, terminal: null, removed: false, error: null, scratch: { reservedBytes: L.tmpfsBytes + L.shmBytes, maxHostBytes: 0, exceeded: false } };
  const runDir = path.join(out, '.run', String(index)), env = controlEnv(out, runDir);
  const docker = async (a, { teardown = false, maxBytes = MIB } = {}) => {
    const r = await runBounded('docker', a, { deadline: teardown ? caseEnd : workEnd, maxBytes, env });
    rec.control.push({ argv: a.slice(0, 2), status: r.status, killed: r.killed });
    return r;
  };
  // out holds bundles, unit records and the run-owned control caches; all of it counts against the 16MiB budget.
  const sample = () => {
    const host = dirBytes(out); rec.scratch.maxHostBytes = Math.max(rec.scratch.maxHostBytes, host);
    if ((overBudget(host) || hasSymlink(runDir)) && !rec.scratch.exceeded) { rec.scratch.exceeded = true; spawnSync('docker', ['rm', '-f', name], { timeout: 8000, env }); }
  };
  const watch = setInterval(sample, 250);
  active.set(name, env);
  try {
    assert.equal((await docker(guardArgs(name, freeze.imageId, unit.target, unit))).status, 0, 'create');
    const before = JSON.parse((await docker(['inspect', name])).stdout)[0];
    checkInspect(before, name, freeze.imageId, unit.target);
    rec.guard = before.HostConfig; rec.guardOk = true;
    const started = await docker(['start', '-a', name], { maxBytes: L.streamBytes }); // combined stdout+stderr <=1MiB, killed on cap or deadline
    rec.cli = cliReceipt(started);
    let state = null;
    try { state = JSON.parse((await docker(['inspect', name])).stdout)[0].State; } catch { /* record stays null */ }
    if (state) rec.terminal = { exit: state.ExitCode, oom: state.OOMKilled, pid: state.Pid, running: state.Running, status: state.Status };
    sample();
    assert.ok(!rec.scratch.exceeded, 'scratch over 16MiB or symlink in run dir: unit removed');
    assert.equal(started.killed, null, 'docker start ' + started.killed);
    assert.ok(state, 'no container state'); checkTerminal(state);
    const parsed = boundedJson(started.stdout);
    checkReceipts(parsed, unit); rec.out = parsed;
  } catch (e) { rec.error = String(e.message).slice(0, 500); }
  finally {
    clearInterval(watch);
    const rm = await docker(['rm', '-f', name], { teardown: true });
    const ps = await docker(['ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}'], { teardown: true });
    rec.removed = removalVerdict(rm, ps, name);
    if (rec.removed) active.delete(name);
    if (!rec.removed) { rec.cleanupFailed = { rm: { status: rm.status, killed: rm.killed, out: rm.stdout.slice(0, 200), err: rm.stderr.slice(-200) }, ps: { status: ps.status, killed: ps.killed, out: ps.stdout.slice(0, 200) } }; rec.error = rec.error ?? 'container not removed'; }
    fs.rmSync(runDir, { recursive: true, force: true });
    rec.wallMs = Date.now() - start;
  }
  fs.mkdirSync(path.join(out, 'units'), { recursive: true });
  fs.writeFileSync(path.join(out, 'units', String(index).padStart(3, '0') + '-' + unit.target + '-' + unit.variant + '.json'), JSON.stringify(rec));
  return rec;
}

const cmd = process.argv[2];
const argOf = (k) => { const i = process.argv.indexOf(k); const v = i > 0 ? process.argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : undefined; };
if (import.meta.url === 'file://' + process.argv[1]) {
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(130); });
  const usage = () => { console.error('usage: reader-m-prepare.mjs selfcheck | ci --out DIR | m --out DIR --admitted-protocol-sha SHA'); process.exit(2); };
  const runSelfcheck = async () => [...selfcheck(), ...await selfcheckAsync()];
  if (cmd === 'selfcheck') console.log(JSON.stringify({ selfcheck: await runSelfcheck() }));
  else if (cmd === 'ci' || cmd === 'm') {
    if (process.argv.includes('--out') && !argOf('--out')) usage();
    if (cmd === 'm' && !/^[0-9a-f]{64}$/.test(argOf('--admitted-protocol-sha') ?? '')) usage();
    const out = path.resolve(argOf('--out') ?? '.reader-m');
    if (cmd === 'm') await runSelfcheck();
    const finishImage = (freeze) => assert.equal(spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', freeze.imageId], { encoding: 'utf8' }).stdout.trim(), freeze.imageId, 'image drift');
    if (cmd === 'ci') {
      let freeze, bound, error = null; const recs = [];
      try {
        try { await runSelfcheck(); } catch (e) { throw new Error('selfcheck failed before any native work: ' + e.message); }
        freeze = await prepare(out); verifyManifest(out); bound = verifyBinding(out); finishImage(freeze);
        for (const unit of qualificationUnits()) { const rec = await runUnit(out, freeze, unit, recs.length); recs.push(rec); if (rec.error) break; }
        const bad = firstFailure(recs); if (bad) throw new Error(bad);
        judge(recs);
      } catch (e) { error = String(e.message).slice(0, 2000); }
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'qualification.json'), JSON.stringify({ pass: error === null, error, protocolSha: protocolSha(), manifestSha: freeze?.manifestSha ?? null, imageId: freeze?.imageId ?? null, freezeSha: bound?.freezeSha ?? null, units: recs }));
      console.log(JSON.stringify({ qualified: error === null, units: recs.length, error, probes: recs.map((r) => r.out?.probes ?? null) }));
      if (error !== null) process.exitCode = 1;
    } else {
      assert.equal(argOf('--admitted-protocol-sha'), protocolSha(), 'protocol not admitted');
      verifyManifest(out); const bound = verifyBinding(out); verifyQualification(out, bound); finishImage(bound.freeze);
      let i = 0;
      for (const target of Object.keys(TARGETS)) for (const slot of schedule(target)) {
        const rec = await runUnit(out, bound.freeze, { variant: slot.variant, target, mode: 'measure', fixture: 'full', slot }, i++);
        assert.equal(rec.error, null, 'unit ' + (i - 1) + ': ' + rec.error);
      }
      console.log(JSON.stringify({ units: i }));
    }
  } else usage();
}
