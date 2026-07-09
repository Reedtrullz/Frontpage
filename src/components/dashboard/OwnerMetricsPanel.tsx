import Link from "next/link";
import { ArrowUpRight, Gauge, ServerCog } from "lucide-react";
import type { OwnerMetricsModel } from "@/lib/metrics/reader";
import { OWNER_RESOURCE_THRESHOLDS } from "@/lib/metrics/status-page";
import type { CheckStatus, ServiceCheck } from "@/lib/metrics/types";
import { PostureBadge } from "@/components/ui/PostureBadge";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { MetricsSparkline } from "./MetricsSparkline";

function percentage(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0;
}

function bytes(value: number): string {
  return new Intl.NumberFormat("en", {
    style: "unit",
    unit: "gigabyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value / 1024 ** 3);
}

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [days ? `${days}d` : null, hours ? `${hours}h` : null, `${minutes}m`]
    .filter(Boolean)
    .join(" ");
}

function health(status: CheckStatus) {
  if (status === "up") return "healthy" as const;
  if (status === "down") return "disruption" as const;
  return "unavailable" as const;
}

function ServiceGroup({ title, services }: { title: string; services: ServiceCheck[] }) {
  return (
    <section>
      <h3 className="font-mono text-xs uppercase text-[var(--text-subtle)]">{title}</h3>
      <div className="mt-3 border-y border-[var(--border)]">
        {services.length ? services.map((service) => (
          <div key={service.id} className="flex flex-col gap-3 border-t border-[var(--border)] py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">{service.label}</p>
              <p className="mt-1 text-xs text-[var(--text-subtle)]">Checked <RelativeTime value={service.checked_at} />{service.latency_ms !== null ? ` / ${service.latency_ms} ms` : ""}</p>
            </div>
            <PostureBadge dimension="health" value={health(service.status)} />
          </div>
        )) : <p className="py-4 text-sm text-[var(--text-muted)]">None configured.</p>}
      </div>
    </section>
  );
}

export function OwnerMetricsPanel({ metrics }: { metrics: OwnerMetricsModel | null }) {
  if (!metrics?.latest) {
    return (
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <h2 className="text-2xl font-semibold text-[var(--text)]">Owner telemetry</h2>
        <p className="mt-3 text-sm text-[var(--text-muted)]">Exact metrics are unavailable. Review owner diagnostics and the operations runbook.</p>
      </section>
    );
  }

  const latest = metrics.latest;
  const ramPercent = percentage(latest.host.ram_used_bytes, latest.host.ram_total_bytes);
  const diskPercent = percentage(latest.host.disk_used_bytes, latest.host.disk_total_bytes);
  const publicServices = latest.services.filter((service) => service.visibility === "public");
  const ownerServices = latest.services.filter((service) => service.visibility === "owner");

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16">
      <section aria-labelledby="owner-resources-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-sm text-[var(--role-info)]">OWNER ONLY</p>
            <h2 id="owner-resources-heading" className="mt-2 text-3xl font-semibold text-[var(--text)]">Host resources</h2>
          </div>
          <p className="text-sm text-[var(--text-muted)]">Collected <RelativeTime value={latest.collected_at} /></p>
        </div>

        <dl className="mt-7 grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
          <ResourceValue label="CPU" value={`${latest.host.cpu_percent}%`} detail={`Warning ${OWNER_RESOURCE_THRESHOLDS.cpu.warning}%`} />
          <ResourceValue label="RAM" value={`${Math.round(ramPercent * 10) / 10}%`} detail={`${bytes(latest.host.ram_used_bytes)} / ${bytes(latest.host.ram_total_bytes)}`} />
          <ResourceValue label="Disk" value={`${Math.round(diskPercent * 10) / 10}%`} detail={`${bytes(latest.host.disk_used_bytes)} / ${bytes(latest.host.disk_total_bytes)}`} />
          <ResourceValue label="Uptime" value={uptime(latest.host.uptime_seconds)} detail={`Load ${latest.host.load_1m} / ${latest.host.load_5m} / ${latest.host.load_15m}`} />
        </dl>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <MetricsSparkline label="CPU" values={metrics.history.map((sample) => sample.host.cpu_percent)} warningAt={OWNER_RESOURCE_THRESHOLDS.cpu.warning} criticalAt={OWNER_RESOURCE_THRESHOLDS.cpu.critical} />
          <MetricsSparkline label="RAM" values={metrics.history.map((sample) => percentage(sample.host.ram_used_bytes, sample.host.ram_total_bytes))} warningAt={OWNER_RESOURCE_THRESHOLDS.ram.warning} criticalAt={OWNER_RESOURCE_THRESHOLDS.ram.critical} />
          <MetricsSparkline label="Disk" values={metrics.history.map((sample) => percentage(sample.host.disk_used_bytes, sample.host.disk_total_bytes))} warningAt={OWNER_RESOURCE_THRESHOLDS.disk.warning} criticalAt={OWNER_RESOURCE_THRESHOLDS.disk.critical} />
        </div>
      </section>

      <div id="owner-services" className="mt-14 grid gap-10 lg:grid-cols-2">
        <ServiceGroup title="Public services" services={publicServices} />
        <ServiceGroup title="Internal services" services={ownerServices} />
      </div>

      <section id="owner-containers" className="mt-12">
        <h3 className="font-mono text-xs uppercase text-[var(--text-subtle)]">Allowlisted containers</h3>
        <div className="mt-3 border-y border-[var(--border)]">
          {latest.containers.length ? latest.containers.map((container) => (
            <div key={container.id} className="flex items-center justify-between gap-4 border-t border-[var(--border)] py-4 first:border-t-0">
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{container.label}</p>
                <p className="mt-1 text-xs text-[var(--text-subtle)]">Checked <RelativeTime value={container.checked_at} /></p>
              </div>
              <PostureBadge dimension="health" value={health(container.status)} />
            </div>
          )) : <p className="py-4 text-sm text-[var(--text-muted)]">No containers are allowlisted.</p>}
        </div>
      </section>

      {metrics.diagnostics.length ? (
        <details className="mt-12 border-y border-[var(--border)] py-4">
          <summary className="min-h-11 cursor-pointer text-sm font-semibold text-[var(--text)]">Collector diagnostics ({metrics.diagnostics.length})</summary>
          <ul className="mt-3 space-y-2 font-mono text-xs text-[var(--text-muted)]">
            {metrics.diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}
          </ul>
        </details>
      ) : null}

      <section className="mt-12 border-t border-[var(--border)] pt-8">
        <h3 className="text-lg font-semibold text-[var(--text)]">Owner destinations</h3>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/admin" className="secondary-command"><Gauge className="h-4 w-4" aria-hidden="true" />Content workspace</Link>
          <Link href="/ansible" className="secondary-command"><ServerCog className="h-4 w-4" aria-hidden="true" />Operations runbook</Link>
          <a href="/proposals" className="secondary-command">Proposals <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>
        </div>
      </section>
    </div>
  );
}

function ResourceValue({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-[var(--surface-raised)] p-5">
      <dt className="text-xs text-[var(--text-subtle)]">{label}</dt>
      <dd className="mt-2 font-mono text-2xl text-[var(--text)]">{value}</dd>
      <dd className="mt-2 text-xs text-[var(--text-muted)]">{detail}</dd>
    </div>
  );
}
