import Link from "next/link";
import { CheckCircle2, CircleAlert, TriangleAlert } from "lucide-react";
import type { OwnerAttentionItem } from "@/lib/metrics/status-page";
import type { OwnerLatestV2, SeriesV2 } from "@/lib/metrics/v2/types";

export function observabilityAttentionItems({
  latest,
  series,
}: {
  latest: OwnerLatestV2;
  series: SeriesV2;
}): OwnerAttentionItem[] {
  const items: OwnerAttentionItem[] = [];
  if (latest.freshness !== "fresh") {
    items.push({
      id: `observability-${latest.freshness}`,
      severity: latest.freshness === "unavailable" ? "critical" : "warning",
      label: latest.freshness === "unavailable" ? "V2 telemetry unavailable" : "V2 telemetry delayed",
      reason: "Exact resource values are last-known and are not presented as current.",
      destination: { label: "Review resource observability", href: "#owner-observability-heading" },
    });
  }
  for (const capability of latest.host.capabilities.filter((item) => item.state !== "available")) {
    items.push({
      id: `capability-${capability.id}`,
      severity: "warning",
      label: `${capability.label} ${capability.state}`,
      reason: capability.detail,
      destination: { label: "Review source capabilities", href: "#owner-capabilities-heading" },
    });
  }
  if (series.truncated) {
    items.push({
      id: "observability-series-truncated",
      severity: "warning",
      label: "Attribution truncated",
      reason: "The workload series was reduced to the bounded ranked set plus system/untracked.",
      destination: { label: "Review current workloads", href: "#workload-table-heading" },
    });
  }
  const lowCoverage = latest.host.totals.filter(
    (total) => total.workload_view !== "unavailable" && total.attribution_coverage_percent < 90,
  );
  if (lowCoverage.length > 0) {
    items.push({
      id: "observability-attribution-coverage",
      severity: "warning",
      label: "Attribution coverage reduced",
      reason: `${lowCoverage.map((total) => total.label).join(", ")} fell below 90% workload attribution coverage.`,
      destination: { label: "Review workload attribution", href: "#owner-observability-heading" },
    });
  }
  const reconciliation = latest.host.totals.filter(
    (total) => total.reconciliation_error_percent >= 5,
  );
  if (reconciliation.length > 0) {
    items.push({
      id: "observability-reconciliation",
      severity: "warning",
      label: "Reconciliation gap",
      reason: `${reconciliation.map((total) => total.label).join(", ")} exceeded 5% reconciliation error.`,
      destination: { label: "Review resource totals", href: "#owner-observability-heading" },
    });
  }
  for (const diagnostic of latest.diagnostics) {
    items.push({
      id: `observability-diagnostic-${diagnostic.id}`,
      severity: diagnostic.severity,
      label: "Collector diagnostic",
      reason: diagnostic.message,
      destination: { label: "Open operations runbook", href: "/ansible" },
    });
  }
  return items;
}

export function OwnerAttentionSummary({
  items,
  observability,
}: {
  items: OwnerAttentionItem[];
  observability?: { latest: OwnerLatestV2; series: SeriesV2 } | null;
}) {
  const allItems = observability
    ? [...items, ...observabilityAttentionItems(observability)]
    : items;
  if (allItems.length === 0) {
    return (
      <section className="border-y border-[var(--role-positive-border)] bg-[var(--role-positive-soft)] px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-start gap-3 text-[var(--role-positive)]">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold">No attention needed</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Freshness, resource thresholds, services, and allowlisted containers are healthy.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="border-y border-[var(--role-warning-border)] bg-[var(--role-warning-soft)]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3 text-[var(--role-warning)]">
          <TriangleAlert className="h-5 w-5" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Owner attention</h2>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {allItems.map((item) => (
            <div key={item.id} className="border border-[var(--role-warning-border)] bg-[var(--surface)] p-4">
              <div className="flex items-start gap-3">
                <CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${item.severity === "critical" ? "text-[var(--role-failure)]" : "text-[var(--role-warning)]"}`} aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text)]">{item.label}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{item.reason}</p>
                  <Link href={item.destination.href} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
                    {item.destination.label}
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
