import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveOwnerMetrics,
  derivePublicMetrics,
  getProjectHealthBySlug,
  readMetricsFromDir,
} from "./reader";
import type { MetricsSnapshot } from "./types";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-metrics-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const snapshot: MetricsSnapshot = {
  schema_version: 1,
  collected_at: "2026-07-09T02:00:00Z",
  host: {
    cpu_percent: 10,
    ram_used_bytes: 20,
    ram_total_bytes: 100,
    disk_used_bytes: 70,
    disk_total_bytes: 100,
    load_1m: 0.1,
    load_5m: 0.2,
    load_15m: 0.3,
    uptime_seconds: 99,
  },
  services: [
    {
      id: "frontpage-public",
      label: "Frontpage",
      project_slug: "frontpage",
      visibility: "public",
      status: "up",
      checked_at: "2026-07-09T02:00:00Z",
      latency_ms: 33,
    },
    {
      id: "frontpage-internal",
      label: "Frontpage internal",
      project_slug: "frontpage",
      visibility: "owner",
      status: "down",
      checked_at: "2026-07-09T02:00:00Z",
      latency_ms: null,
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

function snapshotAt(
  collectedAt: string,
  overrides: Partial<MetricsSnapshot> = {},
): MetricsSnapshot {
  return {
    ...snapshot,
    ...overrides,
    collected_at: collectedAt,
  };
}

describe("readMetricsFromDir", () => {
  it("returns unavailable when METRICS_DIR is not configured", () => {
    const result = readMetricsFromDir(
      undefined,
      new Date("2026-07-09T02:00:30Z"),
    );
    expect(result.freshness).toBe("unavailable");
    expect(result.diagnostics).toContain("METRICS_DIR is not configured.");
  });

  it("reads fresh latest and history snapshots", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));
    fs.writeFileSync(
      path.join(dir, "history.json"),
      JSON.stringify({ schema_version: 1, samples: [snapshot] }),
    );

    const result = readMetricsFromDir(
      dir,
      new Date("2026-07-09T02:00:30Z"),
    );
    expect(result.freshness).toBe("fresh");
    expect(result.latest?.services).toHaveLength(2);
    expect(result.history).toHaveLength(1);
  });

  it("keeps latest usable when history is malformed", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));
    fs.writeFileSync(path.join(dir, "history.json"), "{bad json");

    const result = readMetricsFromDir(
      dir,
      new Date("2026-07-09T02:00:30Z"),
    );
    expect(result.freshness).toBe("fresh");
    expect(result.latest).not.toBeNull();
    expect(result.history).toEqual([snapshot]);
    expect(result.historyAvailability).toBe("unavailable");
    expect(result.diagnostics.join(" ")).toContain("history.json");
  });

  it("classifies schema-invalid metrics without exposing parser details", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "latest.json"),
      JSON.stringify({ ...snapshot, schema_version: 99 }),
    );

    const result = readMetricsFromDir(
      dir,
      new Date("2026-07-09T02:00:30Z"),
    );

    expect(result.latest).toBeNull();
    expect(result.diagnostics).toContain(
      "latest.json failed schema validation.",
    );
    expect(result.diagnostics.join(" ")).not.toContain("schema_version");
  });

  it("marks old metrics unavailable after five minutes", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));

    const result = readMetricsFromDir(
      dir,
      new Date("2026-07-09T02:06:00Z"),
    );
    expect(result.freshness).toBe("unavailable");
  });

  it("marks metrics stale after ninety seconds", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));

    const result = readMetricsFromDir(
      dir,
      new Date("2026-07-09T02:02:00Z"),
    );
    expect(result.freshness).toBe("stale");
  });

  it("sanitizes a future latest sample before public and owner derivation", () => {
    const dir = makeTempDir();
    const now = new Date("2026-07-09T02:00:00Z");
    const previous = snapshotAt("2026-07-09T01:59:00Z", {
      host: { ...snapshot.host, disk_used_bytes: 40 },
    });
    const future = snapshotAt("2026-07-09T02:01:00Z", {
      host: { ...snapshot.host, disk_used_bytes: 99 },
    });
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(future));
    fs.writeFileSync(
      path.join(dir, "history.json"),
      JSON.stringify({ schema_version: 1, samples: [previous] }),
    );

    const result = readMetricsFromDir(dir, now);
    const publicModel = derivePublicMetrics(result, now);
    const ownerModel = deriveOwnerMetrics(result, now);

    expect(result.latest).toBeNull();
    expect(result.freshness).toBe("unavailable");
    expect(result.diagnostics).toContain("latest.json is dated in the future.");
    expect(publicModel.host.diskPressure).toBe("unknown");
    expect(publicModel.host.lastUpdatedAt).toBeNull();
    expect(publicModel.services).toEqual([]);
    expect(ownerModel.latest).toBeNull();
    expect(ownerModel.freshness).toBe("unavailable");
  });

  it("keeps only samples from the preceding 24 hours", () => {
    const dir = makeTempDir();
    const now = new Date("2026-07-10T02:00:00Z");
    const samples = [
      snapshotAt("2026-07-09T01:00:00Z"),
      snapshotAt("2026-07-09T02:00:00Z"),
      snapshotAt("2026-07-09T14:00:00Z"),
      snapshotAt("2026-07-10T02:00:00Z"),
      snapshotAt("2026-07-10T03:00:00Z"),
    ];
    fs.writeFileSync(
      path.join(dir, "history.json"),
      JSON.stringify({ schema_version: 1, samples }),
    );

    const result = readMetricsFromDir(dir, now);

    expect(result.history.map((sample) => sample.collected_at)).toEqual([
      "2026-07-09T02:00:00Z",
      "2026-07-09T14:00:00Z",
      "2026-07-10T02:00:00Z",
    ]);
  });

  it("sorts and de-duplicates history by collected_at", () => {
    const dir = makeTempDir();
    const duplicateKept = snapshotAt("2026-07-09T02:00:00Z", {
      host: { ...snapshot.host, cpu_percent: 42 },
    });
    fs.writeFileSync(
      path.join(dir, "history.json"),
      JSON.stringify({
        schema_version: 1,
        samples: [
          snapshotAt("2026-07-09T02:01:00Z"),
          snapshotAt("2026-07-09T02:00:00Z"),
          duplicateKept,
        ],
      }),
    );

    const result = readMetricsFromDir(
      dir,
      new Date("2026-07-09T02:01:00Z"),
    );

    expect(result.history.map((sample) => sample.collected_at)).toEqual([
      "2026-07-09T02:00:00Z",
      "2026-07-09T02:01:00Z",
    ]);
    expect(result.history[0]?.host.cpu_percent).toBe(42);
  });

  it("reconciles latest into an incomplete history window", () => {
    const dir = makeTempDir();
    const previous = snapshotAt("2026-07-09T01:59:00Z");
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));
    fs.writeFileSync(
      path.join(dir, "history.json"),
      JSON.stringify({ schema_version: 1, samples: [previous] }),
    );

    const result = readMetricsFromDir(
      dir,
      new Date("2026-07-09T02:00:30Z"),
    );
    const publicModel = derivePublicMetrics(
      result,
      new Date("2026-07-09T02:00:30Z"),
    );

    expect(result.history.map((sample) => sample.collected_at)).toEqual([
      "2026-07-09T01:59:00Z",
      "2026-07-09T02:00:00Z",
    ]);
    expect(publicModel.history[1]?.gapBefore).toBe(true);
    expect(publicModel.historyCoverage.gapCount).toBe(2);
  });

  it("does not call a missing latest sample a configured-check absence", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "history.json"),
      JSON.stringify({ schema_version: 1, samples: [snapshot] }),
    );

    const result = readMetricsFromDir(
      dir,
      new Date("2026-07-09T02:01:00Z"),
    );
    const publicModel = derivePublicMetrics(
      result,
      new Date("2026-07-09T02:01:00Z"),
    );

    expect(result.freshness).toBe("unavailable");
    expect(result.latest).toBeNull();
    expect(result.historyAvailability).toBe("available");
    expect(publicModel.host.lastUpdatedAt).toBeNull();
    expect(publicModel.host.serviceSummary.total).toBe(0);
  });
});

