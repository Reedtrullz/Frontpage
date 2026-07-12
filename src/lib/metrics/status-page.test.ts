import { describe, expect, it } from "vitest";
import type { MetricsReadResult } from "./reader";
import {
  createStatusPageModel,
  deriveOverallPublicStatus,
  deriveOwnerAttention,
  deriveProjectHealth,
} from "./status-page";

const readResult: MetricsReadResult = {
  freshness: "fresh",
  historyAvailability: "available",
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
      gapBefore: false,
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

describe("deriveOverallPublicStatus", () => {
  it("reports delayed status without counting stale checks as up", () => {
    const model = createStatusPageModel({
      readResult: { ...readResult, freshness: "stale" },
      isOwner: false,
      now: new Date("2026-07-09T02:02:00Z"),
    });

    expect(model.overall).toMatchObject({
      kind: "delayed",
      label: "Status delayed",
    });
    expect(model.public.host.serviceSummary).toMatchObject({
      total: 1,
      up: 0,
      unknown: 1,
    });
  });

  it("reports unavailable current telemetry separately from no configured checks", () => {
    const model = createStatusPageModel({
      readResult: {
        ...readResult,
        freshness: "unavailable",
        latest: null,
      },
      isOwner: false,
      now: new Date("2026-07-09T02:02:00Z"),
    });

    expect(model.overall.kind).toBe("unavailable");
    expect(model.public.lastKnownServiceCount).toBe(1);
    expect(model.public.host.serviceSummary.total).toBe(0);
  });

  it("keeps CPU and RAM pressure informational and disk watch operational", () => {
    const publicModel = createStatusPageModel({
      readResult: {
        ...readResult,
        latest: readResult.latest
          ? {
              ...readResult.latest,
              host: {
                ...readResult.latest.host,
                cpu_percent: 99,
                ram_used_bytes: 99,
                disk_used_bytes: 80,
              },
            }
          : null,
      },
      isOwner: false,
      now: new Date("2026-07-09T02:00:30Z"),
    }).public;

    expect(publicModel.host.diskPressure).toBe("watch");
    expect(deriveOverallPublicStatus(publicModel).kind).toBe("operational");
  });

  it("does not claim operational when critical disk pressure is degraded", () => {
    const publicModel = createStatusPageModel({
      readResult: {
        ...readResult,
        latest: readResult.latest
          ? {
              ...readResult.latest,
              host: {
                ...readResult.latest.host,
                disk_used_bytes: 90,
              },
            }
          : null,
      },
      isOwner: false,
      now: new Date("2026-07-09T02:00:30Z"),
    }).public;

    expect(deriveOverallPublicStatus(publicModel)).toMatchObject({
      kind: "degraded",
      description: "Host disk pressure is critical.",
    });
  });

  it("prioritizes a down service over a healthy host", () => {
    const model = createStatusPageModel({
      readResult: {
        ...readResult,
        latest: readResult.latest
          ? {
              ...readResult.latest,
              services: readResult.latest.services.map((service) =>
                service.visibility === "public"
                  ? { ...service, status: "down" as const }
                  : service,
              ),
            }
          : null,
      },
      isOwner: false,
      now: new Date("2026-07-09T02:00:30Z"),
    });

    expect(deriveOverallPublicStatus(model.public).kind).toBe("disruption");
  });

  it("prioritizes unavailable metrics over last-known service state", () => {
    const publicModel = createStatusPageModel({
      readResult: { ...readResult, freshness: "unavailable" },
      isOwner: false,
      now: new Date("2026-07-09T02:06:00Z"),
    }).public;

    expect(deriveOverallPublicStatus(publicModel).kind).toBe("unavailable");
  });

  it("reports no checks without claiming zero of zero are up", () => {
    const publicModel = createStatusPageModel({
      readResult: {
        ...readResult,
        latest: readResult.latest
          ? { ...readResult.latest, services: [] }
          : null,
      },
      isOwner: false,
      now: new Date("2026-07-09T02:00:30Z"),
    }).public;

    expect(deriveOverallPublicStatus(publicModel)).toMatchObject({
      kind: "no-checks",
      label: "No public checks",
    });
  });
});

describe("deriveProjectHealth", () => {
  it("returns degraded when a configured check is down while another is up", () => {
    expect(
      deriveProjectHealth(
        { slug: "sample", healthServiceIds: ["one", "two"] },
        [
          {
            id: "one",
            label: "One",
            status: "up",
            latencyMs: 10,
            checkedAt: "2026-07-09T02:00:00Z",
          },
          {
            id: "two",
            label: "Two",
            status: "down",
            latencyMs: null,
            checkedAt: "2026-07-09T02:00:00Z",
          },
        ],
        "fresh",
      ),
    ).toBe("degraded");
  });

  it("returns disruption when every configured check is down", () => {
    expect(
      deriveProjectHealth(
        { slug: "sample", healthServiceIds: ["one", "two"] },
        [
          {
            id: "one",
            label: "One",
            status: "down",
            latencyMs: null,
            checkedAt: "2026-07-09T02:00:00Z",
          },
          {
            id: "two",
            label: "Two",
            status: "down",
            latencyMs: null,
            checkedAt: "2026-07-09T02:00:00Z",
          },
        ],
        "fresh",
      ),
    ).toBe("disruption");
  });

  it("returns degraded when an unknown check remains alongside an up check", () => {
    expect(
      deriveProjectHealth(
        { slug: "sample", healthServiceIds: ["one", "two"] },
        [
          {
            id: "one",
            label: "One",
            status: "up",
            latencyMs: 10,
            checkedAt: "2026-07-09T02:00:00Z",
          },
          {
            id: "two",
            label: "Two",
            status: "unknown",
            latencyMs: null,
            checkedAt: "2026-07-09T02:00:00Z",
          },
        ],
        "fresh",
      ),
    ).toBe("degraded");
  });

  it("returns not monitored when no check is bound", () => {
    expect(
      deriveProjectHealth(
        { slug: "sample" },
        [],
        "fresh",
      ),
    ).toBe("not-monitored");
  });

  it("returns unavailable when a configured binding has no matching check", () => {
    expect(
      deriveProjectHealth(
        { slug: "sample", healthServiceIds: ["missing"] },
        [],
        "fresh",
      ),
    ).toBe("unavailable");
  });

  it("returns unavailable for configured checks when telemetry is stale", () => {
    expect(
      deriveProjectHealth(
        { slug: "sample", healthServiceIds: ["one"] },
        [
          {
            id: "one",
            label: "One",
            status: "up",
            latencyMs: 10,
            checkedAt: "2026-07-09T02:00:00Z",
          },
        ],
        "stale",
      ),
    ).toBe("unavailable");
  });
});

describe("deriveOwnerAttention", () => {
  it("identifies resource and service issues", () => {
    const owner = createStatusPageModel({
      readResult: {
        ...readResult,
        latest: readResult.latest
          ? {
              ...readResult.latest,
              host: {
                ...readResult.latest.host,
                disk_used_bytes: 92,
                disk_total_bytes: 100,
              },
              services: readResult.latest.services.map((service) => ({
                ...service,
                status: "down" as const,
              })),
            }
          : null,
      },
      isOwner: true,
      now: new Date("2026-07-09T02:00:30Z"),
    }).owner;

    const attention = deriveOwnerAttention(owner);
    expect(attention.some((item) => item.id === "disk-critical")).toBe(true);
    expect(attention.some((item) => item.id === "services-down")).toBe(true);
  });
});
