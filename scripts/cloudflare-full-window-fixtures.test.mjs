import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fullWindowFixture } from '../tests/cloudflare/full-window-fixtures.mjs';

const now = Date.parse('2026-10-28T19:00:00.000Z');
const cases = [['1h', 240, 15], ['24h', 1440, 60], ['7d', 10080, 60], ['30d', 2880, 900]];

for (const [range, cap, resolution] of cases) {
  for (const view of ['host', 'workloads']) {
    test(`full native fixture: ${range} ${view}`, () => {
      const built = fullWindowFixture(range, view, now);
      assert.equal(built.spec.cap, cap);
      assert.equal(built.spec.resolution, resolution);
      assert.equal(built.fixture.timestamps.length, cap);
      assert.equal(built.fixture.series.length, view === 'workloads' ? 17 : 2);
      const marks = built.fixture.timestamps.map(Date.parse);
      assert.equal(marks.at(-1), Math.floor(now / (resolution * 1000)) * resolution * 1000);
      assert.equal(marks[0], marks.at(-1) - (cap - 1) * resolution * 1000);
      assert.ok(marks.every((mark, index) => index === 0 || mark - marks[index - 1] === resolution * 1000));
      const chunks = Object.entries(built.payloads).filter(([name]) => name !== 'owner/manifest.v2.json');
      const inWindow = new Set(chunks.flatMap(([, chunk]) => chunk.timestamps).filter(stamp => marks.includes(Date.parse(stamp))));
      assert.equal(inWindow.size, cap);
      if (view === 'workloads') {
        assert.deepEqual(built.fixture.series.map(item => item.id), Array.from({ length: 17 }, (_, index) => `fixture-workload-${String(index + 1).padStart(2, '0')}`));
        assert.ok(built.fixture.series.every(item => item.unit === 'bytes'));
      }
      for (const item of built.fixture.series) {
        assert.equal(item.values.length, cap);
        assert.ok(item.values.some(value => value === null));
        assert.ok(item.values.some(value => value !== null));
        assert.deepEqual(item.values.slice(-4), [null, null, null, null]);
      }
      const bytes = Object.values(built.payloads).map(value => Buffer.byteLength(JSON.stringify(value)));
      assert.ok(bytes.every(size => size < 4 * 1024 * 1024));
      assert.ok(bytes.reduce((sum, size) => sum + size, 0) < 32 * 1024 * 1024);
      assert.ok(built.payloads['owner/manifest.v2.json'].files.length <= 32);
      if (range !== '1h') {
        assert.ok(chunks.some(([, chunk]) => chunk.series[0].values.includes(987.5)), 'old excluded chunk must remain in the manifest');
        assert.ok(chunks.some(([, chunk]) => chunk.series[0].values.includes(111.1)), 'overlap loser must be present in the inputs');
      }
    });
  }
}

test('full native fixture rejects invalid range, view and time before generating rows', () => {
  for (const range of ['__proto__', '91d', undefined]) assert.throws(() => fullWindowFixture(range, 'host', now));
  for (const view of ['public', undefined]) assert.throws(() => fullWindowFixture('1h', view, now));
  for (const at of [NaN, Infinity, '2026-10-28', 9e15]) assert.throws(() => fullWindowFixture('1h', 'host', at));
});

test('midnight full native fixture retains both UTC-day boundaries', () => {
  const at = Date.parse('2026-10-28T00:00:00.000Z');
  const built = fullWindowFixture('24h', 'host', at);
  assert.equal(built.fixture.timestamps[0], '2026-10-27T00:01:00.000Z');
  assert.equal(built.fixture.timestamps.at(-1), '2026-10-28T00:00:00.000Z');
  assert.ok(Object.hasOwn(built.payloads, 'owner/host/minute/2026-10-28.v2.json'));
});
