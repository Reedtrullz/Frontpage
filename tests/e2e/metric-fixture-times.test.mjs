import assert from "node:assert/strict";
import { test } from "node:test";
import { alignedTimestamps } from "./metric-fixture-times.mjs";

test("synthetic series use closed UTC projection buckets at every resolution", () => {
  const now = Date.parse("2026-10-03T12:00:14.900Z");

  for (const resolutionSeconds of [15, 60, 900]) {
    const intervalMs = resolutionSeconds * 1000;
    const timestamps = alignedTimestamps(now, 4, resolutionSeconds);

    assert.deepEqual(
      timestamps,
      [3, 2, 1, 0].map((offset) =>
        new Date(Math.floor(now / intervalMs) * intervalMs - offset * intervalMs).toISOString().replace(".000Z", "Z"),
      ),
    );
    assert.ok(timestamps.every((timestamp) => Date.parse(timestamp) % intervalMs === 0));
  }
});
