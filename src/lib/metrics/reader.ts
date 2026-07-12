import fs from "node:fs";
import path from "node:path";
import {
  MetricsValidationError,
  parseMetricsHistory,
  parseMetricsSnapshot,
} from "./schema";
import {
  FRESH_MS,
  UNAVAILABLE_MS,
  type CheckStatus,
  type DiskPressure,
  type HistoryAvailability,
  type HistoryCoverage,
  type MetricsFreshness,
  type MetricsSnapshot,
  type PublicMetricBucket,
  type PublicServiceTrend,
  type PublicVpsState,
} from "./types";

const HISTORY_WINDOW_MS = 24 * 60 * 60_000;
const HISTORY_GAP_THRESHOLD_MS = 120_000;
const HISTORY_METADATA = Symbol("historyMetadata");

interface NormalizedHistoryMetadata {
  coverage: HistoryCoverage;
  gapBefore: boolean[];
}

type NormalizedHistory = MetricsSnapshot[] & {
  [HISTORY_METADATA]?: NormalizedHistoryMetadata;
};

export interface MetricsReadResult {
  freshness: MetricsFreshness;
  latest: MetricsSnapshot | null;
  history: MetricsSnapshot[];
  historyAvailability: HistoryAvailability;
  diagnostics: string[];
}

type MetricsReadInput = Omit<MetricsReadResult, "historyAvailability"> & {
  historyAvailability?: HistoryAvailability;
};

export interface PublicServiceStatus {
  id: string;
  label: string;
  projectSlug?: string;
  status: CheckStatus;
  latencyMs: number | null;
  checkedAt: string;
}

export interface PublicMetricsModel {
  freshness: MetricsFreshness;
  host: {
    state: PublicVpsState;
    diskPressure: DiskPressure;
    lastUpdatedAt: string | null;
    lastUpdatedLabel: string;
    serviceSummary: {
      total: number;
      up: number;
      down: number;
      unknown: number;
    };
  };
  services: PublicServiceStatus[];
  projectHealthBySlug: Record<string, PublicServiceStatus>;
  history: Array<{
    collectedAt: string;
    cpu: PublicMetricBucket;
    ram: PublicMetricBucket;
    disk: DiskPressure;
    gapBefore: boolean;
  }>;
  historyCoverage: HistoryCoverage;
  serviceTrends: Record<string, PublicServiceTrend>;
}

export interface OwnerMetricsModel {
  freshness: MetricsFreshness;
  latest: MetricsSnapshot | null;
  history: MetricsSnapshot[];
  historyGapBefore: boolean[];
  historyCoverage: HistoryCoverage;
  diagnostics: string[];
}

export function getMetricsDir(): string | undefined {
  return process.env.METRICS_DIR;
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function diagnosticFor(filename: string, error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    return `${filename} is missing.`;
  }
  if (error instanceof SyntaxError) {
    return `${filename} contains invalid JSON.`;
  }
  if (error instanceof MetricsValidationError) {
    return `${filename} failed schema validation.`;
  }
  return `${filename} could not be read.`;
}

function ageMs(snapshot: MetricsSnapshot, now: Date): number {
  return now.getTime() - new Date(snapshot.collected_at).getTime();
}

function isFutureSnapshot(snapshot: MetricsSnapshot, now: Date): boolean {
  return Date.parse(snapshot.collected_at) > now.getTime();
}

function latestAtOrBefore(
  latest: MetricsSnapshot | null,
  now: Date,
): MetricsSnapshot | null {
  return latest && !isFutureSnapshot(latest, now) ? latest : null;
}

function freshnessFor(
  snapshot: MetricsSnapshot | null,
  now: Date,
): MetricsFreshness {
  if (!snapshot) return "unavailable";
  const age = ageMs(snapshot, now);
  if (age < 0) return "unavailable";
  if (age <= FRESH_MS) return "fresh";
  if (age <= UNAVAILABLE_MS) return "stale";
  return "unavailable";
}

