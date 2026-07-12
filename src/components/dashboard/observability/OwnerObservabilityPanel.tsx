"use client";

import { useState } from "react";
import type {
  IncidentV2,
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
    initial: initial.series,
    range,
    view: "host",
    resource: null,
  });
  const selectedIncident = initial.latest.incidents.find((incident) => incident.id === selectedIncidentId);
  const incidentsFor = (resource: ObservabilityResource): IncidentV2[] =>
    (selectedIncident ? [selectedIncident] : initial.latest.incidents).filter(
      (incident) => incident.resource === null || incident.resource === resource,
    );
  const stale = initial.latest.freshness !== "fresh";

  return (
    <section aria-labelledby="owner-observability-heading" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-14">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-sm text-[var(--role-info)]">OWNER ONLY</p>
          <h2 id="owner-observability-heading" className="mt-2 text-3xl font-semibold text-[var(--text)]">Resource observability</h2>
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            {stale ? "Last known sample" : "Current sample"} · workload attribution is bounded and reconciled to host totals.
          </p>
        </div>
        <RangeControl value={range} onChange={setRange} />
      </div>

      {observed.status === "error" || observed.status === "offline" || observed.status === "auth-expired" ? (
        <p className="mt-5 border-y border-[var(--role-warning-border)] py-3 text-sm text-[var(--role-warning)]">
          {observed.status === "auth-expired"
            ? "Owner session expired. Chart polling stopped."
            : observed.status === "offline"
              ? "Offline. Showing the last loaded chart data."
              : "Chart refresh failed. Showing the last loaded data."}
        </p>
      ) : null}

      <div className="mt-7 border-y border-[var(--border)]">
        {resources.map((resource) => {
          const total = initial.latest.host.totals.find((item) => item.resource === resource);
          if (!total) return null;
          return (
            <ResourceRow
              diskCapacity={resource === "disk_io" ? diskCapacity : undefined}
              incidents={incidentsFor(resource)}
              key={resource}
              resource={resource}
              series={seriesForResource(observed.data, resource)}
              total={total}
              workloads={initial.latest.workloads}
            />
          );
        })}
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <section aria-labelledby="owner-capabilities-heading">
          <h3 id="owner-capabilities-heading" className="text-xl font-semibold text-[var(--text)]">Source capabilities</h3>
          <dl className="mt-4 border-y border-[var(--border)]">
            {initial.latest.host.capabilities.map((capability) => (
              <div className="border-t border-[var(--border)] py-3 first:border-t-0" key={capability.id}>
                <dt className="text-sm font-semibold text-[var(--text)]">{capability.label}</dt>
                <dd className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{capability.state}: {capability.detail}</dd>
              </div>
            ))}
          </dl>
        </section>
        <IncidentTimeline incidents={initial.latest.incidents} onSelect={setSelectedIncidentId} selectedId={selectedIncidentId} />
      </div>

      <div className="mt-10">
        <WorkloadTable incidents={initial.latest.incidents} workloads={initial.latest.workloads} />
      </div>
    </section>
  );
}
