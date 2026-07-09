import { describe, expect, it } from "vitest";
import { parseMetricsHistory, parseMetricsSnapshot } from "./schema";

const validSnapshot = {
  schema_version: 1,
  collected_at: "2026-07-09T02:00:00Z",
  host: {
    cpu_percent: 12.5,
    ram_used_bytes: 1024,
    ram_total_bytes: 4096,
    disk_used_bytes: 2048,
    disk_total_bytes: 8192,
    load_1m: 0.3,
    load_5m: 0.4,
    load_15m: 0.5,
    uptime_seconds: 123456,
  },
  services: [
    {
      id: "frontpage-public",
      label: "Frontpage",
      project_slug: "frontpage",
      visibility: "public",
      status: "up",
      checked_at: "2026-07-09T02:00:00Z",
      latency_ms: 42,
    },
  ],
  containers: [
    {
      id: "frontpage-container",
      label: "Frontpage container",
      project_slug: "frontpage",
      status: "up",
      checked_at: "2026-07-09T02:00:00Z",
    },
  ],
};

describe("parseMetricsSnapshot", () => {
  it("accepts a valid v1 snapshot", () => {
    expect(parseMetricsSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it("rejects wrong schema versions", () => {
    expect(() =>
      parseMetricsSnapshot({ ...validSnapshot, schema_version: 2 }),
    ).toThrow("Invalid metrics snapshot");
  });

  it("rejects non-UTC timestamps", () => {
    expect(() =>
      parseMetricsSnapshot({
        ...validSnapshot,
        collected_at: "2026-07-09T02:00:00+02:00",
      }),
    ).toThrow("Invalid metrics snapshot");
  });

  it("rejects duplicate service ids", () => {
    expect(() =>
      parseMetricsSnapshot({
        ...validSnapshot,
        services: [validSnapshot.services[0], validSnapshot.services[0]],
      }),
    ).toThrow("Duplicate service id");
  });

  it("allows null latency for timed-out checks", () => {
    const parsed = parseMetricsSnapshot({
      ...validSnapshot,
      services: [{ ...validSnapshot.services[0], latency_ms: null }],
    });

    expect(parsed.services[0]?.latency_ms).toBeNull();
  });
});

describe("parseMetricsHistory", () => {
  it("accepts a bounded history wrapper", () => {
    expect(
      parseMetricsHistory({
        schema_version: 1,
        samples: [validSnapshot],
      }),
    ).toEqual({
      schema_version: 1,
      samples: [validSnapshot],
    });
  });

  it("rejects a bad sample without rejecting latest elsewhere", () => {
    expect(() =>
      parseMetricsHistory({
        schema_version: 1,
        samples: [{ ...validSnapshot, schema_version: 2 }],
      }),
    ).toThrow("Invalid metrics history");
  });
});
