import type { PublicMetricsModel } from "@/lib/metrics/reader";
import { StatusToken } from "./StatusToken";

export function VpsStatusSummary({ metrics }: { metrics: PublicMetricsModel }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-mono text-sm text-green-400">VPS</h2>
        <StatusToken value={metrics.freshness} />
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="font-mono text-xs text-zinc-600">state</dt>
          <dd className="text-zinc-200">{metrics.host.state}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs text-zinc-600">disk</dt>
          <dd className="text-zinc-200">{metrics.host.diskPressure}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs text-zinc-600">services</dt>
          <dd className="text-zinc-200">
            {metrics.host.serviceSummary.up}/{metrics.host.serviceSummary.total}{" "}
            up
          </dd>
        </div>
        <div>
          <dt className="font-mono text-xs text-zinc-600">updated</dt>
          <dd className="text-zinc-200">{metrics.host.lastUpdatedLabel}</dd>
        </div>
      </dl>
    </section>
  );
}
