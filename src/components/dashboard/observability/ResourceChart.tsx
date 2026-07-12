"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type UPlot from "uplot";
import type { IncidentV2, SeriesV2 } from "@/lib/metrics/v2/types";
import {
  chartData,
  createChartOptions,
  formatMetricValue,
  incidentMarkers,
  nearestNonNullPoint,
  rangeLabel,
} from "./chart-options";

const TABLE_ROW_LIMIT = 120;

export function ResourceChart({
  data,
  label,
  incidents,
}: {
  data: SeriesV2;
  label: string;
  incidents: IncidentV2[];
}) {
  const descriptionId = useId();
  const chartRoot = useRef<HTMLDivElement>(null);
  const plot = useRef<UPlot | null>(null);
  const measuredPoints = useMemo(
    () =>
      data.timestamps.map((_, index) =>
        data.series.some((series) => series.values[index] !== null) ? 1 : null,
      ),
    [data],
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(() =>
    nearestNonNullPoint(measuredPoints, data.timestamps.length - 1, -1),
  );
  const inspectedIndex =
    selectedIndex !== null && measuredPoints[selectedIndex] !== null
      ? selectedIndex
      : nearestNonNullPoint(measuredPoints, data.timestamps.length - 1, -1);
  const selectedSummary = useMemo(() => {
    if (inspectedIndex === null) return "No measured samples in this range.";
    const timestamp = data.timestamps[inspectedIndex];
    const values = data.series.map(
      (series) => `${series.label} ${formatMetricValue(series.values[inspectedIndex] ?? null, series.unit)}`,
    );
    return `${timestamp ? new Date(timestamp).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC" : "Unknown time"}: ${values.join(", ")}.`;
  }, [data, inspectedIndex]);
  const tableStart = Math.max(0, data.timestamps.length - TABLE_ROW_LIMIT);

  useEffect(() => {
    const root = chartRoot.current;
    if (!root) return;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    void import("uplot").then(({ default: UPlotConstructor }) => {
      if (cancelled || !chartRoot.current) return;
      const width = Math.max(1, Math.floor(chartRoot.current.clientWidth));
      plot.current = new UPlotConstructor(
        createChartOptions({
          data,
          width,
          onCursor: setSelectedIndex,
          markers: incidentMarkers(incidents, data.timestamps),
        }),
        chartData(data),
        chartRoot.current,
      );
      observer = new ResizeObserver((entries) => {
        const nextWidth = Math.floor(entries[0]?.contentRect.width ?? width);
        if (nextWidth > 0) plot.current?.setSize({ width: nextWidth, height: 240 });
      });
      observer.observe(chartRoot.current);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      plot.current?.destroy();
      plot.current = null;
      root.replaceChildren();
    };
  }, [data, incidents]);

  const moveSelection = (direction: -1 | 1) => {
    const start = (inspectedIndex ?? (direction === 1 ? -1 : measuredPoints.length)) + direction;
    const next = nearestNonNullPoint(measuredPoints, start, direction);
    if (next !== null) {
      setSelectedIndex(next);
      plot.current?.setCursor({ left: plot.current.valToPos(Date.parse(data.timestamps[next]!) / 1000, "x"), top: 0 });
    }
  };

  return (
    <figure className="min-w-0" aria-labelledby={descriptionId}>
      <figcaption id={descriptionId} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-[var(--text)]">{label}</span>
        <span className="text-[var(--text-muted)]">
          {rangeLabel(data.range)} · {Math.round(data.coverage_percent)}% coverage
          {incidents.length > 0 ? ` · ${incidents.length} incident marker${incidents.length === 1 ? "" : "s"}` : ""}
        </span>
      </figcaption>
      <div
        aria-describedby={descriptionId}
        aria-label={`${label}. Use left and right arrow keys to inspect measured samples.`}
        className="observability-chart mt-3 min-h-60 min-w-0 border-y border-[var(--border)] py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            moveSelection(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
        ref={chartRoot}
        role="img"
        tabIndex={0}
      />
      <p aria-live="polite" className="mt-2 min-h-5 font-mono text-xs text-[var(--text-muted)]">
        {selectedSummary}
      </p>
      <details className="mt-3 border-t border-[var(--border)] pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--text)]">View chart data</summary>
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-xs">
            <caption className="sr-only">
              {label}, most recent {Math.min(TABLE_ROW_LIMIT, data.timestamps.length)} samples
            </caption>
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th className="px-2 py-2 font-semibold" scope="col">Time (UTC)</th>
                {data.series.map((series) => (
                  <th className="px-2 py-2 font-semibold" key={series.id} scope="col">{series.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.timestamps.slice(tableStart).map((timestamp, visibleIndex) => {
                const index = tableStart + visibleIndex;
                return (
                  <tr className="border-b border-[var(--border)] last:border-b-0" key={`${timestamp}-${index}`}>
                    <th className="whitespace-nowrap px-2 py-2 font-normal text-[var(--text-muted)]" scope="row">
                      {new Date(timestamp).toISOString().replace("T", " ").replace(".000Z", "Z")}
                    </th>
                    {data.series.map((series) => (
                      <td className="px-2 py-2 font-mono text-[var(--text)]" key={series.id}>
                        {formatMetricValue(series.values[index] ?? null, series.unit)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
