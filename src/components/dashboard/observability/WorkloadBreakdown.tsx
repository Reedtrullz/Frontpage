"use client";

import { useState } from "react";
import type {
  ObservabilityResource,
  OwnerResourceTotalV2,
  WorkloadSnapshotV2,
} from "@/lib/metrics/v2/types";
import { formatMetricValue } from "./chart-options";

export function WorkloadBreakdown({
  resource,
  total,
  workloads,
}: {
  resource: ObservabilityResource;
  total: OwnerResourceTotalV2;
  workloads: WorkloadSnapshotV2[];
}) {
  const available = total.workload_view !== "unavailable";
  const [mode, setMode] = useState<"total" | "workloads">(
    available ? "workloads" : "total",
  );
  const rows = workloads
    .flatMap((workload) => {
      const value = workload.resources.find((item) => item.resource === resource);
      return value ? [{ workload, value }] : [];
    })
    .sort((left, right) => right.value.current - left.value.current);
  const maximum = Math.max(...rows.map((row) => row.value.current), 1);

  return (
    <div aria-label={`${total.label} attribution`}>
      <div aria-label="Attribution view" className="grid grid-cols-2 border border-[var(--border)]" role="group">
        <button
          aria-pressed={mode === "total"}
          className="min-h-11 border-r border-[var(--border)] px-2 text-xs font-semibold text-[var(--text-muted)] aria-pressed:bg-[var(--surface-overlay)] aria-pressed:text-[var(--text)]"
          onClick={() => setMode("total")}
          type="button"
        >
          Total
        </button>
        <button
          aria-pressed={mode === "workloads"}
          className="min-h-11 px-2 text-xs font-semibold text-[var(--text-muted)] aria-pressed:bg-[var(--surface-overlay)] aria-pressed:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!available}
          onClick={() => setMode("workloads")}
          type="button"
        >
          By workload
        </button>
      </div>

      {!available ? (
        <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
          {resource === "network"
            ? "Network workload attribution unavailable"
            : "Workload attribution unavailable"}
        </p>
      ) : mode === "total" ? (
        <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
          Host total is authoritative. Switch to By workload to inspect current attribution.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map(({ workload, value }) => (
            <div key={workload.id}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate font-semibold text-[var(--text)]">{workload.label}</span>
                <span className="shrink-0 font-mono text-[var(--text-muted)]">
                  {formatMetricValue(value.current, value.unit)}
                </span>
              </div>
              <div
                aria-label={`${workload.label}: ${formatMetricValue(value.current, value.unit)}`}
                className="mt-1 h-1.5 bg-[var(--surface-overlay)]"
                role="img"
              >
                <span
                  className="block h-full bg-[var(--role-info)]"
                  style={{
                    width: `${value.current === 0 ? 0 : Math.max(1, (value.current / maximum) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <dl className="mt-5 space-y-2 border-t border-[var(--border)] pt-4 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text-subtle)]">Attribution coverage</dt>
          <dd className="font-mono text-[var(--text-muted)]">{total.attribution_coverage_percent.toFixed(1)}%</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text-subtle)]">Reconciliation error</dt>
          <dd className="font-mono text-[var(--text-muted)]">{total.reconciliation_error_percent.toFixed(1)}%</dd>
        </div>
      </dl>
    </div>
  );
}