function normalizedHistory(
  samples: MetricsSnapshot[],
  latest: MetricsSnapshot | null,
  sourceAvailability: HistoryAvailability,
  now: Date,
): NormalizedHistory {
  const windowEndMs = now.getTime();
  const windowStartMs = windowEndMs - HISTORY_WINDOW_MS;
  const byTimestamp = new Map<
    string,
    { snapshot: MetricsSnapshot; timestampMs: number; reconciled: boolean }
  >();
  let hasFutureSample = false;

  for (const sample of samples) {
    const timestampMs = Date.parse(sample.collected_at);
    if (timestampMs > windowEndMs) {
      hasFutureSample = true;
      continue;
    }
    if (timestampMs < windowStartMs) continue;
    byTimestamp.set(sample.collected_at, {
      snapshot: sample,
      timestampMs,
      reconciled: false,
    });
  }

  const inWindowHistoryCount = byTimestamp.size;
  if (latest) {
    const timestampMs = Date.parse(latest.collected_at);
    if (
      timestampMs >= windowStartMs &&
      timestampMs <= windowEndMs &&
      !byTimestamp.has(latest.collected_at)
    ) {
      byTimestamp.set(latest.collected_at, {
        snapshot: latest,
        timestampMs,
        reconciled: true,
      });
    }
  }

  const entries = [...byTimestamp.values()].sort(
    (left, right) => left.timestampMs - right.timestampMs,
  );
  const history = entries.map((entry) => entry.snapshot) as NormalizedHistory;
  const gapBefore = entries.map((entry, index) => {
    if (entry.reconciled) return true;
    if (index === 0) return false;
    return entry.timestampMs - entries[index - 1].timestampMs > HISTORY_GAP_THRESHOLD_MS;
  });
  const leadingGap =
    entries.length > 0 &&
    entries[0]!.timestampMs - windowStartMs > HISTORY_GAP_THRESHOLD_MS;
  const trailingGap =
    entries.length > 0 &&
    windowEndMs - entries.at(-1)!.timestampMs > HISTORY_GAP_THRESHOLD_MS;
  const availability =
    sourceAvailability === "unavailable"
      ? "unavailable"
      : inWindowHistoryCount > 0
        ? "available"
        : hasFutureSample
          ? "unavailable"
          : "empty";
  const coverage: HistoryCoverage = {
    availability,
    windowStartAt: new Date(windowStartMs).toISOString(),
    windowEndAt: now.toISOString(),
    sampleCount: history.length,
    gapCount:
      gapBefore.filter(Boolean).length +
      (leadingGap ? 1 : 0) +
      (trailingGap ? 1 : 0),
    leadingGap,
    trailingGap,
  };

  Object.defineProperty(history, HISTORY_METADATA, {
    value: { coverage, gapBefore },
    enumerable: false,
  });
  return history;
}

function normalizedHistoryFor(
  result: MetricsReadInput,
  now: Date = new Date(),
): { history: NormalizedHistory; metadata: NormalizedHistoryMetadata } {
  const metadata = (result.history as NormalizedHistory)[HISTORY_METADATA];
  if (metadata) {
    return { history: result.history as NormalizedHistory, metadata };
  }
  const sourceAvailability =
    result.historyAvailability ??
    (result.diagnostics.some(
      (diagnostic) =>
        diagnostic.startsWith("history.json") ||
        diagnostic.startsWith("METRICS_DIR"),
    )
      ? "unavailable"
      : result.history.length > 0
        ? "available"
        : "empty");
  const history = normalizedHistory(
    result.history,
    result.latest,
    sourceAvailability,
    now,
  );
  return { history, metadata: history[HISTORY_METADATA]! };
}

export function readMetricsFromDir(
  metricsDir: string | undefined,
  now: Date = new Date(),
): MetricsReadResult {
  const diagnostics: string[] = [];
  if (!metricsDir) {
    const history = normalizedHistory([], null, "unavailable", now);
    return {
      freshness: "unavailable",
      latest: null,
      history,
      historyAvailability: "unavailable",
      diagnostics: ["METRICS_DIR is not configured."],
    };
  }

  let latest: MetricsSnapshot | null = null;
  try {
    latest = parseMetricsSnapshot(
      readJsonFile(path.join(metricsDir, "latest.json")),
    );
    if (latest && isFutureSnapshot(latest, now)) {
      latest = null;
      diagnostics.push("latest.json is dated in the future.");
    }
  } catch (error) {
    diagnostics.push(diagnosticFor("latest.json", error));
  }

  let historySamples: MetricsSnapshot[] = [];
  let historyAvailability: HistoryAvailability = "unavailable";
  try {
    historySamples = parseMetricsHistory(
      readJsonFile(path.join(metricsDir, "history.json")),
    ).samples;
    historyAvailability = "empty";
  } catch (error) {
    diagnostics.push(diagnosticFor("history.json", error));
  }

  const history = normalizedHistory(
    historySamples,
    latest,
    historyAvailability,
    now,
  );
  historyAvailability = history[HISTORY_METADATA]!.coverage.availability;

  return {
    freshness: freshnessFor(latest, now),
    latest,
    history,
    historyAvailability,
    diagnostics,
  };
}

function percent(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
}

function diskPressureFromPercent(diskPercent: number): DiskPressure {
  if (diskPercent >= 90) return "critical";
  if (diskPercent >= 75) return "watch";
  return "ok";
}

function diskPressure(snapshot: MetricsSnapshot | null): DiskPressure {
  if (!snapshot) return "unknown";
  return diskPressureFromPercent(
    percent(snapshot.host.disk_used_bytes, snapshot.host.disk_total_bytes),
  );
}

function usageBucket(percentValue: number): PublicMetricBucket {
  if (!Number.isFinite(percentValue)) return "unknown";
  if (percentValue >= 85) return "high";
  if (percentValue >= 60) return "medium";
  return "low";
}

function publicState(
  freshness: MetricsFreshness,
  snapshot: MetricsSnapshot | null,
): PublicVpsState {
  if (freshness === "unavailable" || !snapshot) return "unknown";
  if (freshness === "stale") return "stale";
  return diskPressure(snapshot) === "critical" ? "pressure" : "online";
}

