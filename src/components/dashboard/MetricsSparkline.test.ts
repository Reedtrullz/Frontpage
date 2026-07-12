import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MetricsSparkline } from "./MetricsSparkline";

describe("MetricsSparkline", () => {
  it("labels a normalized history window without inferring one from sample count", () => {
    const markup = renderToStaticMarkup(
      createElement(MetricsSparkline, {
        label: "CPU",
        values: [20, 40, 30],
        warningAt: 80,
        criticalAt: 95,
        coverage: {
          availability: "available",
          windowStartAt: "2026-07-08T02:00:00Z",
          windowEndAt: "2026-07-09T02:00:00Z",
          sampleCount: 3,
          gapCount: 1,
        },
      }),
    );

    expect(markup).toContain("24-hour window");
    expect(markup).toContain("1 gap in coverage");
    expect(markup).not.toContain("24-hour trend");
  });

  it("uses coverage metadata for an unavailable history state", () => {
    const markup = renderToStaticMarkup(
      createElement(MetricsSparkline, {
        label: "CPU",
        values: [],
        warningAt: 80,
        criticalAt: 95,
        coverage: {
          availability: "unavailable",
          windowStartAt: "2026-07-08T02:00:00Z",
          windowEndAt: "2026-07-09T02:00:00Z",
          sampleCount: 0,
          gapCount: 0,
        },
      }),
    );

    expect(markup).toContain("History unavailable");
    expect(markup).not.toContain("24-hour trend");
  });
});
