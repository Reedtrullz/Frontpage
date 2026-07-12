import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoarseHistoryStrip } from "./CoarseHistoryStrip";

const legend = [
  { value: "low", label: "Low", tone: "positive" as const },
  { value: "high", label: "High", tone: "warning" as const },
  { value: "unknown", label: "Unknown", tone: "unknown" as const },
];

describe("CoarseHistoryStrip", () => {
  it("renders directional time labels and grouped bucket context", () => {
    const markup = renderToStaticMarkup(
      createElement(CoarseHistoryStrip, {
        label: "CPU pressure",
        values: ["low", "high", "low"],
        legend,
        history: [
          { collectedAt: "2026-07-08T02:00:00Z", value: "low", gapBefore: false },
          { collectedAt: "2026-07-08T14:00:00Z", value: "high", gapBefore: false },
          { collectedAt: "2026-07-09T02:00:00Z", value: "low", gapBefore: false },
        ],
        coverage: {
          availability: "available",
          windowStartAt: "2026-07-08T02:00:00Z",
          windowEndAt: "2026-07-09T02:00:00Z",
          sampleCount: 3,
          gapCount: 0,
          leadingGap: false,
          trailingGap: false,
        },
      }),
    );

    expect(markup).toContain("24h ago");
    expect(markup).toContain("12h ago");
    expect(markup).toContain(">now<");
    expect(markup).toContain("CPU pressure: Low from July 8, 2026 at 02:00 UTC");
  });

  it("announces a history gap as missing coverage", () => {
    const markup = renderToStaticMarkup(
      createElement(CoarseHistoryStrip, {
        label: "CPU pressure",
        values: ["low", "unknown"],
        legend,
        history: [
          { collectedAt: "2026-07-08T02:00:00Z", value: "low", gapBefore: false },
          { collectedAt: "2026-07-09T02:00:00Z", value: "unknown", gapBefore: true },
        ],
        coverage: {
          availability: "available",
          windowStartAt: "2026-07-08T02:00:00Z",
          windowEndAt: "2026-07-09T02:00:00Z",
          sampleCount: 2,
          gapCount: 1,
          leadingGap: false,
          trailingGap: false,
        },
      }),
    );

    expect(markup).toContain("Coverage missing before this sample");
    expect(markup).toContain("1 gap in coverage");
  });

  it("bounds the known segment before a long internal gap", () => {
    const markup = renderToStaticMarkup(
      createElement(CoarseHistoryStrip, {
        label: "CPU pressure",
        values: ["low", "high"],
        legend,
        history: [
          { collectedAt: "2026-07-08T10:00:00Z", value: "low", gapBefore: false },
          { collectedAt: "2026-07-08T20:00:00Z", value: "high", gapBefore: true },
        ],
        coverage: {
          availability: "available",
          windowStartAt: "2026-07-08T00:00:00Z",
          windowEndAt: "2026-07-09T00:00:00Z",
          sampleCount: 2,
          gapCount: 1,
          leadingGap: true,
          trailingGap: false,
        },
      }),
    );

    expect(markup).toMatch(/left:41\.66666666666667%;width:0\.06944444444444445%/);
    expect(markup).not.toMatch(/left:41\.66666666666667%;width:20\.833333333333332%/);
    expect(markup).toContain("Coverage missing before this sample");
  });

  it("caps dense history at 96 timestamp-proportional buckets", () => {
    const windowStart = Date.parse("2026-07-08T00:00:00Z");
    const history = Array.from({ length: 1_440 }, (_, index) => ({
      collectedAt: new Date(windowStart + index * 60_000).toISOString(),
      value: "low" as const,
      gapBefore: false,
    }));
    const markup = renderToStaticMarkup(
      createElement(CoarseHistoryStrip, {
        label: "CPU pressure",
        values: history.map((sample) => sample.value),
        legend,
        history,
        coverage: {
          availability: "available",
          windowStartAt: "2026-07-08T00:00:00Z",
          windowEndAt: "2026-07-09T00:00:00Z",
          sampleCount: 1_440,
          gapCount: 0,
          leadingGap: false,
          trailingGap: false,
        },
      }),
    );

    expect(markup.match(/class="absolute/g) ?? []).toHaveLength(96);
  });

  it("distinguishes unavailable history from an empty recent window", () => {
    const unavailable = renderToStaticMarkup(
      createElement(CoarseHistoryStrip, {
        label: "CPU pressure",
        values: ["low"],
        legend,
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
    const empty = renderToStaticMarkup(
      createElement(CoarseHistoryStrip, {
        label: "CPU pressure",
        values: [],
        legend,
        coverage: {
          availability: "empty",
          windowStartAt: "2026-07-08T02:00:00Z",
          windowEndAt: "2026-07-09T02:00:00Z",
          sampleCount: 0,
          gapCount: 0,
          leadingGap: false,
          trailingGap: false,
        },
      }),
    );

    expect(unavailable).toContain("History unavailable");
    expect(unavailable).not.toContain('role="img"');
    expect(empty).toContain("No recent samples");
  });

  it("positions irregular samples by the coverage interval and shows boundary gaps", () => {
    const markup = renderToStaticMarkup(
      createElement(CoarseHistoryStrip, {
        label: "CPU pressure",
        values: ["low", "high"],
        legend,
        history: [
          { collectedAt: "2026-07-08T14:00:00Z", value: "low", gapBefore: false },
          { collectedAt: "2026-07-08T20:00:00Z", value: "high", gapBefore: false },
        ],
        coverage: {
          availability: "available",
          windowStartAt: "2026-07-08T02:00:00Z",
          windowEndAt: "2026-07-09T02:00:00Z",
          sampleCount: 2,
          gapCount: 2,
          leadingGap: true,
          trailingGap: true,
        },
      }),
    );

    expect(markup).toContain("Coverage missing before first sample");
    expect(markup).toContain("Coverage missing after last sample");
    expect(markup).toMatch(/left:50%/);
    expect(markup).toMatch(/left:62\.5%/);
  });
});