function ageLabel(snapshot: MetricsSnapshot | null, now: Date): string {
  if (!snapshot) return "unknown";
  const seconds = Math.max(0, Math.round(ageMs(snapshot, now) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function publicServices(
  snapshot: MetricsSnapshot | null,
  freshness: MetricsFreshness,
): PublicServiceStatus[] {
  if (!snapshot) return [];
  return snapshot.services
    .filter((service) => service.visibility === "public")
    .map((service) => ({
      id: service.id,
      label: service.label,
      projectSlug: service.project_slug,
      status: freshness === "fresh" ? service.status : "unknown",
      latencyMs: service.latency_ms,
      checkedAt: service.checked_at,
    }));
}

export function getProjectHealthBySlug(
  services: PublicServiceStatus[],
): Record<string, PublicServiceStatus> {
  const bySlug: Record<string, PublicServiceStatus> = {};
  for (const service of services) {
    if (service.projectSlug && !bySlug[service.projectSlug]) {
      bySlug[service.projectSlug] = service;
    }
  }
  return bySlug;
}

function roundedPercent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function nearestRankP95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function publicServiceTrends(
  history: MetricsSnapshot[],
): Record<string, PublicServiceTrend> {
  const trends = new Map<
    string,
    {
      knownChecks: number;
      observedChecks: number;
      upChecks: number;
      latencies: number[];
      lastStatus: CheckStatus | null;
      lastTransitionAt: string | null;
    }
  >();

  for (const sample of history) {
    for (const service of sample.services) {
      if (service.visibility !== "public") continue;
      const trend = trends.get(service.id) ?? {
        knownChecks: 0,
        observedChecks: 0,
        upChecks: 0,
        latencies: [],
        lastStatus: null,
        lastTransitionAt: null,
      };
      trend.observedChecks += 1;
      if (service.status !== "unknown") {
        trend.knownChecks += 1;
        if (service.status === "up") trend.upChecks += 1;
      }
      if (service.latency_ms !== null) trend.latencies.push(service.latency_ms);
      if (trend.lastStatus !== null && trend.lastStatus !== service.status) {
        trend.lastTransitionAt = service.checked_at;
      }
      trend.lastStatus = service.status;
      trends.set(service.id, trend);
    }
  }

  return Object.fromEntries(
    [...trends.entries()].map(([id, trend]) => [
      id,
      {
        knownChecks: trend.knownChecks,
        totalSamples: history.length,
        availabilityPercent: roundedPercent(
          trend.upChecks,
          trend.knownChecks,
        ),
        coveragePercent: roundedPercent(
          trend.observedChecks,
          history.length,
        ),
        p95LatencyMs: nearestRankP95(trend.latencies),
        lastTransitionAt: trend.lastTransitionAt,
      },
    ]),
  );
}

export function derivePublicMetrics(
  result: MetricsReadInput,
  now: Date = new Date(),
): PublicMetricsModel {
  const latest = latestAtOrBefore(result.latest, now);
  const freshness = result.latest && !latest ? "unavailable" : result.freshness;
  const services = publicServices(latest, freshness);
  const { history, metadata: historyMetadata } = normalizedHistoryFor(
    result,
    now,
  );
  const serviceSummary = services.reduce(
    (summary, service) => {
      summary.total += 1;
      summary[service.status] += 1;
      return summary;
    },
    { total: 0, up: 0, down: 0, unknown: 0 },
  );

  return {
    freshness,
    host: {
      state: publicState(freshness, latest),
      diskPressure: diskPressure(latest),
      lastUpdatedAt: latest?.collected_at ?? null,
      lastUpdatedLabel: ageLabel(latest, now),
      serviceSummary,
    },
    services,
    projectHealthBySlug: getProjectHealthBySlug(services),
    history: history.map((sample, index) => ({
      collectedAt: sample.collected_at,
      cpu: usageBucket(sample.host.cpu_percent),
      ram: usageBucket(
        percent(sample.host.ram_used_bytes, sample.host.ram_total_bytes),
      ),
      disk: diskPressureFromPercent(
        percent(sample.host.disk_used_bytes, sample.host.disk_total_bytes),
      ),
      gapBefore: historyMetadata.gapBefore[index] ?? false,
    })),
    historyCoverage: historyMetadata.coverage,
    serviceTrends: publicServiceTrends(history),
  };
}

export function deriveOwnerMetrics(
  result: MetricsReadInput,
  now: Date = new Date(),
): OwnerMetricsModel {
  const { history, metadata } = normalizedHistoryFor(result, now);
  const latest = latestAtOrBefore(result.latest, now);
  const freshness = result.latest && !latest ? "unavailable" : result.freshness;
  const diagnostics = result.latest && !latest && !result.diagnostics.includes("latest.json is dated in the future.")
    ? [...result.diagnostics, "latest.json is dated in the future."]
    : result.diagnostics;
  return {
    freshness,
    latest,
    history,
    historyGapBefore: metadata.gapBefore,
    historyCoverage: metadata.coverage,
    diagnostics,
  };
}
