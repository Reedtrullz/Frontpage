import { describe, expect, it } from "vitest";
import type { MetricsReadResult } from "./reader";
import { createStatusPageModel } from "./status-page";

const readResult: MetricsReadResult = {
  freshness: "fresh",
  diagnostics: [],
  latest: {
    schema_version: 1,
    collected_at: "2026-07-09T02:00:00Z",
    host: {
      cpu_percent: 11,
      ram_used_bytes: 20,
      ram_total_bytes: 100,
      disk_used_bytes: 70,
      disk_total_bytes: 100,
      load_1m: 0.1,
      load_5m: 0.2,
      load_15m: 0.3,
      uptime_seconds: 123,
    },
    services: [
      {
        id: "frontpage-public",
        label: "Frontpage",
        visibility: "public",
        status: "up",
        checked_at: "2026-07-09T02:00:00Z",
        latency_ms: 20,
      },
      {
        id: "frontpage-internal",
        label: "Frontpage internal",
        visibility: "owner",
        status: "up",
        checked_at: "2026-07-09T02:00:00Z",
        latency_ms: 5,
      },
    ],
    containers: [
      {
        id: "frontpage-container",
        label: "Frontpage container",
        status: "up",
        checked_at: "2026-07-09T02:00:00Z",
      },
    ],
  },
  history: [],
};

if (readResult.latest) {
  readResult.history = [readResult.latest];
}

describe("createStatusPageModel", () => {
  it("does not include exact owner metrics for public visitors", () => {
    const model = createStatusPageModel({
      readResult,
      isOwner: false,
      now: new Date("2026-07-09T02:00:30Z"),
    });

    expect(model.owner).toBeNull();
    expect(model.public.history[0]).toEqual({
      collectedAt: "2026-07-09T02:00:00Z",
      cpu: "low",
      ram: "low",
      disk: "ok",
    });
    expect(JSON.stringify(model.public)).not.toContain("load_1m");
    expect(JSON.stringify(model.public)).not.toContain("cpu_percent");
    expect(JSON.stringify(model.public)).not.toContain("cpuPercent");
    expect(JSON.stringify(model.public)).not.toContain("ram_used_bytes");
    expect(JSON.stringify(model.public)).not.toContain("ramPercent");
    expect(JSON.stringify(model.public)).not.toContain("disk_used_bytes");
    expect(JSON.stringify(model.public)).not.toContain("diskPercent");
    expect(JSON.stringify(model.public)).not.toContain("uptime_seconds");
    expect(JSON.stringify(model.public)).not.toContain("frontpage-internal");
    expect(JSON.stringify(model.public)).not.toContain("frontpage-container");
  });

  it("includes exact owner metrics for owners", () => {
    const model = createStatusPageModel({
      readResult,
      isOwner: true,
      now: new Date("2026-07-09T02:00:30Z"),
    });

    expect(model.owner?.latest?.host.load_1m).toBe(0.1);
    expect(model.owner?.latest?.containers).toHaveLength(1);
    expect(model.owner?.latest?.services).toHaveLength(2);
  });
});
