import { describe, expect, it } from "vitest";
import {
  assertUniqueIds,
  parseMetricsHistory,
  parseMetricsSnapshot,
} from "./schema";

const acceptsGenericLabel: (
  items: { id: string }[],
  label: string,
) => void = assertUniqueIds;

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

  it("rejects duplicate container ids", () => {
    expect(() =>
      parseMetricsSnapshot({
        ...validSnapshot,
        containers: [validSnapshot.containers[0], validSnapshot.containers[0]],
      }),
    ).toThrow("Duplicate container id");
  });

  it("rejects more than 64 services", () => {
    expect(() =>
      parseMetricsSnapshot({
        ...validSnapshot,
        services: Array.from({ length: 65 }, (_, index) => ({
          ...validSnapshot.services[0],
          id: `frontpage-public-${index}`,
        })),
      }),
    ).toThrow("Invalid metrics snapshot");
  });

  it("rejects more than 64 containers", () => {
    expect(() =>
      parseMetricsSnapshot({
        ...validSnapshot,
        containers: Array.from({ length: 65 }, (_, index) => ({
          ...validSnapshot.containers[0],
          id: `frontpage-container-${index}`,
        })),
      }),
    ).toThrow("Invalid metrics snapshot");
  });

  it("allows null latency for timed-out checks", () => {
    const parsed = parseMetricsSnapshot({
      ...validSnapshot,
      services: [{ ...validSnapshot.services[0], latency_ms: null }],
    });

    expect(parsed.services[0]?.latency_ms).toBeNull();
  });

  it("rejects non-UTC checked_at timestamps", () => {
    expect(() =>
      parseMetricsSnapshot({
        ...validSnapshot,
        services: [
          {
            ...validSnapshot.services[0],
            checked_at: "2026-07-09T02:00:00+02:00",
          },
        ],
      }),
    ).toThrow("Invalid metrics snapshot");
  });

  it("rejects fractional latency values", () => {
    expect(() =>
      parseMetricsSnapshot({
        ...validSnapshot,
        services: [{ ...validSnapshot.services[0], latency_ms: 42.5 }],
      }),
    ).toThrow("Invalid metrics snapshot");
  });

  it("rejects latency values above 10000ms", () => {
    expect(() =>
      parseMetricsSnapshot({
        ...validSnapshot,
        services: [{ ...validSnapshot.services[0], latency_ms: 10001 }],
      }),
    ).toThrow("Invalid metrics snapshot");
  });
});

describe("parseMetricsHistory", () => {
  it("accepts the generic assertUniqueIds label contract", () => {
    expect(() =>
      acceptsGenericLabel(
        [
          { id: "frontpage-public" },
          { id: "frontpage-public" },
        ],
        "service",
      ),
    ).toThrow("Duplicate service id");
  });

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

  it("rejects more than 1440 history samples", () => {
    expect(() =>
      parseMetricsHistory({
        schema_version: 1,
        samples: Array.from({ length: 1441 }, () => validSnapshot),
      }),
    ).toThrow("Invalid metrics history");
  });
});
