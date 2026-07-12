import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicMetricsModel } from "@/lib/metrics/reader";
import { PublicStatusBand } from "./PublicStatusBand";

function metrics(
  overrides: Partial<PublicMetricsModel> = {},
): PublicMetricsModel {
  return {
    freshness: "fresh",
    host: {
      state: "online",
      diskPressure: "watch",
      lastUpdatedAt: "2026-07-09T02:00:00Z",
      lastUpdatedLabel: "30s ago",
      serviceSummary: { total: 2, up: 2, down: 0, unknown: 0 },
    },
    services: [],
    projectHealthBySlug: {},
    history: [],
    historyCoverage: {
      availability: "available",
      windowStartAt: "2026-07-08T02:00:00Z",
      windowEndAt: "2026-07-09T02:00:00Z",
      sampleCount: 0,
      gapCount: 0,
      leadingGap: false,
      trailingGap: false,
    },
    serviceTrends: {},
    ...overrides,
  };
}

describe("PublicStatusBand", () => {
  it("labels stale public summary values as last known", () => {
    const markup = renderToStaticMarkup(
      createElement(PublicStatusBand, {
        metrics: metrics({
          freshness: "stale",
          host: {
            ...metrics().host,
            state: "stale",
            serviceSummary: { total: 2, up: 0, down: 0, unknown: 2 },
          },
        }),
      }),
    );

    expect(markup).toContain("Last known sample: 2 public checks");
    expect(markup).toContain("Last known: watch");
    expect(markup).not.toContain("0/2 up");
    expect(markup).not.toContain(">Updated<");
  });

  it("does not imply configured checks when current telemetry is unavailable", () => {
    const markup = renderToStaticMarkup(
      createElement(PublicStatusBand, {
        metrics: metrics({
          freshness: "unavailable",
          host: {
            ...metrics().host,
            state: "unknown",
            diskPressure: "unknown",
            lastUpdatedAt: null,
            lastUpdatedLabel: "unknown",
            serviceSummary: { total: 0, up: 0, down: 0, unknown: 0 },
          },
        }),
      }),
    );

    expect(markup).toContain("Current public checks unavailable");
    expect(markup).toContain("Disk unavailable");
    expect(markup).not.toContain("not configured");
    expect(markup).not.toContain("0/0 up");
  });
});
