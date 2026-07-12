import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SeriesV2 } from "@/lib/metrics/v2/types";
import { RangeControl } from "./RangeControl";
import { ResourceChart } from "./ResourceChart";

const data: SeriesV2 = {
  schema_version: 2,
  generated_at: "2026-07-12T19:00:00Z",
  range: "1h",
  resolution_seconds: 15,
  view: "host",
  resource: null,
  timestamps: ["2026-07-12T18:59:45Z", "2026-07-12T19:00:00Z"],
  series: [
    { id: "cpu-total", label: "CPU total", unit: "percent", values: [20, null] },
  ],
  coverage_percent: 50,
  truncated: false,
};

describe("ResourceChart server fallback", () => {
  it("renders a textual summary, keyboard surface, and accessible data table", () => {
    const markup = renderToStaticMarkup(
      <ResourceChart data={data} label="CPU history" incidents={[]} />,
    );
    expect(markup).toContain("CPU history");
    expect(markup).toContain("Last hour");
    expect(markup).toContain("50% coverage");
    expect(markup).toContain("tabindex=\"0\"");
    expect(markup).toContain("<table");
    expect(markup).toContain("CPU total");
    expect(markup).toContain("Gap");
  });

  it("renders a segmented range control with pressed state", () => {
    const markup = renderToStaticMarkup(
      <RangeControl value="7d" onChange={() => undefined} />,
    );
    expect(markup).toContain("aria-label=\"History range\"");
    expect(markup).toContain("aria-pressed=\"true\"");
    expect(markup).toContain("7 days");
  });
});
