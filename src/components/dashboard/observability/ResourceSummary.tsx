import type { OwnerResourceTotalV2 } from "@/lib/metrics/v2/types";
import { formatMetricValue } from "./chart-options";

export function ResourceSummary({ total }: { total: OwnerResourceTotalV2 }) {
  const freshnessLabel =
    total.freshness === "fresh"
      ? "Current sample"
      : total.freshness === "stale"
        ? "Last known sample"
        : "Telemetry unavailable";
  return (
    <div>
      <p className="font-mono text-xs uppercase text-[var(--text-subtle)]">{freshnessLabel}</p>
      <p className="mt-2 font-mono text-2xl text-[var(--text)]">
        {formatMetricValue(total.current, total.unit)}
      </p>
      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text-subtle)]">Average</dt>
          <dd className="font-mono text-[var(--text-muted)]">{formatMetricValue(total.average, total.unit)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text-subtle)]">Peak</dt>
          <dd className="font-mono text-[var(--text-muted)]">{formatMetricValue(total.peak, total.unit)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text-subtle)]">State</dt>
          <dd className="capitalize text-[var(--text-muted)]">{total.state}</dd>
        </div>
      </dl>
    </div>
  );
}
