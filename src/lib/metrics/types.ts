export const METRICS_SCHEMA_VERSION = 1;
export const MAX_SERVICE_ITEMS = 64;
export const MAX_CONTAINER_ITEMS = 64;
export const MAX_HISTORY_SAMPLES = 1440;
export const FRESH_MS = 90_000;
export const UNAVAILABLE_MS = 5 * 60_000;

export type CheckStatus = "up" | "down" | "unknown";
export type ServiceVisibility = "public" | "owner";
export type MetricsFreshness = "fresh" | "stale" | "unavailable";
export type PublicVpsState = "online" | "pressure" | "stale" | "unknown";
export type DiskPressure = "ok" | "watch" | "critical" | "unknown";
export type PublicMetricBucket = "low" | "medium" | "high" | "unknown";
export type HistoryAvailability = "available" | "empty" | "unavailable";

export interface HistoryCoverage {
  availability: HistoryAvailability;
  windowStartAt: string;
  windowEndAt: string;
  sampleCount: number;
  gapCount: number;
}

export interface PublicServiceTrend {
  knownChecks: number;
  totalSamples: number;
  availabilityPercent: number | null;
  coveragePercent: number | null;
  p95LatencyMs: number | null;
  lastTransitionAt: string | null;
}

export interface HostMetrics {
  cpu_percent: number;
  ram_used_bytes: number;
  ram_total_bytes: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
  load_1m: number;
  load_5m: number;
  load_15m: number;
  uptime_seconds: number;
}

export interface ServiceCheck {
  id: string;
  label: string;
  project_slug?: string;
  visibility: ServiceVisibility;
  status: CheckStatus;
  checked_at: string;
  latency_ms: number | null;
}

export interface ContainerStatus {
  id: string;
  label: string;
  project_slug?: string;
  status: CheckStatus;
  checked_at: string;
}

export interface MetricsSnapshot {
  schema_version: 1;
  collected_at: string;
  host: HostMetrics;
  services: ServiceCheck[];
  containers: ContainerStatus[];
}

export interface MetricsHistory {
  schema_version: 1;
  samples: MetricsSnapshot[];
}
