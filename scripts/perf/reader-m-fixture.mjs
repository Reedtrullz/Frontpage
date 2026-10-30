// Test-only: authored fixtures plus the real-SQLite Durable Object that drives the unmodified reader. Never imported by production code.
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const now = '2026-07-31T00:00:07.000Z';
export const queries = ['1h', '24h', '7d', '30d'].flatMap((range) => [
  { range, view: 'host', resource: null },
  { range, view: 'workloads', resource: 'ram' },
]);
// The ten original Task15 fault classes and their expected reader error codes (t15/probe.mjs).
export const FAULTS = [['missing', 'unavailable'], ['json', 'invalid'], ['gzip', 'invalid'], ['member', 'too_large'], ['manifest-cap', 'too_large'],
  ['traversal', 'invalid'], ['duplicate', 'invalid'], ['date', 'invalid'], ['future', 'invalid'], ['aggregate', 'too_large']];

// scale 1 is the authored full-window input; 'canary' is one row, used for guard qualification and fault cases.
export function fixtures(scale = 1) {
  const files = {};
  for (const view of ['host', 'workloads']) {
    const base = view === 'host' ? 'host' : 'workloads/ram';
    for (const [range, resolution, days] of [['1h', 15, 0], ['24h', 60, 8], ['30d', 900, 31]]) {
      for (let day = 0; day <= days; day++) {
        const end = Date.parse(now) - 7000 - day * 86400000;
        const count = scale === 'canary' ? 1 : days === 0 ? 240 : resolution === 60 ? 1440 : 96;
        const timestamps = Array.from({ length: count }, (_, i) => new Date(end - (count - i - 1) * resolution * 1000).toISOString());
        const name = days === 0 ? base + '/1h.v2.json' : base + '/' + (resolution === 60 ? 'minute' : 'quarter-hour') + '/' + new Date(end).toISOString().slice(0, 10) + '.v2.json';
        files[name] = { schema_version: 2, generated_at: new Date(end).toISOString(), range, resolution_seconds: resolution, view, resource: view === 'host' ? null : 'ram', timestamps,
          series: Array.from({ length: view === 'host' ? 4 : 17 }, (_, s) => ({ id: 'series-' + s, label: 'Fixture ' + s, unit: 'bytes',
            values: timestamps.map((_, i) => ((i + s) % 13 === 0 ? null : i + s * 7)) })), coverage_percent: 90, truncated: false };
      }
    }
  }
  files['manifest.v2.json'] = { schema_version: 2, files: Object.keys(files) };
  return files;
}

