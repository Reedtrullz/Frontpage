import type { Metadata } from "next";
import { auth } from "@/auth";
import { CoarseHistoryStrip } from "@/components/dashboard/CoarseHistoryStrip";
import { PublicIncidentHistory } from "@/components/dashboard/PublicIncidentHistory";
import { OwnerAttentionSummary } from "@/components/dashboard/OwnerAttentionSummary";
import { OwnerMetricsPanel } from "@/components/dashboard/OwnerMetricsPanel";
import { OwnerObservabilityPanel } from "@/components/dashboard/observability/OwnerObservabilityPanel";
import { StatusInventory } from "@/components/dashboard/StatusInventory";
import { VpsStatusSummary } from "@/components/dashboard/VpsStatusSummary";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { isOwnerUser } from "@/lib/authz";
import { getCanonicalMaintenance } from "@/lib/content";
import { getMetricsDir, readMetricsFromDir } from "@/lib/metrics/reader";
import { createStatusPageModel } from "@/lib/metrics/status-page";
import {
  getOwnerMetricsRootV2,
  getPublicMetricsRootV2,
  readOwnerLatestV2,
  readPublicIncidentsV2,
  readPublicLatestV2,
  readSeriesV2,
} from "@/lib/metrics/v2/reader";
import { createPublicStatusV2 } from "@/lib/metrics/v2/public-status";
import { fetchMiningV2 } from "@/lib/metrics/v2/mining";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "System status",
  description: "Public-safe service health and coarse VPS pressure history for reidar.tech.",
};