describe("derivePublicMetrics", () => {
  it("rejects a future latest sample supplied by an in-memory caller", () => {
    const now = new Date("2026-07-09T02:00:00Z");
    const future = snapshotAt("2026-07-09T02:01:00Z", {
      host: { ...snapshot.host, disk_used_bytes: 99 },
    });
    const model = derivePublicMetrics(
      {
        freshness: "fresh",
        latest: future,
        history: [snapshotAt("2026-07-09T01:59:00Z")],
        diagnostics: [],
      },
      now,
    );

    expect(model.freshness).toBe("unavailable");
    expect(model.host.diskPressure).toBe("unknown");
    expect(model.host.lastUpdatedAt).toBeNull();
    expect(model.services).toEqual([]);
  });

  it("derives coarse public status without exact host metrics", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));
    fs.writeFileSync(
      path.join(dir, "history.json"),
      JSON.stringify({ schema_version: 1, samples: [snapshot] }),
    );
    const result = readMetricsFromDir(
      dir,
      new Date("2026-07-09T02:00:30Z"),
    );

    const publicModel = derivePublicMetrics(
      result,
      new Date("2026-07-09T02:00:30Z"),
    );
    expect(publicModel.host.diskPressure).toBe("ok");
    expect(publicModel.services).toHaveLength(1);
    expect(publicModel.history[0]).toEqual({
      collectedAt: "2026-07-09T02:00:00Z",
      cpu: "low",
      ram: "low",
      disk: "ok",
      gapBefore: false,
    });
    expect(JSON.stringify(publicModel)).not.toContain("ram_used_bytes");
    expect(JSON.stringify(publicModel)).not.toContain("ram_total_bytes");
    expect(JSON.stringify(publicModel)).not.toContain("cpu_percent");
    expect(JSON.stringify(publicModel)).not.toContain("disk_used_bytes");
    expect(JSON.stringify(publicModel)).not.toContain("disk_total_bytes");
    expect(JSON.stringify(publicModel)).not.toContain("cpuPercent");
    expect(JSON.stringify(publicModel)).not.toContain("ramPercent");
    expect(JSON.stringify(publicModel)).not.toContain("diskPercent");
    expect(JSON.stringify(publicModel)).not.toContain("load_1m");
    expect(JSON.stringify(publicModel)).not.toContain("uptime_seconds");
    expect(JSON.stringify(publicModel)).not.toContain("frontpage-internal");
    expect(JSON.stringify(publicModel)).not.toContain("frontpage-container");
    expect(JSON.stringify(publicModel)).not.toContain("diagnostics");
  });

  it("joins public services by project slug", () => {
    const model = getProjectHealthBySlug([
      {
        id: "frontpage-public",
        label: "Frontpage",
        projectSlug: "frontpage",
        status: "up",
        latencyMs: 33,
        checkedAt: "2026-07-09T02:00:00Z",
      },
    ]);

    expect(model.frontpage?.status).toBe("up");
  });

  it("does not claim services are healthy when telemetry is stale", () => {
    const model = derivePublicMetrics(
      {
        freshness: "stale",
        latest: snapshot,
        history: [snapshot],
        diagnostics: [],
      },
      new Date("2026-07-09T02:02:00Z"),
    );

    expect(model.services[0]?.status).toBe("unknown");
    expect(model.host.serviceSummary).toMatchObject({ up: 0, unknown: 1 });
  });

  it("reports collection gaps instead of presenting them as continuous history", () => {
    const dir = makeTempDir();
    const samples = [
      snapshotAt("2026-07-09T02:00:00Z", {
        services: [
          { ...snapshot.services[0], checked_at: "2026-07-09T02:00:00Z" },
        ],
      }),
      snapshotAt("2026-07-09T02:01:00Z", {
        services: [
          {
            ...snapshot.services[0],
            status: "unknown",
            checked_at: "2026-07-09T02:01:00Z",
            latency_ms: null,
          },
        ],
      }),
      snapshotAt("2026-07-09T02:02:00Z", { services: [] }),
      snapshotAt("2026-07-09T02:05:00Z", {
        services: [
          {
            ...snapshot.services[0],
            status: "down",
            checked_at: "2026-07-09T02:05:00Z",
            latency_ms: 80,
          },
        ],
      }),
    ];
    fs.writeFileSync(
      path.join(dir, "latest.json"),
      JSON.stringify(samples[2]),
    );
    fs.writeFileSync(
      path.join(dir, "history.json"),
      JSON.stringify({ schema_version: 1, samples }),
    );

    const model = derivePublicMetrics(
      readMetricsFromDir(dir, new Date("2026-07-09T02:05:30Z")),
      new Date("2026-07-09T02:05:30Z"),
    );

    expect(model.history.map((sample) => sample.gapBefore)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(model.historyCoverage).toMatchObject({
      availability: "available",
      sampleCount: 4,
      gapCount: 2,
    });
    expect(model.serviceTrends["frontpage-public"]).toEqual({
      knownChecks: 2,
      totalSamples: 4,
      availabilityPercent: 50,
      coveragePercent: 75,
      p95LatencyMs: 80,
      lastTransitionAt: "2026-07-09T02:05:00Z",
    });
  });

  it("reports leading and trailing coverage gaps for sparse windows", () => {
    const dir = makeTempDir();
    const now = new Date("2026-07-10T02:00:00Z");
    const sparse = snapshotAt("2026-07-09T14:00:00Z");
    fs.writeFileSync(
      path.join(dir, "history.json"),
      JSON.stringify({ schema_version: 1, samples: [sparse] }),
    );

    const result = readMetricsFromDir(dir, now);

    expect(result.historyAvailability).toBe("available");
    expect(result.history).toHaveLength(1);
    expect(derivePublicMetrics(result, now).historyCoverage).toMatchObject({
      leadingGap: true,
      trailingGap: true,
      gapCount: 2,
    });
  });

  it("normalizes legacy history once for every derived telemetry surface", () => {
    const now = new Date("2026-07-10T02:00:00Z");
    const duplicateKept = snapshotAt("2026-07-10T01:58:00Z", {
      host: { ...snapshot.host, cpu_percent: 72 },
      services: [
        {
          ...snapshot.services[0],
          status: "down",
          checked_at: "2026-07-10T01:58:00Z",
          latency_ms: 80,
        },
      ],
    });
    const latest = snapshotAt("2026-07-10T02:00:00Z", {
      services: [
        {
          ...snapshot.services[0],
          checked_at: "2026-07-10T02:00:00Z",
        },
      ],
    });
    const legacyResult = {
      freshness: "fresh" as const,
      latest,
      history: [
        snapshotAt("2026-07-10T03:00:00Z"),
        snapshotAt("2026-07-10T01:58:00Z"),
        snapshotAt("2026-07-09T01:00:00Z"),
        duplicateKept,
      ],
      diagnostics: [],
    };

    const publicModel = derivePublicMetrics(legacyResult, now);
    const ownerModel = deriveOwnerMetrics(legacyResult, now);
    const expectedTimestamps = [
      "2026-07-10T01:58:00Z",
      "2026-07-10T02:00:00Z",
    ];

    expect(publicModel.history.map((sample) => sample.collectedAt)).toEqual(
      expectedTimestamps,
    );
    expect(ownerModel.history.map((sample) => sample.collected_at)).toEqual(
      expectedTimestamps,
    );
    expect(publicModel.history[0]?.cpu).toBe("medium");
    expect(ownerModel.history[0]?.host.cpu_percent).toBe(72);
    expect(publicModel.history.map((sample) => sample.gapBefore)).toEqual([
      false,
      true,
    ]);
    expect(publicModel.history.every((sample) => "gapBefore" in sample)).toBe(
      true,
    );
    expect(publicModel.historyCoverage).toEqual(ownerModel.historyCoverage);
    expect(publicModel.historyCoverage.sampleCount).toBe(2);
    expect(publicModel.serviceTrends["frontpage-public"]).toMatchObject({
      knownChecks: 2,
      totalSamples: 2,
      availabilityPercent: 50,
      coveragePercent: 100,
      p95LatencyMs: 80,
      lastTransitionAt: "2026-07-10T02:00:00Z",
    });
  });
});

describe("deriveOwnerMetrics", () => {
  it("keeps exact host and owner-only data for authenticated owner rendering", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));
    const result = readMetricsFromDir(
      dir,
      new Date("2026-07-09T02:00:30Z"),
    );

    const ownerModel = deriveOwnerMetrics(result);
    expect(ownerModel?.latest?.host.ram_used_bytes).toBe(20);
    expect(ownerModel?.latest?.services).toHaveLength(2);
    expect(ownerModel?.latest?.containers).toHaveLength(1);
  });

  it("keeps diagnostics when no schema-valid latest sample exists", () => {
    const ownerModel = deriveOwnerMetrics({
      freshness: "unavailable",
      latest: null,
      history: [],
      diagnostics: ["latest.json failed schema validation."],
    });

    expect(ownerModel.latest).toBeNull();
    expect(ownerModel.diagnostics).toEqual([
      "latest.json failed schema validation.",
    ]);
  });
});
