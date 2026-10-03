"use client";

import { useState } from "react";
import type {
  IncidentV2,
  IncidentListV2,
  ObservabilityRange,
  ObservabilityResource,
  OwnerLatestV2,
  SeriesV2,
} from "@/lib/metrics/v2/types";
import { RangeControl } from "./RangeControl";
import { ResourceRow, type DiskCapacitySummary } from "./ResourceRow";
import { IncidentTimeline } from "./IncidentTimeline";
import { WorkloadTable } from "./WorkloadTable";
import { useOwnerObservability } from "./useOwnerObservability";

export interface OwnerObservabilityInitial {
  latest: OwnerLatestV2;
  incidents?: IncidentListV2 | null;
  series: SeriesV2;
}

const resources: ObservabilityResource[] = ["cpu", "ram", "disk_io", "network"];

function seriesForResource(data: SeriesV2, resource: ObservabilityResource): SeriesV2 {
  const patterns: Record<ObservabilityResource, RegExp> = {
    cpu: /cpu/i,
    ram: /ram|memory/i,
    disk_io: /disk|io-/i,
    network: /network|rx|tx/i,
  };
  const matching = data.series.filter(
    (series) =>
      patterns[resource].test(series.id) || patterns[resource].test(series.label),
  );
  const fallbackUnit = resource === "cpu" ? "percent" : resource === "ram" ? "bytes" : "bytes_per_second";
  return {
    ...data,
    resource,
    series:
      matching.length > 0
        ? matching
        : [
            {
              id: `${resource}-unavailable`,
              label: `${resource === "disk_io" ? "Disk I/O" : resource === "network" ? "Network" : resource.toUpperCase()} unavailable`,
              unit: fallbackUnit,
              values: data.timestamps.map(() => null),
            },
          ],
    coverage_percent: matching.length > 0 ? data.coverage_percent : 0,
  };
}

function displayTimestamp(value: string): string {
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

export function OwnerObservabilityPanel({
  initial,
  diskCapacity,
}: {
  initial: OwnerObservabilityInitial;
  diskCapacity?: DiskCapacitySummary;
}) {
  const [range, setRange] = useState<ObservabilityRange>("1h");
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const observed = useOwnerObservability({
    initial,
    range,
    view: "host",
    resource: null,
  });
  const latest = observed.latest;
  const series = observed.data;
  const selectedIncident = observed.incidents.find((incident) => incident.id === selectedIncidentId);

  if (observed.status === "auth-expired") {
    return (
      <section aria-labelledby="owner-observability-heading" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-14">
        <p className="font-mono text-sm text-[var(--role-info)]">OWNER ONLY</p>
        <h2 id="owner-observability-heading" className="mt-2 text-3xl font-semibold text-[var(--text)]">Resource observability</h2>
        <p className="mt-5 border-y border-[var(--role-warning-border)] py-3 text-sm text-[var(--role-warning)]">
          Owner session expired. Private telemetry was cleared; sign in again to continue.
        </p>
      </section>
    );
  }
  if (!latest || !series) {
    return <p className="mx-auto max-w-7xl px-4 py-12 text-sm text-[var(--text-muted)]">Owner telemetry is loading.</p>;
  }

  const incidentsFor = (resource: ObservabilityResource): IncidentV2[] =>
    (selectedIncident ? [selectedIncident] : observed.incidents).filter(
      (incident) => incident.resource === null || incident.resource === resource,
    );
  const stale = latest.freshness !== "fresh";
  const timestamps = [
    `Latest: ${displayTimestamp(latest.collected_at)}`,
    observed.incidentsGeneratedAt ? `Incidents: ${displayTimestamp(observed.incidentsGeneratedAt)}` : "Incidents: unavailable",
    observed.seriesGeneratedAt ? `History: ${displayTimestamp(observed.seriesGeneratedAt)}` : "History: unavailable",
  ];

  return (
    <section aria-labelledby="owner-observability-heading" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-14">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-sm text-[var(--role-info)]">OWNER ONLY</p>
          <h2 id="owner-observability-heading" className="mt-2 text-3xl font-semibold text-[var(--text)]">Resource observability</h2>
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            {stale ? "Last known sample" : "Latest sample"} · workload attribution is bounded and reconciled to host totals.
          </p>
          <p className="mt-2 text-xs text-[var(--text-subtle)]" aria-label="Telemetry source timestamps">
            {timestamps.join(" · ")}
          </p>
        </div>
        <RangeControl value={range} onChange={setRange} />
      </div>

      {observed.status === "error" || observed.status === "offline" ? (
        <p className="mt-5 border-y border-[var(--role-warning-border)] py-3 text-sm text-[var(--role-warning)]">
          {observed.status === "offline"
            ? "Offline. Showing the last loaded owner snapshot."
            : "Owner refresh failed. Showing the last loaded snapshot."}
        </p>
      ) : null}

      <div className="mt-7 border-y border-[var(--border)]">
        {resources.map((resource) => {
          const total = latest.host.totals.find((item) => item.resource === resource);
          if (!total) return null;
          return (
            <ResourceRow
              diskCapacity={resource === "disk_io" ? diskCapacity : undefined}
              incidents={incidentsFor(resource)}
              key={resource}
              resource={resource}
              series={seriesForResource(series, resource)}
              total={total}
              workloads={latest.workloads}
            />
          );
        })}
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <section aria-labelledby="owner-capabilities-heading">
          <h3 id="owner-capabilities-heading" className="text-xl font-semibold text-[var(--text)]">Source capabilities</h3>
          <dl className="mt-4 border-y border-[var(--border)]">
            {latest.host.capabilities.map((capability) => (
              <div className="border-t border-[var(--border)] py-3 first:border-t-0" key={capability.id}>
                <dt className="text-sm font-semibold text-[var(--text)]">{capability.label}</dt>
                <dd className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{capability.state}: {capability.detail}</dd>
              </div>
            ))}
          </dl>
        </section>
        <IncidentTimeline incidents={observed.incidents} onSelect={setSelectedIncidentId} selectedId={selectedIncident ? selectedIncidentId : null} />
      </div>

      <div className="mt-10">
        <WorkloadTable incidents={observed.incidents} workloads={latest.workloads} />
      </div>
    </section>
  );
}
