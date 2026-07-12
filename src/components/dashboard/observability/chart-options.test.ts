import { describe, expect, it } from "vitest";
import type { IncidentV2, SeriesV2 } from "@/lib/metrics/v2/types";
import {
  chartData,
  formatMetricValue,
  incidentMarkers,
  nearestNonNullPoint,
  rangeLabel,
  createChartOptions,
} from "./chart-options";

const series: SeriesV2 = {
  schema_version: 2,
  generated_at: "2026-07-12T19:00:00Z",
  range: "1h",
  resolution_seconds: 15,
  view: "host",
  resource: null,
  timestamps: [
    "2026-07-12T18:59:15Z",
    "2026-07-12T18:59:30Z",
    "2026-07-12T18:59:45Z",
    "2026-07-12T19:00:00Z",
  ],
  series: [
    { id: "cpu-total", label: "CPU total", unit: "percent", values: [10, null, 30, 40] },
  ],
  coverage_percent: 75,
  truncated: false,
};

const incident: IncidentV2 = {
  id: "cpu-watch-1",
  rule_id: "cpu-watch",
  title: "CPU elevated",
  severity: "warning",
  state: "active",
  visibility: "owner",
  resource: "cpu",
  opened_at: "2026-07-12T18:59:31Z",
  updated_at: "2026-07-12T18:59:45Z",
  coverage_percent: 100,
  capability_state: "available",
  summary: "CPU crossed the warning threshold.",
};

describe("observability chart transformations", () => {
  it("preserves explicit gaps in aligned uPlot data", () => {
    const data = chartData(series);
    expect(data[0]).toEqual(series.timestamps.map((value) => Date.parse(value) / 1000));
    expect(data[1]).toEqual([10, null, 30, 40]);
  });

  it("formats approved units and range labels", () => {
    expect(formatMetricValue(42.34, "percent")).toBe("42.3%");
    expect(formatMetricValue(1_572_864, "bytes")).toBe("1.5 MiB");
    expect(formatMetricValue(2_500_000, "bytes_per_second")).toBe("2.4 MiB/s");
    expect(rangeLabel("1h")).toBe("Last hour");
    expect(rangeLabel("30d")).toBe("Last 30 days");
  });

  it("maps incidents to the nearest chart timestamp", () => {
    expect(incidentMarkers([incident], series.timestamps)).toEqual([
      { incidentId: "cpu-watch-1", index: 1, timestamp: "2026-07-12T18:59:30Z" },
    ]);
  });

  it("moves keyboard inspection to the nearest non-null point", () => {
    expect(nearestNonNullPoint(series.series[0]!.values, 1, 1)).toBe(2);
    expect(nearestNonNullPoint(series.series[0]!.values, 1, -1)).toBe(0);
    expect(nearestNonNullPoint([null, null], 0, 1)).toBeNull();
    expect(nearestNonNullPoint([10], 1, 1)).toBeNull();
  });

  it("formats axis and legend values with the series unit", () => {
    const options = createChartOptions({ data: series, width: 640, onCursor: () => undefined });
    const axisValues = options.axes?.[1]?.values;
    const seriesValue = options.series?.[1]?.value;
    expect(typeof axisValues === "function" ? axisValues({} as never, [10, 20], 0, 100, 10) : []).toEqual([
      "10.0%",
      "20.0%",
    ]);
    expect(typeof seriesValue === "function" ? seriesValue({} as never, 42, 0, 1) : null).toBe("42.0%");
  });
});