// Real workerd + SQLite DO. Counters come from the SQL cursor and Date.parse, never from modeled numbers.
export class ReaderDO {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS metrics_v2_files (hash TEXT PRIMARY KEY, data BLOB)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS metrics_v2_active (id INTEGER PRIMARY KEY, enabled INTEGER, files TEXT)');
  }
  put(name, bytes, compressed = false) {
    const hash = createHash('sha256').update(bytes).digest('hex');
    this.sql.exec('INSERT OR REPLACE INTO metrics_v2_files VALUES (?,?)', hash, compressed ? bytes : gzipSync(bytes));
    this.hashes['owner/' + name] = hash;
  }
  seed(scale) {
    this.hashes = {};
    for (const [name, value] of Object.entries(fixtures(scale))) this.put(name, Buffer.from(JSON.stringify(value)));
    this.sql.exec('INSERT OR REPLACE INTO metrics_v2_active VALUES (1,1,?)', JSON.stringify(this.hashes));
  }
  // Same fault construction as t15/reader-worker.mjs, on one-row inputs.
  fault(name) {
    const manifest = (value) => this.put('manifest.v2.json', Buffer.from(JSON.stringify(value)));
    if (name === 'missing') { manifest({ schema_version: 2, files: ['host/1h.v2.json', 'host/minute/2026-07-31.v2.json'] }); delete this.hashes['owner/host/1h.v2.json']; }
    if (name === 'json') this.put('host/1h.v2.json', Buffer.from('{'));
    if (name === 'gzip') this.put('host/1h.v2.json', Buffer.from('corrupt gzip'), true);
    if (name === 'member') this.put('host/1h.v2.json', Buffer.alloc(4 * 1024 * 1024 + 1, 32));
    if (name === 'manifest-cap') this.put('manifest.v2.json', Buffer.alloc(512 * 1024 + 1, 32));
    if (name === 'traversal') manifest({ schema_version: 2, files: ['../private.sqlite'] });
    if (name === 'duplicate') manifest({ schema_version: 2, files: ['host/1h.v2.json', 'host/1h.v2.json'] });
    if (name === 'date') manifest({ schema_version: 2, files: ['host/quarter-hour/2026-02-31.v2.json'] });
    if (name === 'future') { const payload = fixtures('canary')['host/1h.v2.json']; payload.generated_at = '2099-01-01T00:00:00Z'; this.put('host/1h.v2.json', Buffer.from(JSON.stringify(payload))); }
    if (name === 'aggregate') {
      const files = Array.from({ length: 10 }, (_, i) => 'host/quarter-hour/2026-07-' + String(i + 1).padStart(2, '0') + '.v2.json');
      for (const file of files) this.put(file, Buffer.from(JSON.stringify({ padding: 'x'.repeat(3500000) })));
      manifest({ schema_version: 2, files });
    }
    this.sql.exec('UPDATE metrics_v2_active SET files=? WHERE id=1', JSON.stringify(this.hashes));
  }
  read(readSeriesV2, query) {
    const counters = { parse: 0, sql: 0, compressed: 0, decoded: 0, manifest: 0, files: 0 };
    globalThis.t15Counters = counters;
    globalThis[Symbol.for('__cloudflare-context__')] = { env: { FRONTPAGE_SQL: { exec: (...args) => {
      counters.sql++;
      const cursor = this.sql.exec(...args);
      return { toArray: () => {
        const rows = cursor.toArray();
        for (const row of rows) if (row.data) { counters.compressed += row.data.byteLength; counters.files++; }
        return rows;
      } };
    } } } };
    process.env.FRONTPAGE_CLOUDFLARE = '1';
    const parse = Date.parse;
    Date.parse = (value) => { counters.parse++; return parse(value); };
    try { return { counters, data: readSeriesV2('/cloudflare/metrics-v2/owner', query, new Date(now)) }; } finally { Date.parse = parse; }
  }
  async fetch(request) {
    const url = new URL(request.url);
    const fault = url.searchParams.get('fault');
    const scale = fault || url.searchParams.get('scale') === 'canary' ? 'canary' : 1;
    if (!this.hashes) this.seed(scale);
    const { readSeriesV2 } = await import('@t15/reader');
    const only = url.searchParams.get('q');
    // Canonical bridge timed dispatch: unpatched Date.parse and plain SQL passthrough, ORIGINAL query index; hash only.
    if (url.searchParams.get('raw') === '1') {
      const query = queries[Number(only)];
      if (!query) return Response.json({ error: 'query index' }, { status: 400 });
      globalThis[Symbol.for('__cloudflare-context__')] = { env: { FRONTPAGE_SQL: { exec: (...args) => this.sql.exec(...args) } } };
      process.env.FRONTPAGE_CLOUDFLARE = '1';
      if (url.searchParams.get('fail') === 'missing') { // real missing manifest: the reader's own unavailable error at the original index
        delete this.hashes['owner/manifest.v2.json'];
        this.sql.exec('UPDATE metrics_v2_active SET files=? WHERE id=1', JSON.stringify(this.hashes));
        try { readSeriesV2('/cloudflare/metrics-v2/owner', query, new Date(now)); return Response.json({ code: null }); } catch (error) { return Response.json({ code: error.code ?? null }); }
      }
      return Response.json({ hash: createHash('sha256').update(JSON.stringify(readSeriesV2('/cloudflare/metrics-v2/owner', query, new Date(now)))).digest('hex') });
    }
    if (only === 'fs') {
      try { return Response.json({ read: String(process.getBuiltinModule('node:fs').readFileSync('/etc/passwd')).length }); } catch (error) { return Response.json({ denied: String(error && error.code || error && error.name) }); }
    }
    if (fault) {
      this.fault(fault);
      try { this.read(readSeriesV2, { range: ['aggregate', 'date'].includes(fault) ? '30d' : '1h', view: 'host', resource: null }); return Response.json({ fault, code: null }); } catch (error) { return Response.json({ fault, code: error.code ?? null }); }
    }
    const selected = only === null ? (scale === 'canary' ? [queries[0]] : queries) : only === 'none' ? [] : [queries[Number(only)]];
    if (url.searchParams.get('restore') === '1') this.seed(scale);
    if (url.searchParams.get('fail') === 'missing') { // counter pass over the already missing manifest
      try { this.read(readSeriesV2, selected[0]); return Response.json([{ code: null }]); } catch (error) { return Response.json([{ code: error.code ?? null, counters: globalThis.t15Counters }]); }
    }
    return Response.json(selected.map((query) => {
      const { counters, data } = this.read(readSeriesV2, query);
      return { query, counters, hash: createHash('sha256').update(JSON.stringify(data)).digest('hex'), coverage: data.coverage_percent };
    }));
  }
}
export default { fetch(request, env) { return env.T15.get(env.T15.idFromName(new URL(request.url).searchParams.get('fault') ?? 'fixture')).fetch(request); } };
