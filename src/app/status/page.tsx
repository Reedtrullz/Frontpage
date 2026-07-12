import type { Metadata } from "next";
import { auth } from "@/auth";
import { CoarseHistoryStrip } from "@/components/dashboard/CoarseHistoryStrip";
import { OwnerAttentionSummary } from "@/components/dashboard/OwnerAttentionSummary";
import { OwnerMetricsPanel } from "@/components/dashboard/OwnerMetricsPanel";
import { OwnerObservabilityPanel } from "@/components/dashboard/observability/OwnerObservabilityPanel";
import { StatusInventory } from "@/components/dashboard/StatusInventory";
import { VpsStatusSummary } from "@/components/dashboard/VpsStatusSummary";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { isOwnerUser } from "@/lib/authz";
import { getMetricsDir, readMetricsFromDir } from "@/lib/metrics/reader";
import { createStatusPageModel } from "@/lib/metrics/status-page";
import {
  getOwnerMetricsRootV2,
  getPublicMetricsRootV2,
  readOwnerLatestV2,
  readPublicLatestV2,
  readSeriesV2,
} from "@/lib/metrics/v2/reader";

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
  const publicStatusLabel = publicV2State
    ? {
        operational: "Operational",
        degraded: "Degraded",
        disruption: "Service disruption",
        maintenance: "Maintenance",
        unknown: "Status unavailable",
        delayed: "Status delayed",
      }[publicV2State]
    : model.overall.label;
  const publicUpdatedAt =
    publicV2.data?.collected_at ?? model.public.host.lastUpdatedAt;
  const ownerAttentionItems = ownerObservability
    ? (model.ownerAttention ?? []).filter(
        (item) =>
          !item.id.startsWith("metrics-") &&
          !item.id.startsWith("cpu-") &&
          !item.id.startsWith("ram-") &&
          !item.id.startsWith("disk-"),
      )
    : model.ownerAttention;

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

      <VpsStatusSummary metrics={model.public} overall={model.overall} />

      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-12 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="lg:order-2">
          <StatusInventory metrics={model.public} />
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
