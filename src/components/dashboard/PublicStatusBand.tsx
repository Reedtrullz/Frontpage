import Link from "next/link";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock3,
  type LucideIcon,
} from "lucide-react";
import type { PublicMetricsModel } from "@/lib/metrics/reader";
import { deriveOverallPublicStatus } from "@/lib/metrics/status-page";
import { RelativeTime } from "@/components/ui/RelativeTime";

interface StatusView {
  label: string;
  description: string;
  icon: LucideIcon;
  className: string;
}

function statusView(metrics: PublicMetricsModel): StatusView {
  const overall = deriveOverallPublicStatus(metrics);
  if (overall.kind === "disruption") {
    return {
      label: "Service disruption",
      description: overall.description,
      icon: CircleAlert,
      className: "border-[var(--role-failure-border)] bg-[var(--role-failure-soft)] text-[var(--role-failure)]",
    };
  }
  if (overall.kind === "delayed" || overall.kind === "degraded") {
    return {
      label: overall.label,
      description: overall.description,
      icon: Clock3,
      className: "border-[var(--role-warning-border)] bg-[var(--role-warning-soft)] text-[var(--role-warning)]",
    };
  }
  if (overall.kind === "unavailable" || overall.kind === "no-checks") {
    return {
      label: overall.label,
      description: overall.description,
      icon: CircleHelp,
      className: "border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-muted)]",
    };
  }
  return {
    label: overall.label,
    description: overall.description,
    icon: CircleCheck,
    className: "border-[var(--role-positive-border)] bg-[var(--role-positive-soft)] text-[var(--role-positive)]",
  };
}

export function PublicStatusBand({ metrics }: { metrics: PublicMetricsModel }) {
  const view = statusView(metrics);
  const Icon = view.icon;
  const services = metrics.host.serviceSummary;
  const serviceSummary =
    metrics.freshness === "fresh"
      ? services.total > 0
        ? `${services.up}/${services.total} up`
        : "not configured"
      : metrics.freshness === "stale"
        ? services.total > 0
          ? `Last known sample: ${services.total} public checks`
          : "Last known sample: no public checks"
        : "Current public checks unavailable";
  const diskSummary =
    metrics.freshness === "fresh"
      ? metrics.host.diskPressure
      : metrics.freshness === "stale"
        ? `Last known: ${metrics.host.diskPressure}`
        : "unavailable";
  return (
    <section className={`border-y ${view.className}`} aria-labelledby="public-status-title">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 id="public-status-title" className="text-sm font-semibold">{view.label}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{view.description}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-subtle)]">
              <span>Public checks {serviceSummary}</span>
              <span className="capitalize">Disk {diskSummary}</span>
              {metrics.host.lastUpdatedAt ? (
                <span>
                  {metrics.freshness === "fresh" ? "Updated" : "Last known sample"} {" "}
                  <RelativeTime value={metrics.host.lastUpdatedAt} />
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <Link href="/status" className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-semibold text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
          Full status <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
