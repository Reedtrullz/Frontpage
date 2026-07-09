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

interface StatusView {
  label: string;
  description: string;
  icon: LucideIcon;
  className: string;
}

function statusView(metrics: PublicMetricsModel): StatusView {
  if (metrics.host.serviceSummary.down > 0) {
    return {
      label: "Service disruption",
      description: `${metrics.host.serviceSummary.down} public check${metrics.host.serviceSummary.down === 1 ? " is" : "s are"} reporting down.`,
      icon: CircleAlert,
      className: "border-[var(--role-failure-border)] bg-[var(--role-failure-soft)] text-[var(--role-failure)]",
    };
  }
  if (metrics.freshness === "stale") {
    return {
      label: "Reporting delayed",
      description: "The latest host sample is stale and is not treated as current health.",
      icon: Clock3,
      className: "border-[var(--role-warning-border)] bg-[var(--role-warning-soft)] text-[var(--role-warning)]",
    };
  }
  if (metrics.freshness === "unavailable") {
    return {
      label: "Status unavailable",
      description: "Current host telemetry is unavailable. No healthy state is assumed.",
      icon: CircleHelp,
      className: "border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-muted)]",
    };
  }
  return {
    label: "Systems reporting",
    description: `${metrics.host.serviceSummary.up} of ${metrics.host.serviceSummary.total} public checks report up; host telemetry is current.`,
    icon: CircleCheck,
    className: "border-[var(--role-positive-border)] bg-[var(--role-positive-soft)] text-[var(--role-positive)]",
  };
}

export function PublicStatusBand({ metrics }: { metrics: PublicMetricsModel }) {
  const view = statusView(metrics);
  const Icon = view.icon;
  return (
    <section className={`border-y ${view.className}`} aria-labelledby="public-status-title">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 id="public-status-title" className="text-sm font-semibold">{view.label}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{view.description}</p>
          </div>
        </div>
        <Link href="/status" className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-semibold text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
          Full status <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
