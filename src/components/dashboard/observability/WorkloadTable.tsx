"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import type {
  IncidentV2,
  ObservabilityResource,
  WorkloadSnapshotV2,
} from "@/lib/metrics/v2/types";
import { formatMetricValue } from "./chart-options";

type SortKey = "label" | ObservabilityResource;

function resourceValue(workload: WorkloadSnapshotV2, resource: ObservabilityResource) {
  return workload.resources.find((item) => item.resource === resource);
}

export function WorkloadTable({
  workloads,
  incidents,
  defaultExpandedWorkloadId = null,
}: {
  workloads: WorkloadSnapshotV2[];
  incidents: IncidentV2[];
  defaultExpandedWorkloadId?: string | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("label");
  const [ascending, setAscending] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(defaultExpandedWorkloadId);
  const rows = useMemo(
    () =>
      [...workloads].sort((left, right) => {
        const comparison =
          sortKey === "label"
            ? left.label.localeCompare(right.label)
            : (resourceValue(left, sortKey)?.current ?? -1) -
              (resourceValue(right, sortKey)?.current ?? -1);
        return ascending ? comparison : -comparison;
      }),
    [ascending, sortKey, workloads],
  );
  const changeSort = (key: SortKey) => {
    if (key === sortKey) setAscending((value) => !value);
    else {
      setSortKey(key);
      setAscending(key === "label");
    }
  };
  const sortValue = (key: SortKey): "ascending" | "descending" | "none" =>
    sortKey === key ? (ascending ? "ascending" : "descending") : "none";

  return (
    <section aria-labelledby="workload-table-heading" className="border-t border-[var(--border)] pt-8">
      <h3 id="workload-table-heading" className="text-xl font-semibold text-[var(--text)]">Current workloads</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
        Bounded workload identities and current sanitized process samples.
      </p>
      <div className="mt-5 overflow-x-auto border-y border-[var(--border)]">
        <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
              {(["label", "cpu", "ram", "disk_io", "network"] as const).map((key) => (
                <th aria-sort={sortValue(key)} className="px-3 py-3 font-semibold" key={key} scope="col">
                  <button className="inline-flex min-h-11 items-center gap-1.5 font-semibold" onClick={() => changeSort(key)} type="button">
                    {key === "label" ? "Workload" : key === "disk_io" ? "Disk I/O" : key.toUpperCase()}
                    <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((workload) => {
              const expanded = expandedId === workload.id;
              const workloadIncidents = incidents.filter((incident) => incident.workload_id === workload.id);
              return (
                <Fragment key={workload.id}>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-3 py-3" scope="row">
                      <button
                        aria-expanded={expanded}
                        className="inline-flex min-h-11 items-center gap-2 text-left font-semibold text-[var(--text)]"
                        onClick={() => setExpandedId(expanded ? null : workload.id)}
                        type="button"
                      >
                        {expanded ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
                        {workload.label}
                      </button>
                    </th>
                    {(["cpu", "ram", "disk_io", "network"] as const).map((resource) => {
                      const value = resourceValue(workload, resource);
                      return (
                        <td className="px-3 py-3 font-mono text-xs text-[var(--text-muted)]" key={resource}>
                          {value ? formatMetricValue(value.current, value.unit) : "Unavailable"}
                        </td>
                      );
                    })}
                  </tr>
                  {expanded ? (
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                      <td className="px-4 py-5" colSpan={5}>
                        <p className="text-xs text-[var(--text-muted)]">
                          Stable identity <span className="font-mono text-[var(--text)]">{workload.id}</span> · {workload.kind} workload
                        </p>
                        <p className="mt-2 text-xs text-[var(--text-muted)]">
                          Process visibility: {workload.processes.length > 0 ? "available" : "no current rows"}.
                        </p>
                        {workloadIncidents.map((incident) => (
                          <p className="mt-2 text-xs text-[var(--role-warning)]" key={incident.id}>{incident.summary}</p>
                        ))}
                        <h4 className="mt-5 text-sm font-semibold text-[var(--text)]">Current processes</h4>
                        {workload.processes.length === 0 ? (
                          <p className="mt-2 text-xs text-[var(--text-muted)]">No current process samples.</p>
                        ) : (
                          <table className="mt-2 w-full border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                                {['PID', 'Command', 'UID', 'CPU', 'RSS', 'State'].map((field) => <th className="px-2 py-2 font-semibold" key={field} scope="col">{field}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {workload.processes.map((process) => (
                                <tr className="border-b border-[var(--border)] last:border-b-0" key={process.pid}>
                                  <td className="px-2 py-2 font-mono">{process.pid}</td>
                                  <td className="px-2 py-2 font-mono">{process.comm}</td>
                                  <td className="px-2 py-2 font-mono">{process.uid}</td>
                                  <td className="px-2 py-2 font-mono">{formatMetricValue(process.cpu_percent, "percent")}</td>
                                  <td className="px-2 py-2 font-mono">{formatMetricValue(process.rss_bytes, "bytes")}</td>
                                  <td className="px-2 py-2 capitalize">{process.state}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
