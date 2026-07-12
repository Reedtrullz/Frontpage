import type UPlot from "uplot";
import type {
  IncidentV2,
  ObservabilityRange,
  SeriesV2,
} from "@/lib/metrics/v2/types";

export interface IncidentMarker {
  incidentId: string;
  index: number;
  timestamp: string;
}

export function chartData(data: SeriesV2): UPlot.AlignedData {
  return [
    data.timestamps.map((timestamp) => Date.parse(timestamp) / 1000),
    ...data.series.map((series) => series.values),
  ];
}

function binaryValue(value: number): { value: number; unit: string } {
  if (value >= 1024 ** 3) return { value: value / 1024 ** 3, unit: "GiB" };
  if (value >= 1024 ** 2) return { value: value / 1024 ** 2, unit: "MiB" };
  if (value >= 1024) return { value: value / 1024, unit: "KiB" };
  return { value, unit: "B" };
}

export function formatMetricValue(value: number | null, unit: string): string {
  if (value === null) return "Gap";
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "bytes" || unit === "bytes_per_second") {
    const formatted = binaryValue(value);
    return `${formatted.value.toFixed(1)} ${formatted.unit}${unit.endsWith("_per_second") ? "/s" : ""}`;
  }
  if (unit.endsWith("_per_second")) {
    return `${value.toFixed(1)} ${unit.replace("_per_second", "")}/s`;
  }
  return `${value.toFixed(1)} ${unit}`;
}

export function rangeLabel(range: ObservabilityRange): string {
  return {
    "1h": "Last hour",
    "24h": "Last 24 hours",
    "7d": "Last 7 days",
    "30d": "Last 30 days",
  }[range];
}

export function nearestNonNullPoint(
  values: Array<number | null>,
  start: number,
  direction: -1 | 1,
): number | null {
  if (start < 0 || start >= values.length) return null;
  for (
    let index = start;
    index >= 0 && index < values.length;
    index += direction
  ) {
    if (values[index] !== null) return index;
  }
  return null;
}

export function incidentMarkers(
  incidents: IncidentV2[],
  timestamps: string[],
): IncidentMarker[] {
  const values = timestamps.map(Date.parse);
  return incidents.flatMap((incident) => {
    if (values.length === 0) return [];
    const target = Date.parse(incident.opened_at);
    if (target < values[0]! || target > values.at(-1)!) return [];
    let index = 0;
    for (let candidate = 1; candidate < values.length; candidate += 1) {
      if (Math.abs(values[candidate]! - target) < Math.abs(values[index]! - target)) {
        index = candidate;
      }
    }
    return [{ incidentId: incident.id, index, timestamp: timestamps[index]! }];
  });
}

export function createChartOptions({
  data,
  width,
  onCursor,
  markers = [],
}: {
  data: SeriesV2;
  width: number;
  onCursor: (index: number | null) => void;
  markers?: IncidentMarker[];
}): UPlot.Options {
  const colors = ["#62e58a", "#8ad9ff", "#f3ca68", "#ff928a"];
  const primaryUnit = data.series[0]?.unit ?? "value";
  return {
    width,
    height: 240,
    padding: [12, 8, 0, 0],
    cursor: { drag: { x: false, y: false } },
    hooks: {
      setCursor: [(plot) => onCursor(plot.cursor.idx ?? null)],
      draw: [
        (plot) => {
          if (markers.length === 0) return;
          const context = plot.ctx;
          context.save();
          context.strokeStyle = "#f3ca68";
          context.lineWidth = 1;
          context.setLineDash([4, 4]);
          for (const marker of markers) {
            const timestamp = data.timestamps[marker.index];
            if (!timestamp) continue;
            const left = plot.valToPos(Date.parse(timestamp) / 1000, "x", true);
            context.beginPath();
            context.moveTo(left, plot.bbox.top);
            context.lineTo(left, plot.bbox.top + plot.bbox.height);
            context.stroke();
          }
          context.restore();
        },
      ],
    },
    scales: { x: { time: true } },
    axes: [
      { stroke: "#87918c", grid: { stroke: "#2b3133", width: 1 } },
      {
        stroke: "#87918c",
        grid: { stroke: "#2b3133", width: 1 },
        size: 72,
        values: (_plot, values) =>
          values.map((value) => formatMetricValue(value, primaryUnit)),
      },
    ],
    series: [
      {},
      ...data.series.map((series, index) => ({
        label: series.label,
        stroke: colors[index % colors.length],
        width: 1.5,
        spanGaps: false,
        points: { show: false },
        value: (_plot: UPlot, value: number | null) =>
          formatMetricValue(value, series.unit),
      })),
    ],
  };
}