export default async function StatusPage() {
  const session = await auth();
  const isOwner = isOwnerUser(session?.user);
  const readResult = readMetricsFromDir(getMetricsDir());
  const model = createStatusPageModel({
    readResult,
    isOwner,
  });
  const publicV2 = readPublicLatestV2(getPublicMetricsRootV2());
  const publicIncidentsV2 = readPublicIncidentsV2(getPublicMetricsRootV2());
  const publicStatusV2 =
    publicV2.data && publicIncidentsV2.data
      ? createPublicStatusV2({
          latest: publicV2.data,
          incidents: publicIncidentsV2.data,
          maintenance: getCanonicalMaintenance(),
        })
      : null;
  const ownerV2Enabled =
    isOwner && process.env.FRONTPAGE_OBSERVABILITY_V2 === "1";
  const ownerLatestV2 = ownerV2Enabled
    ? readOwnerLatestV2(getOwnerMetricsRootV2())
    : null;
  let ownerHostSeriesV2 = null;
  if (ownerV2Enabled) {
    try {
      ownerHostSeriesV2 = readSeriesV2(getOwnerMetricsRootV2(), {
        range: "1h",
        view: "host",
        resource: null,
      });
    } catch {
      ownerHostSeriesV2 = null;
    }
  }
  const ownerObservability =
    ownerLatestV2?.data && ownerHostSeriesV2
      ? { latest: ownerLatestV2.data, series: ownerHostSeriesV2 }
      : null;
  const publicV2State = publicV2.data
    ? publicV2.data.freshness === "fresh"
      ? publicV2.data.overall_state
      : publicV2.data.freshness === "stale"
        ? "delayed"
        : "unknown"
    : null;
  const publicStatusLabel = publicStatusV2?.label ?? (publicV2State
    ? {
        operational: "Operational",
        degraded: "Degraded",
        disruption: "Service disruption",
        maintenance: "Maintenance",
        unknown: "Status unavailable",
        delayed: "Status delayed",
      }[publicV2State]
    : model.overall.label);
  const publicUpdatedAt =
    publicV2.data?.collected_at ?? model.public.host.lastUpdatedAt;
  const publicDisplayMetrics = publicStatusV2
    ? {
        ...model.public,
        freshness: publicStatusV2.freshness,
        host: {
          ...model.public.host,
          state:
            publicStatusV2.freshness === "fresh"
              ? model.public.host.state
              : publicStatusV2.freshness === "stale"
                ? ("stale" as const)
                : ("unknown" as const),
          lastUpdatedAt: publicStatusV2.collectedAt,
          serviceSummary: {
            total: publicStatusV2.services.length,
            up: publicStatusV2.services.filter((service) => service.status === "up").length,
            down: publicStatusV2.services.filter((service) => service.status === "down").length,
            unknown: publicStatusV2.services.filter(
              (service) => !["up", "down"].includes(service.status),
            ).length,
          },
        },
        lastKnownServiceCount: publicStatusV2.services.length,
      }
    : model.public;
  const publicDisplayOverall = publicStatusV2
    ? {
        kind:
          publicStatusV2.label === "Status delayed"
            ? ("delayed" as const)
            : publicStatusV2.overallState === "unknown"
              ? ("unavailable" as const)
              : publicStatusV2.overallState === "maintenance"
                ? ("degraded" as const)
                : publicStatusV2.overallState,
        label: publicStatusV2.label,
        description:
          publicStatusV2.label === "Status delayed"
            ? "The latest sample is stale and is shown as last-known state."
            : publicStatusV2.overallState === "maintenance"
              ? "Expected impact is covered by a published maintenance window."
              : publicStatusV2.overallState === "disruption"
                ? "A public service check is reporting an unexpected disruption."
                : publicStatusV2.overallState === "degraded"
                  ? "A public service check has unknown current state."
                  : publicStatusV2.overallState === "operational"
                    ? "All configured public service checks report up."
                    : "Current telemetry is unavailable, so no healthy state is assumed.",
      }
    : model.overall;
  const ownerAttentionItems = ownerObservability
    ? (model.ownerAttention ?? []).filter(
        (item) =>
          !item.id.startsWith("metrics-") &&
          !item.id.startsWith("cpu-") &&
          !item.id.startsWith("ram-") &&
          !item.id.startsWith("disk-"),
      )
    : model.ownerAttention;

  const miningData = await fetchMiningV2();

function formatHashrate(h: number): string {
  // ponytail: simple H/s formatting, add more granularity if needed
  if (h >= 1e12) return `${(h / 1e12).toFixed(2)} TH/s`;
  if (h >= 1e9) return `${(h / 1e9).toFixed(2)} GH/s`;
  if (h >= 1e6) return `${(h / 1e6).toFixed(2)} MH/s`;
  if (h >= 1e3) return `${(h / 1e3).toFixed(2)} KH/s`;
  return `${h.toFixed(0)} H/s`;
}

function formatDuration(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

  return (
    <div>
      <header className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <p className="font-mono text-sm text-[var(--accent)]">REIDAR.TECH / STATUS</p>
        <h1 className="mt-3 text-4xl font-semibold text-[var(--text)] sm:text-5xl">System status</h1>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="font-semibold text-[var(--text)]">{publicStatusLabel}</span>
          {publicUpdatedAt ? (
            <span className="text-[var(--text-muted)]">Updated <RelativeTime value={publicUpdatedAt} /></span>
          ) : (
            <span className="text-[var(--text-muted)]">No current sample</span>
          )}
        </div>
        <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--text-muted)]">
          Public status shows service health without exposing private host details.
        </p>
      </header>

      <VpsStatusSummary metrics={publicDisplayMetrics} overall={publicDisplayOverall} />

      <section className="border-y border-[var(--border)] bg-[var(--surface-raised)]" aria-labelledby="mining-heading">
        <div className="mx-auto grid max-w-7xl gap-0 px-4 sm:px-6 lg:grid-cols-[1.4fr_repeat(3,0.7fr)]">
          <div className="flex gap-3 py-6 lg:pr-8">
            <div className={miningData.data && miningData.data.hashrate > 0 ? "mt-1 h-2 w-2 shrink-0 rounded-full bg-green-500" : "mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--text-muted)]"} aria-hidden="true" />
            <div>
              <h2 id="mining-heading" className="text-base font-semibold">
                {miningData.data && miningData.data.hashrate > 0 ? "Mining PEARL" : "Miner offline"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                {miningData.data && miningData.data.hashrate > 0
                  ? `Desktop miner on LuckyPool${miningData.data.worker_name ? ` (${miningData.data.worker_name})` : ""}`
                  : miningData.data && miningData.age !== null && miningData.age < 600_000
                    ? `No recent shares — miner may be starting up`
                    : miningData.data
                      ? `No known miner activity`
                      : `Mining stats not available`}
              </p>
            </div>
          </div>
          <div className="border-t border-[var(--border)] py-5 lg:border-l lg:border-t-0 lg:px-6">
            <p className="text-xs text-[var(--text-subtle)]">Hashrate</p>
            <p className="mt-1 text-sm font-semibold text-[var(--text)]">
              {miningData.data ? formatHashrate(miningData.data.hashrate) : "—"}
            </p>
            {miningData.data && miningData.data.hashrate_avg_1h > 0 ? (
              <span className="mt-1 block text-xs text-[var(--text-subtle)]">
                1h avg {formatHashrate(miningData.data.hashrate_avg_1h)}
              </span>
            ) : null}
          </div>
          <div className="border-t border-[var(--border)] py-5 lg:border-l lg:border-t-0 lg:px-6">
            <p className="text-xs text-[var(--text-subtle)]">Uptime</p>
            <p className="mt-1 text-sm font-semibold text-[var(--text)]">
              {miningData.data?.uptime_seconds ? formatDuration(miningData.data.uptime_seconds) : "—"}
            </p>
            <span className="mt-1 block text-xs text-[var(--text-subtle)]">
              {miningData.data ? `${(miningData.data.accepted_shares / 1000).toFixed(1)}k shares` : ""}
            </span>
          </div>
          <div className="border-t border-[var(--border)] py-5 lg:border-l lg:border-t-0 lg:px-6">
            <p className="text-xs text-[var(--text-subtle)]">Last share</p>
            <p className="mt-1 text-sm font-semibold text-[var(--text)]">
              {miningData.data?.last_share_at_ms && miningData.data.last_share_at_ms > 0
                ? <RelativeTime value={new Date(miningData.data.last_share_at_ms).toISOString()} />
                : "—"}
            </p>
            {miningData.data ? (
              <span className="mt-1 block text-xs text-[var(--text-subtle)]">
                <RelativeTime value={miningData.data.collected_at} />
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-12 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="lg:order-2">
          <StatusInventory metrics={publicDisplayMetrics} publicV2={publicStatusV2} />
        </div>
        <section aria-labelledby="history-heading" className="lg:order-1">
          <p className="font-mono text-sm text-[var(--accent)]">24-HOUR WINDOW</p>
          <h2 id="history-heading" className="mt-2 text-2xl font-semibold text-[var(--text)]">Coarse pressure history</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Buckets show pressure bands only. Exact host values remain owner-only.</p>
          <div className="mt-6 border-y border-[var(--border)]">
            <CoarseHistoryStrip
              label="CPU pressure"
              values={model.public.history.map((sample) => sample.cpu)}
              history={model.public.history.map(({ collectedAt, cpu, gapBefore }) => ({
                collectedAt,
                value: cpu,
                gapBefore,
              }))}
              coverage={model.public.historyCoverage}
              legend={[
                { value: "low", label: "Low", tone: "positive" },
                { value: "medium", label: "Medium", tone: "information" },
                { value: "high", label: "High", tone: "warning" },
                { value: "unknown", label: "Unknown", tone: "unknown" },
              ]}
            />
            <CoarseHistoryStrip
              label="RAM pressure"
              values={model.public.history.map((sample) => sample.ram)}
              history={model.public.history.map(({ collectedAt, ram, gapBefore }) => ({
                collectedAt,
                value: ram,
                gapBefore,
              }))}
              coverage={model.public.historyCoverage}
              legend={[
                { value: "low", label: "Low", tone: "positive" },
                { value: "medium", label: "Medium", tone: "information" },
                { value: "high", label: "High", tone: "warning" },
                { value: "unknown", label: "Unknown", tone: "unknown" },
              ]}
            />
            <CoarseHistoryStrip
              label="Disk pressure"
              values={model.public.history.map((sample) => sample.disk)}
              history={model.public.history.map(({ collectedAt, disk, gapBefore }) => ({
                collectedAt,
                value: disk,
                gapBefore,
              }))}
              coverage={model.public.historyCoverage}
              legend={[
                { value: "ok", label: "OK", tone: "positive" },
                { value: "watch", label: "Watch", tone: "warning" },
                { value: "critical", label: "Critical", tone: "failure" },
                { value: "unknown", label: "Unknown", tone: "unknown" },
              ]}
            />
          </div>
        </section>
      </div>

      {publicStatusV2 ? <PublicIncidentHistory model={publicStatusV2} /> : null}

      {ownerAttentionItems ? (
        <>
          <div
            className="border-t border-[var(--border)] pt-14"
            data-observability-v2={
              ownerV2Enabled && ownerObservability
                ? "available"
                : "fallback"
            }
          >
            <div className="mx-auto max-w-7xl px-4 pb-6 sm:px-6">
              <p className="font-mono text-sm text-[var(--role-info)]">PRIVATE OPERATOR VIEW</p>
              <h2 className="mt-2 text-3xl font-semibold text-[var(--text)]">Owner status</h2>
            </div>
          </div>
          <OwnerAttentionSummary items={ownerAttentionItems} observability={ownerObservability} />
          {ownerObservability ? (
            <OwnerObservabilityPanel
              diskCapacity={
                model.owner?.latest
                  ? {
                      usedBytes: model.owner.latest.host.disk_used_bytes,
                      totalBytes: model.owner.latest.host.disk_total_bytes,
                      freshness: model.owner.freshness,
                    }
                  : undefined
              }
              initial={ownerObservability}
            />
          ) : null}
          <OwnerMetricsPanel metrics={model.owner} showResourceOverview={!ownerObservability} />
        </>
      ) : null}
    </div>
  );
}
