import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseOwnerLatestV2, parseSeriesV2 } from "@/lib/metrics/v2/schema";
import {
  OwnerAttentionSummary,
  observabilityAttentionItems,
} from "./OwnerAttentionSummary";

const fixtureRoot = path.resolve("ops/tests/fixtures/observability-v2");
const latest = parseOwnerLatestV2(
  JSON.parse(fs.readFileSync(path.join(fixtureRoot, "owner-latest.json"), "utf8")),
);
const baseSeries = parseSeriesV2(
  JSON.parse(fs.readFileSync(path.join(fixtureRoot, "host-series-1h.json"), "utf8")),
);

describe("v2 owner attention", () => {
  it("derives bounded capability, truncation, and attribution warnings", () => {
    const items = observabilityAttentionItems({
      latest,
      series: { ...baseSeries, truncated: true },
    });
    expect(items.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        "Network workload attribution unavailable",
        "Attribution truncated",
        "Attribution coverage reduced",
      ]),
    );
  });

  it("renders v2 warnings alongside existing owner attention", () => {
    const markup = renderToStaticMarkup(
      <OwnerAttentionSummary
        items={[]}
        observability={{ latest, series: { ...baseSeries, truncated: true } }}
      />,
    );
    expect(markup).toContain("Owner attention");
    expect(markup).toContain("Attribution truncated");
    expect(markup).not.toContain("No attention needed");
  });
});
