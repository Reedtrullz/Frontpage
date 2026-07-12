import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MetricsSparkline } from "./MetricsSparkline";

describe("MetricsSparkline", () => {
  it("labels a normalized history window without inferring one from sample count", () => {
    const markup = renderToStaticMarkup(
      createElement(MetricsSparkline, {
        label: "CPU",
        samples: [
          { collectedAt: "2026-07-08T08:00:00Z", value: 20, gapBefore: false },
          { collectedAt: "2026-07-08T20:00:00Z", value: 40, gapBefore: true },
          { collectedAt: "2026-07-09T02:00:00Z", value: 30, gapBefore: false },
        ],
        warningAt: 80,
        criticalAt: 95,
        coverage: {
          availability: "available",
          windowStartAt: "2026-07-08T02:00:00Z",
          windowEndAt: "2026-07-09T02:00:00Z",
          sampleCount: 3,
          gapCount: 1,
          leadingGap: true,
          trailingGap: false,
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
        samples: [],
        warningAt: 80,
        criticalAt: 95,
        coverage: {
          availability: "unavailable",
          windowStartAt: "2026-07-08T02:00:00Z",
          windowEndAt: "2026-07-09T02:00:00Z",
          sampleCount: 0,
          gapCount: 0,
          leadingGap: false,
          trailingGap: false,
        },
      }),
    );

    expect(markup).toContain("History unavailable");
    expect(markup).not.toContain("24-hour trend");
  });

  it("shows a truthful singleton owner sample instead of hiding it", () => {
    const markup = renderToStaticMarkup(
      createElement(MetricsSparkline, {
        label: "CPU",
        samples: [
          { collectedAt: "2026-07-09T02:00:00Z", value: 42, gapBefore: false },
        ],
        warningAt: 80,
        criticalAt: 95,
        coverage: {
          availability: "available",
          windowStartAt: "2026-07-08T02:00:00Z",
          windowEndAt: "2026-07-09T02:00:00Z",
          sampleCount: 1,
          gapCount: 2,
          leadingGap: true,
          trailingGap: true,
        },
      }),
    );

    expect(markup).toContain('aria-label="CPU single recent sample. Latest 42 percent, range 42 to 42 percent. Warning at 80 percent and critical at 95 percent."');
    expect(markup).toContain("<circle");
    expect(markup).toContain("Single sample; no trend yet.");
    expect(markup).not.toContain("No recent samples");
  });

  it("breaks the owner trend polyline at missing time", () => {
    const markup = renderToStaticMarkup(
      createElement(MetricsSparkline, {
        label: "CPU",
        samples: [
          { collectedAt: "2026-07-09T00:00:00Z", value: 20, gapBefore: false },
          { collectedAt: "2026-07-09T01:00:00Z", value: 40, gapBefore: true },
          { collectedAt: "2026-07-09T02:00:00Z", value: 30, gapBefore: false },
        ],
        warningAt: 80,
        criticalAt: 95,
        coverage: {
          availability: "available",
          windowStartAt: "2026-07-08T02:00:00Z",
          windowEndAt: "2026-07-09T02:00:00Z",
          sampleCount: 3,
          gapCount: 1,
          leadingGap: true,
          trailingGap: false,
        },
      }),
    );

    expect(markup.match(/<polyline/g)).toHaveLength(1);
    expect(markup.match(/<circle/g)).toHaveLength(1);
    expect(markup).toContain("293.3");
    expect(markup).toContain("306.7");
  });
});
