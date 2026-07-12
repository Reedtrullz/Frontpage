import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock3,
  type LucideIcon,
} from "lucide-react";
import type {
  OverallPublicStatus,
  OverallPublicStatusKind,
  PublicStatusMetricsModel,
} from "@/lib/metrics/status-page";
import { RelativeTime } from "@/components/ui/RelativeTime";

const stateView: Record<
  OverallPublicStatusKind,
  { icon: LucideIcon; className: string }
> = {
  unavailable: {
    icon: CircleHelp,
    className: "border-[var(--border-strong)] text-[var(--text-muted)]",
  },
  delayed: {
    icon: Clock3,
    className: "border-[var(--role-warning-border)] text-[var(--role-warning)]",
  },
  disruption: {
    icon: CircleAlert,
    className: "border-[var(--role-failure-border)] text-[var(--role-failure)]",
  },
  degraded: {
    icon: CircleAlert,
    className: "border-[var(--role-warning-border)] text-[var(--role-warning)]",
  },
  operational: {
    icon: CircleCheck,
    className: "border-[var(--role-positive-border)] text-[var(--role-positive)]",
  },
  "no-checks": {
    icon: CircleHelp,
    className: "border-[var(--border-strong)] text-[var(--text-muted)]",
  },
};

export function VpsStatusSummary({
  metrics,
  overall,
}: {
  metrics: PublicStatusMetricsModel;
  overall: OverallPublicStatus;
}) {
  const view = stateView[overall.kind];
  const Icon = view.icon;
  const services = metrics.host.serviceSummary;
  const hasCurrentSample = metrics.freshness === "fresh";
  const serviceValue = hasCurrentSample
    ? services.total > 0
      ? `${services.up}/${services.total} up`
      : "No checks"
    : metrics.freshness === "stale"
      ? "Current status pending"
      : "No current sample";
  const lastKnownServiceCount = metrics.lastKnownServiceCount;
  const diskValue = diskPressureValue(
    metrics.host.diskPressure,
    hasCurrentSample,
  );
  return (
    <section className={`border-y bg-[var(--surface-raised)] ${view.className}`} aria-labelledby="overall-status-heading">
      <div className="mx-auto grid max-w-7xl gap-0 px-4 sm:px-6 lg:grid-cols-[1.4fr_repeat(3,0.7fr)]">
        <div className="flex gap-3 py-6 lg:pr-8">
          <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 id="overall-status-heading" className="text-base font-semibold">{overall.label}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{overall.description}</p>
          </div>
        </div>
        <SummaryField label="Public services" value={serviceValue}>
          {!hasCurrentSample && lastKnownServiceCount !== null ? (
            <span className="mt-1 block text-xs text-[var(--text-subtle)]">
              Last known: {lastKnownServiceCount} configured check{lastKnownServiceCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </SummaryField>
        <SummaryField
          label="Host telemetry"
          value={
            hasCurrentSample
              ? "Current"
              : metrics.freshness === "stale"
                ? "Delayed"
                : "No current sample"
          }
        />
        <SummaryField label="Disk pressure" value={diskValue}>
          {metrics.host.lastUpdatedAt ? (
            <span className="mt-1 block text-xs text-[var(--text-subtle)]">
              {hasCurrentSample ? "Updated" : "Sampled"}{" "}
              <RelativeTime value={metrics.host.lastUpdatedAt} />
            </span>
          ) : null}
        </SummaryField>
      </div>
    </section>
  );
}

function diskPressureValue(
  pressure: PublicStatusMetricsModel["host"]["diskPressure"],
  current: boolean,
): string {
  const label =
    pressure === "ok"
      ? "OK"
      : pressure === "watch"
        ? "Watch"
        : pressure === "critical"
          ? "Critical"
          : "Unavailable";
  return current || pressure === "unknown" ? label : `Last known: ${label.toLowerCase()}`;
}

function SummaryField({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--border)] py-5 lg:border-l lg:border-t-0 lg:px-6">
      <p className="text-xs text-[var(--text-subtle)]">{label}</p>
      <p className="mt-1 text-sm font-semibold capitalize text-[var(--text)]">{value}</p>
      {children}
    </div>
  );
}
