import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicStatusMetricsModel } from "@/lib/metrics/status-page";
import { VpsStatusSummary } from "./VpsStatusSummary";

function metrics(
  overrides: Partial<PublicStatusMetricsModel> = {},
): PublicStatusMetricsModel {
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
      windowStartAt: "2026-07-08T02:00:30Z",
      windowEndAt: "2026-07-09T02:00:30Z",
      sampleCount: 0,
      gapCount: 0,
    },
    serviceTrends: {},
    lastKnownServiceCount: 2,
    ...overrides,
  };
}

describe("VpsStatusSummary", () => {
  it("renders fresh checks and disk watch as current", () => {
    const markup = renderToStaticMarkup(
      createElement(VpsStatusSummary, {
        metrics: metrics(),
        overall: {
          kind: "operational",
          label: "Operational",
          description: "All configured public service checks report up.",
        },
      }),
    );

    expect(markup).toContain("2/2 up");
    expect(markup).toContain(">Current<");
    expect(markup).toContain(">Watch<");
    expect(markup).not.toContain("Last known:");
  });

  it("renders stale checks as pending and disk pressure as last known", () => {
    const markup = renderToStaticMarkup(
      createElement(VpsStatusSummary, {
        metrics: metrics({
          freshness: "stale",
          host: {
            ...metrics().host,
            state: "stale",
            serviceSummary: { total: 2, up: 0, down: 0, unknown: 2 },
          },
        }),
        overall: {
          kind: "delayed",
          label: "Status delayed",
          description: "The latest sample is stale and is shown as last-known state.",
        },
      }),
    );

    expect(markup).toContain("Current status pending");
    expect(markup).not.toContain("0/2 up");
    expect(markup).toContain("Last known: watch");
    expect(markup).toContain("Last known: 2 configured checks");
    expect(markup).toContain("aria-label=\"July 9, 2026 at 02:00 UTC\"");
  });

  it("renders a missing latest sample as unavailable with older check context", () => {
    const markup = renderToStaticMarkup(
      createElement(VpsStatusSummary, {
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
        overall: {
          kind: "unavailable",
          label: "Status unavailable",
          description: "Current telemetry is unavailable, so no healthy state is assumed.",
        },
      }),
    );

    expect(markup).toContain("No current sample");
    expect(markup).toContain("Last known: 2 configured checks");
    expect(markup).toContain(">Unavailable<");
    expect(markup).not.toContain("No checks");
  });

  it("renders critical disk pressure wording", () => {
    const markup = renderToStaticMarkup(
      createElement(VpsStatusSummary, {
        metrics: metrics({
          host: { ...metrics().host, state: "pressure", diskPressure: "critical" },
        }),
        overall: {
          kind: "degraded",
          label: "Degraded",
          description: "Host disk pressure is critical.",
        },
      }),
    );

    expect(markup).toContain("Host disk pressure is critical.");
    expect(markup).toContain(">Critical<");
  });
});
