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

const snapshot = {
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
    expect(result.history).toEqual([]);
    expect(result.diagnostics.join(" ")).toContain("history.json");
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
});

describe("derivePublicMetrics", () => {
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
});
