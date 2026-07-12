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
          diagnostics: [],
        },
      }),
    );

    expect(markup).toContain("Last known sample");
    expect(markup).not.toContain(">Collected <");
    expect(markup).toContain("42%");
  });
});
