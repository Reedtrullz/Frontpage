import type {
  IncidentV2,
  ObservabilityResource,
  OwnerResourceTotalV2,
  SeriesV2,
  WorkloadSnapshotV2,
} from "@/lib/metrics/v2/types";
import { ResourceChart } from "./ResourceChart";
import { ResourceSummary } from "./ResourceSummary";
import { WorkloadBreakdown } from "./WorkloadBreakdown";
import { formatMetricValue } from "./chart-options";

export interface DiskCapacitySummary {
  usedBytes: number;
  totalBytes: number;
  freshness: "fresh" | "stale" | "unavailable";
}

export function ResourceRow({
  resource,
  total,
  series,
  workloads,
  incidents,
  diskCapacity,
}: {
  resource: ObservabilityResource;
  total: OwnerResourceTotalV2;
  series: SeriesV2;
  workloads: WorkloadSnapshotV2[];
  incidents: IncidentV2[];
  diskCapacity?: DiskCapacitySummary;
}) {
  return (
    <section
      aria-labelledby={`owner-${resource}-heading`}
      className="observability-resource-row border-t border-[var(--border)] py-8 first:border-t-0 lg:grid lg:grid-cols-[145px_minmax(0,1fr)_minmax(260px,320px)] lg:gap-8"
    >
      <div>
        <h3 id={`owner-${resource}-heading`} className="text-lg font-semibold text-[var(--text)]">{total.label}</h3>
        <div className="mt-4"><ResourceSummary total={total} /></div>
        {resource === "disk_io" && diskCapacity ? (
          <dl className="mt-5 border-t border-[var(--border)] pt-4 text-xs">
            <dt className="font-semibold text-[var(--text)]">Disk capacity</dt>
            <dd className="mt-1 text-[var(--text-muted)]">
              {diskCapacity.freshness === "fresh" ? "Current" : "Last known"}: {formatMetricValue(diskCapacity.usedBytes, "bytes")} / {formatMetricValue(diskCapacity.totalBytes, "bytes")}
            </dd>
          </dl>
        ) : null}
      </div>
      <div className="mt-7 min-w-0 lg:mt-0">
        <ResourceChart data={series} incidents={incidents} label={`${total.label.replace(" total", "")} history`} />
      </div>
      <div className="mt-7 lg:mt-0">
        <h4 className="font-mono text-xs uppercase text-[var(--text-subtle)]">
          {total.label.replace(" total", "")} attribution
        </h4>
        <div className="mt-3">
          <WorkloadBreakdown resource={resource} total={total} workloads={workloads} />
        </div>
      </div>
    </section>
  );
}
