import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseOwnerLatestV2, parseSeriesV2 } from "@/lib/metrics/v2/schema";
import { OwnerObservabilityPanel } from "./OwnerObservabilityPanel";

const fixtureRoot = path.resolve("ops/tests/fixtures/observability-v2");
const latest = parseOwnerLatestV2(
  JSON.parse(fs.readFileSync(path.join(fixtureRoot, "owner-latest.json"), "utf8")),
);
const series = parseSeriesV2(
  JSON.parse(fs.readFileSync(path.join(fixtureRoot, "host-series-1h.json"), "utf8")),
);

describe("OwnerObservabilityPanel", () => {
  it("renders total, chart, and reconciled workload values for every resource", () => {
    const markup = renderToStaticMarkup(
      <OwnerObservabilityPanel
        initial={{ latest, series }}
        diskCapacity={{ usedBytes: 60, totalBytes: 100, freshness: "fresh" }}
      />,
    );
    for (const label of [
      "CPU total",
      "RAM total",
      "Disk capacity",
      "Disk I/O",
      "Network total",
      "system/untracked",
      "Attribution coverage",
      "Reconciliation error",
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup.match(/observability-resource-row/g)).toHaveLength(4);
    expect(markup.indexOf("CPU total")).toBeLessThan(markup.indexOf("CPU history"));
    expect(markup.indexOf("CPU history")).toBeLessThan(markup.indexOf("CPU attribution"));
  });

  it("labels stale values as last known and exposes capability gaps honestly", () => {
    const stale = parseOwnerLatestV2({
      ...latest,
      freshness: "stale",
      host: {
        ...latest.host,
        totals: latest.host.totals.map((total) => ({ ...total, freshness: "stale" })),
      },
    });
    const markup = renderToStaticMarkup(
      <OwnerObservabilityPanel initial={{ latest: stale, series }} />,
    );
    expect(markup).toContain("Last known sample");
    expect(markup).toContain("Network workload attribution unavailable");
    expect(markup).toContain("Process visibility");
    expect(markup).not.toContain("Restart");
    expect(markup).not.toContain("Deploy");
  });

  it("preserves null reset gaps in missing resource charts", () => {
    const markup = renderToStaticMarkup(
      <OwnerObservabilityPanel initial={{ latest, series }} />,
    );
    expect(markup).toContain("Disk I/O history");
    expect(markup).toContain("Network history");
    expect(markup).toContain("Gap");
  });
});
