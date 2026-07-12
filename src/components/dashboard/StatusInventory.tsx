import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type {
  PublicServiceStatus,
} from "@/lib/metrics/reader";
import type { PublicStatusMetricsModel } from "@/lib/metrics/status-page";
import { PostureBadge } from "@/components/ui/PostureBadge";
import { RelativeTime } from "@/components/ui/RelativeTime";
import type { PublicStatusV2Model } from "@/lib/metrics/v2/public-status";

function healthValue(status: PublicServiceStatus["status"]) {
  if (status === "up") return "healthy" as const;
  if (status === "down") return "disruption" as const;
  return "unavailable" as const;
}

export function StatusInventory({
  metrics,
  publicV2,
}: {
  metrics: PublicStatusMetricsModel;
  publicV2?: PublicStatusV2Model | null;
}) {
  const freshness = publicV2?.freshness ?? metrics.freshness;
  const currentUnavailable = freshness === "unavailable";
  const services = publicV2
    ? publicV2.services.map((service) => ({
        ...service,
        projectSlug: metrics.services.find((candidate) => candidate.id === service.id)?.projectSlug,
      }))
    : metrics.services;
  const configuredCount = currentUnavailable
    ? metrics.lastKnownServiceCount
    : services.length;
  return (
    <section aria-labelledby="public-services-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-[var(--accent)]">PUBLIC CHECKS</p>
          <h2 id="public-services-heading" className="mt-2 text-2xl font-semibold text-[var(--text)]">Service inventory</h2>
        </div>
        <span className="text-sm text-[var(--text-muted)]">
          {currentUnavailable ? "Unavailable" : `${configuredCount} configured`}
        </span>
      </div>
      <div className="mt-6 border-y border-[var(--border)]">
        {currentUnavailable ? (
          <p className="py-6 text-sm text-[var(--text-muted)]">
            Current sample unavailable.
            {configuredCount !== null ? ` Last known: ${configuredCount} configured check${configuredCount === 1 ? "" : "s"}.` : " No current service state is available."}
          </p>
        ) : services.length === 0 ? (
          <p className="py-6 text-sm text-[var(--text-muted)]">No public checks configured.</p>
        ) : (
          services.map((service) => (
            <div key={service.id} className="grid gap-4 border-t border-[var(--border)] py-5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-[var(--text)]">{service.label}</h3>
                  {service.projectSlug ? (
                    <Link href={`/projects/${service.projectSlug}`} aria-label={`Open ${service.label} project`} className="inline-flex h-8 w-8 items-center justify-center text-[var(--text-subtle)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
                      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-[var(--text-subtle)]">
                  Checked <RelativeTime value={"checkedAt" in service ? service.checkedAt : service.checked_at} />
                  {("latencyMs" in service ? service.latencyMs : service.latency_ms) !== null ? freshness === "fresh" ? ` / ${"latencyMs" in service ? service.latencyMs : service.latency_ms} ms` : ` / Last known ${"latencyMs" in service ? service.latencyMs : service.latency_ms} ms` : ""}
                </p>
                <ServiceEvidence trend={metrics.serviceTrends[service.id]} />
              </div>
              <span className="text-xs text-[var(--text-subtle)]">Public</span>
              {service.status === "maintenance" ? (
                <span className="inline-flex min-h-8 items-center border border-[var(--role-info-border)] bg-[var(--role-info-soft)] px-2.5 text-xs font-semibold text-[var(--role-info)]">Maintenance</span>
              ) : (
                <PostureBadge
                  dimension="health"
                  value={healthValue(freshness === "fresh" ? service.status : "unknown")}
                />
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ServiceEvidence({
  trend,
}: {
  trend: PublicStatusMetricsModel["serviceTrends"][string] | undefined;
}) {
  if (!trend) return null;
  const reliability = trend.availabilityPercent !== null
    ? `${trend.availabilityPercent}% available across ${trend.knownChecks} known check${trend.knownChecks === 1 ? "" : "s"}`
    : null;
  const coverage = trend.coveragePercent !== null
    ? `Coverage ${trend.coveragePercent}%`
    : null;

  if (!reliability && !coverage && !trend.lastTransitionAt) return null;
  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
      {reliability ? <span>{reliability}</span> : null}
      {coverage ? <span>{coverage}</span> : null}
      {trend.lastTransitionAt ? <span>Last transition <RelativeTime value={trend.lastTransitionAt} /></span> : null}
    </p>
  );
}
