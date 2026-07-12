import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnerMetricsPanel } from "./OwnerMetricsPanel";

describe("OwnerMetricsPanel", () => {
  it("renders sanitized diagnostics when the latest sample is unavailable", () => {
    const markup = renderToStaticMarkup(
      createElement(OwnerMetricsPanel, {
        metrics: {
          freshness: "unavailable",
          latest: null,
          history: [],
          historyCoverage: {
            availability: "unavailable",
            windowStartAt: "2026-07-08T02:00:00Z",
            windowEndAt: "2026-07-09T02:00:00Z",
            sampleCount: 0,
            gapCount: 0,
            leadingGap: false,
            trailingGap: false,
          },
          historyGapBefore: [],
          diagnostics: ["latest.json failed schema validation."],
        },
      }),
    );

    expect(markup).toContain("Collector diagnostics (1)");
    expect(markup).toContain("latest.json failed schema validation.");
    expect(markup).toContain("Operations runbook");
  });

  it("labels schema-valid stale values as last known", () => {
    const latest = {
      schema_version: 1 as const,
      collected_at: "2026-07-09T02:00:00Z",
      host: {
        cpu_percent: 42,
        ram_used_bytes: 42,
        ram_total_bytes: 100,
        disk_used_bytes: 58,
        disk_total_bytes: 100,
        load_1m: 0.42,
        load_5m: 0.36,
        load_15m: 0.31,
        uptime_seconds: 864000,
      },
      services: [],
      containers: [],
    };
    const markup = renderToStaticMarkup(
      createElement(OwnerMetricsPanel, {
        metrics: {
          freshness: "stale",
          latest,
          history: [latest],
          historyCoverage: {
            availability: "available",
            windowStartAt: "2026-07-08T02:00:00Z",
            windowEndAt: "2026-07-09T02:00:00Z",
            sampleCount: 1,
            gapCount: 0,
            leadingGap: true,
            trailingGap: true,
          },
          historyGapBefore: [false],
          diagnostics: [],
        },
      }),
    );

    expect(markup).toContain("Last known sample");
    expect(markup).not.toContain(">Collected <");
    expect(markup).toContain("42%");
  });

  it("renders owner trends when normalized history coverage is available", () => {
    const first = {
      schema_version: 1 as const,
      collected_at: "2026-07-08T14:00:00Z",
      host: {
        cpu_percent: 42,
        ram_used_bytes: 42,
        ram_total_bytes: 100,
        disk_used_bytes: 58,
        disk_total_bytes: 100,
        load_1m: 0.42,
        load_5m: 0.36,
        load_15m: 0.31,
        uptime_seconds: 864000,
      },
      services: [],
      containers: [],
    };
    const second = { ...first, collected_at: "2026-07-09T02:00:00Z" };
    const markup = renderToStaticMarkup(
      createElement(OwnerMetricsPanel, {
        metrics: {
          freshness: "fresh",
          latest: second,
          history: [first, second],
          historyCoverage: {
            availability: "available",
            windowStartAt: "2026-07-08T02:00:00Z",
            windowEndAt: "2026-07-09T02:00:00Z",
            sampleCount: 2,
            gapCount: 0,
            leadingGap: true,
            trailingGap: false,
          },
          historyGapBefore: [false, false],
          diagnostics: [],
        },
      }),
    );

    expect(markup.match(/24-hour window/g)).toHaveLength(3);
    expect(markup).not.toContain("No recent samples");
  });
});
