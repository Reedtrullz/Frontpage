// Canonical reader-M bridge, run inside the guarded reader container (profiles reader-linux-local-v1 / reader-linux-do-v1).
// One MEASURE_REQUEST = one variant x one target x ONE query (request.shape.target / shape.queryIndex, the original index into
// fixture queries). The timed pass is unpatched; counters are collected afterwards, untimed, with exact output-hash parity.
// Emits the complete native JSON that native.py/measure.py/compare.py verify. It performs no statistics and writes no receipts.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fixtures, queries, now } from './reader-m-fixture.mjs';

export const CAPABILITIES = (target) => ['reader-m-bridge-v1', 'target-' + target];
const VARIANT = { baseline: 'before', candidate: 'candidate' };
// The representative M failure is a real missing manifest: the reader reports the original 'unavailable' error at the original query index.
export const FAILURE_CODE = 'unavailable';
export const SCENARIOS = ['happy', 'failure'];
const TEMPERATURES = ['cold', 'warm'];
const KEYS = ['caseHash', 'phase', 'unit', 'sample', 'scenario', 'revision', 'fixtureDigest', 'harnessDigest', 'shape', 'economicsDigest'];
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cgroupCpu = () => Number(/usage_usec (\d+)/.exec(fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8'))[1]);
const metric = (unit, value) => ({ scope: 'invocation', unit, values: [value] });

export function parseRequest(text) {
  let request;
  try { request = JSON.parse(text); } catch { throw new Error('malformed MEASURE_REQUEST'); }
  if (request === null || typeof request !== 'object' || Array.isArray(request)) throw new Error('MEASURE_REQUEST must be an object');
  for (const key of KEYS) if (!(key in request)) throw new Error('MEASURE_REQUEST missing ' + key);
  const { shape } = request;
  if (!VARIANT[request.phase]) throw new Error('unknown phase');
  if (!SCENARIOS.includes(request.scenario)) throw new Error('unknown scenario');
  if (shape === null || typeof shape !== 'object' || !['local', 'do'].includes(shape.target)) throw new Error('shape.target must be local or do');
  // Absent = cold fresh-process read (historical shape). 'warm' = untimed identical prior read in the SAME process, then one timed read.
  if ('temperature' in shape && !TEMPERATURES.includes(shape.temperature)) throw new Error('shape.temperature must be cold or warm');
  if (!Number.isInteger(shape.queryIndex) || shape.queryIndex < 0 || shape.queryIndex >= queries.length) throw new Error('shape.queryIndex outside the eight queries');
  return request;
}

// Runs fn once; a throw is data for the failure scenario, never swallowed for the happy one.
const attempt = (fn) => { try { return { value: fn() }; } catch (error) { return { error }; } };
const outcome = (r, scenario) => {
  if (scenario === 'happy') { if (r.error) throw r.error; return hash(r.value); }
  if (!r.error) throw new Error('failure scenario read succeeded');
  if (r.error.code !== FAILURE_CODE) throw new Error('failure scenario error code ' + r.error.code);
  return hash(['failure', r.error.code]);
};

// Outcome of one Durable Object response, classified like the local reader: happy needs a hash, failure needs the original error code.
export const doOutcome = (response, scenario) => {
  if (scenario === 'failure') {
    if (response.code !== FAILURE_CODE) throw new Error('failure scenario error code ' + response.code);
    return hash(['failure', response.code]);
  }
  if (!response.hash) throw new Error('happy read produced no output hash');
  return response.hash;
};
// A warm prior outcome must equal the timed outcome, not merely exist.
export const requireWarmParity = (prior, timed) => { if (prior !== timed) throw new Error('warm prior read differs from timed read'); };

async function local(dir, index, scenario, warm) {
  const { readSeriesV2 } = await import(dir + '/reader.mjs');
  const root = '/tmp/files';
  const seed = (skip) => {
    for (const [name, data] of Object.entries(fixtures(1))) {
      if (name === skip) continue;
      fs.mkdirSync(root + '/' + name.split('/').slice(0, -1).join('/'), { recursive: true });
      fs.writeFileSync(root + '/' + name, JSON.stringify(data));
    }
  };
  seed(scenario === 'failure' ? 'manifest.v2.json' : null);
  const query = queries[index];
  let warmPrior = null;
  if (warm) { // untimed, uninstrumented prior read with identical query/scenario
    warmPrior = outcome(attempt(() => readSeriesV2(root, query, new Date(now))), scenario);
  }
  const cpu0 = process.cpuUsage(), t0 = performance.now();
  const timedRun = attempt(() => readSeriesV2(root, query, new Date(now))); // unpatched
  const wallMs = performance.now() - t0, cpu = process.cpuUsage(cpu0);
  const timed = outcome(timedRun, scenario);
  if (warm) requireWarmParity(warmPrior, timed);
  const counters = { parse: 0, files: 0, decoded: 0, manifest: 0 };
  const parse = Date.parse, open = fs.openSync, read = fs.readFileSync, fds = new Map();
  Date.parse = (v) => { counters.parse++; return parse(v); };
  fs.openSync = (...a) => { const fd = open(...a); fds.set(fd, String(a[0])); counters.files++; return fd; };
  fs.readFileSync = (...a) => { const b = read(...a); const p = fds.get(a[0]); if (p?.endsWith('manifest.v2.json')) counters.manifest += b.byteLength; else if (p) counters.decoded += b.byteLength; return b; };
  syncBuiltinESMExports();
  let counted;
  try { counted = outcome(attempt(() => readSeriesV2(root, query, new Date(now))), scenario); } finally { Date.parse = parse; fs.openSync = open; fs.readFileSync = read; syncBuiltinESMExports(); }
  if (counted !== timed) throw new Error('counter pass output hash differs from timed pass');
  // One semantic digest per case: the failure scenario still reports the happy output hash, computed untimed after restoring the manifest.
  let happy = timed;
  if (scenario === 'failure') { seed(null); happy = outcome(attempt(() => readSeriesV2(root, query, new Date(now))), 'happy'); }
  return { hash: timed, happy, metrics: { cpuMicros: metric('us', cpu.user + cpu.system), wallMs: metric('ms', wallMs),
    parse: metric('count', counters.parse), files: metric('count', counters.files), decoded: metric('bytes', counters.decoded), manifest: metric('bytes', counters.manifest) } };
}

// Strict pnpm: miniflare is wrangler's transitive dependency, so resolve from wrangler's realpath.
const loadMiniflare = (nm = '/image/node_modules') => createRequire(fs.realpathSync(nm + '/wrangler/package.json'))('miniflare');

async function durable(dir, index, scenario, warm) {
  const { Miniflare, convertV4MiniflareOptions } = loadMiniflare();
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: dir + '/worker.mjs', compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { T15: { className: 'ReaderDO', useSQLite: true } }, durableObjectsPersist: '/tmp/state', cachePersist: false, kvPersist: false, r2Persist: false, d1Persist: false }));
  try {
    const get = async (suffix) => (await mf.dispatchFetch('http://fixture/read?scale=1&' + suffix)).json();
    await get('q=none'); // seed SQLite outside the measured dispatch
    let warmPrior = null;
    if (warm) { // untimed identical prior dispatch in the same Miniflare runtime
      warmPrior = doOutcome(await get(scenario === 'failure' ? 'raw=1&fail=missing&q=' + index : 'raw=1&q=' + index), scenario);
    }
    if (scenario === 'failure') {
      const c0 = cgroupCpu(), t0 = performance.now();
      const raw = await get('raw=1&fail=missing&q=' + index); // removes the manifest, then reads the ORIGINAL index
      const wallMs = performance.now() - t0, cgroupCpuMicros = cgroupCpu() - c0;
      const [counted] = await get('fail=missing&q=' + index);
      if (raw.code !== FAILURE_CODE || counted.code !== FAILURE_CODE) throw new Error('failure scenario error code ' + raw.code + '/' + counted.code);
      if (warm) requireWarmParity(warmPrior, doOutcome(raw, scenario));
      const [restored] = await get('restore=1&q=' + index);
      const c = counted.counters;
      return { hash: hash(['failure', raw.code]), happy: restored.hash, metrics: { cgroupCpuMicros: metric('us', cgroupCpuMicros), wallMs: metric('ms', wallMs), parse: metric('count', c.parse), sql: metric('count', c.sql),
        compressed: metric('bytes', c.compressed), decoded: metric('bytes', c.decoded), manifest: metric('bytes', c.manifest), files: metric('count', c.files) } };
    }
    const c0 = cgroupCpu(), t0 = performance.now();
    const raw = await get('raw=1&q=' + index); // the ORIGINAL index must reach the DO
    const wallMs = performance.now() - t0, cgroupCpuMicros = cgroupCpu() - c0;
    const [counted] = await get('q=' + index);
    if (!raw.hash || counted.hash !== raw.hash) throw new Error('counter pass output hash differs from timed pass');
    if (warm) requireWarmParity(warmPrior, doOutcome(raw, scenario));
    const c = counted.counters;
    return { hash: raw.hash, happy: raw.hash, metrics: { cgroupCpuMicros: metric('us', cgroupCpuMicros), wallMs: metric('ms', wallMs), parse: metric('count', c.parse), sql: metric('count', c.sql),
      compressed: metric('bytes', c.compressed), decoded: metric('bytes', c.decoded), manifest: metric('bytes', c.manifest), files: metric('count', c.files) } };
  } finally { await mf.dispose(); }
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const request = parseRequest(process.env.MEASURE_REQUEST ?? '');
  const { target, queryIndex } = request.shape;
  const dir = '/image/out/variants/' + VARIANT[request.phase];
  const result = await (target === 'local' ? local : durable)(dir, queryIndex, request.scenario, request.shape.temperature === 'warm');
  const native = { status: 'complete', ...Object.fromEntries(KEYS.map((k) => [k, request[k]])), queryIndex, outputHash: result.hash,
    semanticDigest: hash({ [queryIndex]: result.happy }), capabilities: CAPABILITIES(target), metrics: result.metrics };
  process.stdout.write(JSON.stringify(native) + '\n');
}
