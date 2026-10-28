import assert from 'node:assert/strict';

const windows = {
  '1h': { cap: 240, resolution: 15 },
  '24h': { cap: 1440, resolution: 60 },
  '7d': { cap: 10080, resolution: 60 },
  '30d': { cap: 2880, resolution: 900 },
};
const day = 86_400_000;

export function fullWindowFixture(range, view, now) {
  assert.ok(Object.hasOwn(windows, range), 'unsupported fixture range');
  assert.ok(view === 'host' || view === 'workloads', 'unsupported fixture view');
  assert.ok(Number.isSafeInteger(now) && Math.abs(now) <= 8.64e15, 'invalid fixture time');
  const { cap, resolution } = windows[range];
  const step = resolution * 1000;
  const last = Math.floor(now / step) * step;
  const first = last - (cap - 1) * step;
  const generatedAt = new Date(now).toISOString();
  const identity = view === 'host'
    ? [{ id: 'host-total', label: 'CPU total', unit: 'percent' }, { id: 'host-load', label: 'Load', unit: 'percent' }]
    : Array.from({ length: 17 }, (_, index) => ({
      id: `fixture-workload-${String(index + 1).padStart(2, '0')}`,
      label: `Fixture workload ${String(index + 1).padStart(2, '0')}`,
      unit: 'bytes',
    }));
  const value = (slot, series) => slot >= cap - 4 || (slot + 1) % 11 === 0
    ? null
    : view === 'host' ? (slot % 90) + series / 100 : (series + 1) * 100000 + slot;
  const timestamps = Array.from({ length: cap }, (_, index) => new Date(first + index * step).toISOString());
  const fixture = {
    timestamps,
    series: identity.map((item, series) => ({ ...item, values: timestamps.map((_, slot) => value(slot, series)) })),
  };
  const spec = { range, view, resource: view === 'workloads' ? 'ram' : null, resolution, cap };
  const base = view === 'host' ? 'host' : 'workloads/ram';
  const payloads = {};
  const files = [];
  function put(name, marks, values) {
    const series = identity.map((item, index) => ({ ...item, values: values[index] }));
    const available = series.reduce((sum, item) => sum + item.values.filter(value => value !== null).length, 0);
    payloads['owner/' + name] = {
      schema_version: 2, generated_at: generatedAt, range, view, resource: spec.resource,
      resolution_seconds: resolution, timestamps: marks, series,
      coverage_percent: available / (marks.length * series.length) * 100, truncated: false,
    };
    files.push(name);
  }
  if (range === '1h') {
    put(base + '/1h.v2.json', timestamps, fixture.series.map(item => [...item.values]));
  } else {
    const tier = range === '30d' ? 'quarter-hour' : 'minute';
    for (let start = Math.floor(first / day) * day; start <= last; start += day) {
      const begin = Math.max(first, start);
      const end = Math.min(last, start + day - step);
      const marks = [];
      const values = identity.map(() => []);
      for (let at = begin; at <= end; at += step) {
        marks.push(new Date(at).toISOString());
        values.forEach((items, series) => items.push(value((at - first) / step, series)));
      }
      if (start + day <= last) {
        // The later UTC day's row must replace this earlier overlap value.
        marks.push(new Date(start + day).toISOString());
        values.forEach(items => items.push(111.1));
      }
      put(base + '/' + tier + '/' + new Date(start).toISOString().slice(0, 10) + '.v2.json', marks, values);
    }
    const old = Math.floor(first / day) * day - 2 * day;
    put(base + '/' + tier + '/' + new Date(old).toISOString().slice(0, 10) + '.v2.json',
      [new Date(old).toISOString()], identity.map(() => [987.5]));
  }
  payloads['owner/manifest.v2.json'] = { schema_version: 2, files };
  return { spec, payloads, fixture };
}
