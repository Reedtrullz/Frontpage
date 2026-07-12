import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicMetricsModel } from "@/lib/metrics/reader";
import { StatusInventory } from "./StatusInventory";

function metrics(overrides: Partial<PublicMetricsModel> = {}): PublicMetricsModel {
  return {
    freshness: "fresh",
    host: {
      state: "online",
      diskPressure: "ok",
      lastUpdatedAt: "2026-07-09T02:00:00Z",
      lastUpdatedLabel: "now",
      serviceSummary: { total: 1, up: 1, down: 0, unknown: 0 },
    },
    services: [
      {
        id: "frontpage-public",
        label: "Frontpage",
        projectSlug: "frontpage",
        status: "up",
        latencyMs: 72,
        checkedAt: "2026-07-09T02:00:00Z",
      },
    ],
    projectHealthBySlug: {},
    history: [],
    historyCoverage: {
      availability: "available",
      windowStartAt: "2026-07-08T02:00:00Z",
      windowEndAt: "2026-07-09T02:00:00Z",
      sampleCount: 4,
      gapCount: 0,
    },
    serviceTrends: {
      "frontpage-public": {
        knownChecks: 4,
        totalSamples: 4,
        availabilityPercent: 100,
        coveragePercent: 100,
        p95LatencyMs: 84,
        lastTransitionAt: "2026-07-08T14:00:00Z",
      },
    },
    ...overrides,
  };
}

describe("StatusInventory", () => {
  it("renders evidence-qualified service reliability and a discoverable project destination", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusInventory, { metrics: metrics() }),
    );

    expect(markup).toContain("100% available across 4 known checks");
    expect(markup).toContain("Coverage 100%");
    expect(markup).toContain("Last transition");
    expect(markup).toContain("Open Frontpage project");
  });

  it("labels stale latency as last known and omits unsupported trend claims", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusInventory, {
        metrics: metrics({
          freshness: "stale",
          serviceTrends: {
            "frontpage-public": {
              knownChecks: 0,
              totalSamples: 4,
              availabilityPercent: null,
              coveragePercent: 50,
              p95LatencyMs: null,
              lastTransitionAt: null,
            },
          },
        }),
      }),
    );

    expect(markup).toContain("Last known 72 ms");
    expect(markup).toContain("Coverage 50%");
    expect(markup).not.toContain("available across");
    expect(markup).not.toContain("Last transition");
  });

  it("does not expose private host fields or identifiers in public markup", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusInventory, { metrics: metrics() }),
    );

    expect(markup).not.toContain("cpu_percent");
    expect(markup).not.toContain("ram_used_bytes");
    expect(markup).not.toContain("frontpage-public");
  });
});
