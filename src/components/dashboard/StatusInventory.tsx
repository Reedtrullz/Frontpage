import type { PublicMetricsModel } from "@/lib/metrics/reader";
import { StatusToken } from "./StatusToken";

export function StatusInventory({ metrics }: { metrics: PublicMetricsModel }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <h2 className="mb-4 font-mono text-sm text-green-400">
        Public Services
      </h2>
      <div className="divide-y divide-zinc-800">
        {metrics.services.length === 0 ? (
          <p className="py-4 text-sm text-zinc-500">
            No public service checks are available.
          </p>
        ) : (
          metrics.services.map((service) => (
            <div
              key={service.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div>
                <div className="text-sm text-zinc-100">{service.label}</div>
                <div className="font-mono text-xs text-zinc-600">
                  {service.checkedAt}
                </div>
              </div>
              <StatusToken value={service.status} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
