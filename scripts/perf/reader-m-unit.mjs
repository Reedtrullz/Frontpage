// Runs inside the guarded container: one unit = one variant x one target. Emits one JSON line.
// unit.fixture 'one' = single row / single query for guard qualification; 'full' = authored window and all 8 queries.
// unit.mode 'probe' adds guard probes (and, on the DO target, the ten fault classes); it never changes the fixture.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fixtures, queries, now, FAULTS } from './fixture.mjs';

const unit = JSON.parse(process.env.UNIT);
const dir = '/image/out/variants/' + unit.variant;
const one = unit.fixture === 'one';
const scale = one ? 'canary' : 1;
const selected = one ? [queries[0]] : queries;
const probe = unit.mode === 'probe';
const cgroupCpu = () => Number(/usage_usec (\d+)/.exec(fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8'))[1]);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const out = { unit, node: process.version, receipts: [], probes: {}, faults: [] };

async function local() {
  const { readSeriesV2 } = await import(dir + '/reader.mjs');
  const root = '/tmp/files';
  for (const [name, data] of Object.entries(fixtures(scale))) {
    fs.mkdirSync(root + '/' + name.split('/').slice(0, -1).join('/'), { recursive: true });
    fs.writeFileSync(root + '/' + name, JSON.stringify(data));
  }
  const open = fs.openSync, read = fs.readFileSync;
  for (const query of selected) {
    const counters = { parse: 0, files: 0, decoded: 0, manifest: 0 };
    const parse = Date.parse, fds = new Map();
    Date.parse = (v) => { counters.parse++; return parse(v); };
    fs.openSync = (...a) => { const fd = open(...a); fds.set(fd, String(a[0])); counters.files++; return fd; };
    fs.readFileSync = (...a) => { const b = read(...a); if (fds.get(a[0]) && fds.get(a[0]).endsWith('manifest.v2.json')) counters.manifest += b.byteLength; else if (fds.has(a[0])) counters.decoded += b.byteLength; return b; };
    syncBuiltinESMExports();
    const cpu0 = process.cpuUsage(), t0 = performance.now();
    let data;
    try { data = readSeriesV2(root, query, new Date(now)); } finally { Date.parse = parse; fs.openSync = open; fs.readFileSync = read; syncBuiltinESMExports(); }
    const wallMs = performance.now() - t0, cpu = process.cpuUsage(cpu0);
    out.receipts.push({ query, counters, cpuMicros: cpu.user + cpu.system, wallMs, hash: hash(data) });
  }
  if (probe) {
    const attempt = (fn) => { try { fn(); return 'ALLOWED'; } catch (e) { return String(e.code || e.name); } };
    const cp = await import('node:child_process');
    out.probes = { writeSource: attempt(() => fs.writeFileSync('/image/out/denied', 'x')), readPrivate: attempt(() => fs.readFileSync('/etc/passwd')), child: attempt(() => cp.spawnSync('/bin/true')) };
  }
}

// Strict pnpm: miniflare is wrangler's transitive dependency, so resolve from wrangler's realpath, not from the image root.
const loadMiniflare = (nm = '/image/node_modules') => createRequire(fs.realpathSync(nm + '/wrangler/package.json'))('miniflare');

async function durable() {
  const { Miniflare, convertV4MiniflareOptions } = loadMiniflare();
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: dir + '/worker.mjs', compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { T15: { className: 'ReaderDO', useSQLite: true } }, durableObjectsPersist: '/tmp/state', cachePersist: false, kvPersist: false, r2Persist: false, d1Persist: false }));
  try {
    const get = async (q) => (await mf.dispatchFetch('http://fixture/read?scale=' + (one ? 'canary' : '1') + '&q=' + q)).json();
    await get('none'); // seeds SQLite outside the measured dispatches
    for (let i = 0; i < selected.length; i++) {
      const c0 = cgroupCpu(), t0 = performance.now();
      const [result] = await get(i);
      const wallMs = performance.now() - t0;
      out.receipts.push({ query: result.query, counters: result.counters, cgroupCpuMicros: cgroupCpu() - c0, wallMs, hash: result.hash });
    }
    if (probe) {
      out.probes = { isolateFs: await get('fs') };
      for (const [fault, expected] of FAULTS) {
        const body = await (await mf.dispatchFetch('http://fixture/read?fault=' + fault)).json();
        out.faults.push({ fault, expected, code: body.code ?? null });
      }
    }
  } finally { await mf.dispose(); }
}

await (unit.target === 'local' ? local() : durable());
process.stdout.write(JSON.stringify(out) + '\n');
