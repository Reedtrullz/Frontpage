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
});
