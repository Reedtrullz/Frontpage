import fs from "node:fs";
import path from "node:path";
import { parseMetricsHistory, parseMetricsSnapshot } from "./schema";
import {
  FRESH_MS,
  UNAVAILABLE_MS,
  type CheckStatus,
  type DiskPressure,
  type MetricsFreshness,
  type MetricsSnapshot,
  type PublicMetricBucket,
  type PublicVpsState,
} from "./types";

export interface MetricsReadResult {
  freshness: MetricsFreshness;
  latest: MetricsSnapshot | null;
  history: MetricsSnapshot[];
  diagnostics: string[];
}

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
  }>;
}

export interface OwnerMetricsModel {
  freshness: MetricsFreshness;
  latest: MetricsSnapshot | null;
  history: MetricsSnapshot[];
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
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "ZodError"
  ) {
    return `${filename} failed schema validation.`;
  }
  return `${filename} could not be read.`;
}

function ageMs(snapshot: MetricsSnapshot, now: Date): number {
  return now.getTime() - new Date(snapshot.collected_at).getTime();
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

export function readMetricsFromDir(
  metricsDir: string | undefined,
  now: Date = new Date(),
): MetricsReadResult {
  const diagnostics: string[] = [];
  if (!metricsDir) {
    return {
      freshness: "unavailable",
      latest: null,
      history: [],
      diagnostics: ["METRICS_DIR is not configured."],
    };
  }

  let latest: MetricsSnapshot | null = null;
  try {
    latest = parseMetricsSnapshot(
      readJsonFile(path.join(metricsDir, "latest.json")),
    );
  } catch (error) {
    diagnostics.push(diagnosticFor("latest.json", error));
  }

  let history: MetricsSnapshot[] = [];
  try {
    history = parseMetricsHistory(
      readJsonFile(path.join(metricsDir, "history.json")),
    ).samples;
  } catch (error) {
    diagnostics.push(diagnosticFor("history.json", error));
  }

  return {
    freshness: freshnessFor(latest, now),
    latest,
    history,
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

function publicServices(snapshot: MetricsSnapshot | null): PublicServiceStatus[] {
  if (!snapshot) return [];
  return snapshot.services
    .filter((service) => service.visibility === "public")
    .map((service) => ({
      id: service.id,
      label: service.label,
      projectSlug: service.project_slug,
      status: service.status,
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

export function derivePublicMetrics(
  result: MetricsReadResult,
  now: Date = new Date(),
): PublicMetricsModel {
  const services = publicServices(result.latest);
  const serviceSummary = services.reduce(
    (summary, service) => {
      summary.total += 1;
      summary[service.status] += 1;
      return summary;
    },
    { total: 0, up: 0, down: 0, unknown: 0 },
  );

  return {
    freshness: result.freshness,
    host: {
      state: publicState(result.freshness, result.latest),
      diskPressure: diskPressure(result.latest),
      lastUpdatedAt: result.latest?.collected_at ?? null,
      lastUpdatedLabel: ageLabel(result.latest, now),
      serviceSummary,
    },
    services,
    projectHealthBySlug: getProjectHealthBySlug(services),
    history: result.history.map((sample) => ({
      collectedAt: sample.collected_at,
      cpu: usageBucket(sample.host.cpu_percent),
      ram: usageBucket(
        percent(sample.host.ram_used_bytes, sample.host.ram_total_bytes),
      ),
      disk: diskPressureFromPercent(
        percent(sample.host.disk_used_bytes, sample.host.disk_total_bytes),
      ),
    })),
  };
}

export function deriveOwnerMetrics(
  result: MetricsReadResult,
): OwnerMetricsModel | null {
  if (!result.latest) return null;
  return {
    freshness: result.freshness,
    latest: result.latest,
    history: result.history,
    diagnostics: result.diagnostics,
  };
}
