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
        },
      }),
    );

    expect(markup).toContain("Coverage missing before this sample");
    expect(markup).toContain("1 gap in coverage");
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
        },
      }),
    );

    expect(unavailable).toContain("History unavailable");
    expect(unavailable).not.toContain('role="img"');
    expect(empty).toContain("No recent samples");
  });
});
