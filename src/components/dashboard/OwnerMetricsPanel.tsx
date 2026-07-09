import type { OwnerMetricsModel } from "@/lib/metrics/reader";
import { MetricsSparkline } from "./MetricsSparkline";
import { StatusToken } from "./StatusToken";

function pct(used: number, total: number): string {
  return `${Math.round((used / total) * 1000) / 10}%`;
}

export function OwnerMetricsPanel({
  metrics,
}: {
  metrics: OwnerMetricsModel | null;
}) {
  if (!metrics?.latest) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="font-mono text-sm text-green-400">Owner Metrics</h2>
        <p className="mt-4 text-sm text-zinc-500">
          Exact metrics are unavailable.
        </p>
      </section>
    );
  }

  const latest = metrics.latest;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-mono text-sm text-green-400">Owner Metrics</h2>
        <StatusToken value={metrics.freshness} />
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="font-mono text-xs text-zinc-600">CPU</dt>
          <dd className="text-zinc-100">{latest.host.cpu_percent}%</dd>
        </div>
        <div>
          <dt className="font-mono text-xs text-zinc-600">RAM</dt>
          <dd className="text-zinc-100">
            {pct(latest.host.ram_used_bytes, latest.host.ram_total_bytes)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-xs text-zinc-600">Disk</dt>
          <dd className="text-zinc-100">
            {pct(latest.host.disk_used_bytes, latest.host.disk_total_bytes)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-xs text-zinc-600">Load</dt>
          <dd className="text-zinc-100">
            {latest.host.load_1m} / {latest.host.load_5m} /{" "}
            {latest.host.load_15m}
          </dd>
        </div>
      </dl>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <MetricsSparkline
          label="CPU exact"
          values={metrics.history.map((sample) => sample.host.cpu_percent)}
        />
        <MetricsSparkline
          label="RAM exact"
          values={metrics.history.map(
            (sample) =>
              (sample.host.ram_used_bytes / sample.host.ram_total_bytes) * 100,
          )}
        />
        <MetricsSparkline
          label="Disk exact"
          values={metrics.history.map(
            (sample) =>
              (sample.host.disk_used_bytes / sample.host.disk_total_bytes) *
              100,
          )}
        />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-mono text-xs text-zinc-500">Services</h3>
          {latest.services.map((service) => (
            <div
              key={service.id}
              className="flex justify-between gap-3 border-t border-zinc-800 py-2 text-sm"
            >
              <span className="text-zinc-200">{service.label}</span>
              <StatusToken value={service.status} />
            </div>
          ))}
        </div>
        <div>
          <h3 className="mb-2 font-mono text-xs text-zinc-500">Containers</h3>
          {latest.containers.map((container) => (
            <div
              key={container.id}
              className="flex justify-between gap-3 border-t border-zinc-800 py-2 text-sm"
            >
              <span className="text-zinc-200">{container.label}</span>
              <StatusToken value={container.status} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
