export const OBSERVABILITY_SCHEMA_VERSION = 2 as const;
export const OBSERVABILITY_RANGES = ["1h", "24h", "7d", "30d"] as const;
export const OBSERVABILITY_VIEWS = ["host", "workloads"] as const;
export const OBSERVABILITY_RESOURCES = [
  "cpu",
  "ram",
  "disk_io",
  "network",
] as const;
export const MAX_OWNER_LATEST_WORKLOADS = 32;
export const MAX_PROCESSES_PER_WORKLOAD = 20;
export const MAX_INCIDENTS = 256;
export const MAX_OWNER_API_RANKED_WORKLOAD_SERIES = 16;
export const MAX_OWNER_API_UNTRACKED_SERIES = 1;
export const MAX_OWNER_API_WORKLOAD_SERIES =
  MAX_OWNER_API_RANKED_WORKLOAD_SERIES + MAX_OWNER_API_UNTRACKED_SERIES;
export const MAX_SERIES_POINTS_BY_RANGE = {
  "1h": 240,
  "24h": 1440,
  "7d": 10080,
  "30d": 2880,
} as const;

export type ObservabilityRange = (typeof OBSERVABILITY_RANGES)[number];
export type ObservabilityView = (typeof OBSERVABILITY_VIEWS)[number];
export type ObservabilityResource = (typeof OBSERVABILITY_RESOURCES)[number];
export type CapabilityState = "available" | "partial" | "unavailable";
export type DataFreshness = "fresh" | "stale" | "unavailable";
export type IncidentSeverity = "warning" | "critical";
export type IncidentState = "active" | "recovered" | "maintenance";
export type ResourceState = "healthy" | "watch" | "critical" | "unknown";
export type PublicOverallState =
  | "operational"
  | "degraded"
  | "disruption"
  | "maintenance"
  | "unknown";
export type PublicServiceState = "up" | "down" | "unknown" | "maintenance";
export type WorkloadKind = "systemd" | "container" | "residual";
export type ProcessState =
  | "running"
  | "sleeping"
  | "stopped"
  | "zombie"
  | "unknown";
export type IncidentVisibility = "public" | "owner";

export interface PublicResourceStatusV2 {
  resource: ObservabilityResource;
  label: string;
  state: ResourceState;
  coverage_percent: number;
}

export interface PublicServiceStatusV2 {
  id: string;
  label: string;
  status: PublicServiceState;
  checked_at: string;
  latency_ms: number | null;
  availability_percent: number | null;
  coverage_percent: number;
}

export interface PublicLatestV2 {
  schema_version: 2;
  generated_at: string;
  collected_at: string;
  freshness: DataFreshness;
  overall_state: PublicOverallState;
  resources: PublicResourceStatusV2[];
  services: PublicServiceStatusV2[];
}

export interface CapabilityStatusV2 {
  id: string;
  label: string;
  state: CapabilityState;
  detail: string;
}

export interface OwnerResourceTotalV2 {
  resource: ObservabilityResource;
  label: string;
  unit: string;
  current: number;
  average: number;
  peak: number;
  state: ResourceState;
  freshness: DataFreshness;
  updated_at: string;
  attribution_coverage_percent: number;
  reconciliation_error_percent: number;
  workload_view: CapabilityState;
}

export interface WorkloadResourceSnapshotV2 {
  resource: ObservabilityResource;
  unit: string;
  current: number;
  average: number;
  peak: number;
  change_1h: number | null;
  coverage_percent: number;
}

export interface OwnerProcessV2 {
  workload_id: string;
  pid: number;
  comm: string;
  uid: number;
  cpu_percent: number;
  rss_bytes: number;
  state: ProcessState;
}

export interface WorkloadSnapshotV2 {
  id: string;
  label: string;
  kind: WorkloadKind;
  systemd_unit?: string;
  cgroup_path?: string;
  container_id?: string;
  resources: WorkloadResourceSnapshotV2[];
  processes: OwnerProcessV2[];
}

export interface DiagnosticV2 {
  id: string;
  severity: IncidentSeverity;
  message: string;
}

export interface IncidentEvidencePointV2 {
  recorded_at: string;
  value: number | null;
}

export interface IncidentEvidenceV2 {
  trigger_value: number | null;
  threshold_value: number | null;
  peak_value: number | null;
  points: IncidentEvidencePointV2[];
}

export interface IncidentV2 {
  id: string;
  rule_id: string;
  title: string;
  severity: IncidentSeverity;
  state: IncidentState;
  visibility: IncidentVisibility;
  resource: ObservabilityResource | null;
  workload_id?: string;
  opened_at: string;
  updated_at: string;
  resolved_at?: string;
  coverage_percent: number;
  capability_state: CapabilityState;
  summary: string;
  evidence?: IncidentEvidenceV2;
}

export interface OwnerLatestV2 {
  schema_version: 2;
  generated_at: string;
  collected_at: string;
  freshness: DataFreshness;
  host: {
    totals: OwnerResourceTotalV2[];
    capabilities: CapabilityStatusV2[];
  };
  workloads: WorkloadSnapshotV2[];
  diagnostics: DiagnosticV2[];
  incidents: IncidentV2[];
}

export interface SeriesPointSetV2 {
  id: string;
  label: string;
  unit: string;
  values: Array<number | null>;
}

export interface SeriesV2 {
  schema_version: 2;
  generated_at: string;
  range: ObservabilityRange;
  resolution_seconds: 15 | 60 | 900;
  view: ObservabilityView;
  resource: ObservabilityResource | null;
  timestamps: string[];
  series: SeriesPointSetV2[];
  coverage_percent: number;
  truncated: boolean;
}

export interface IncidentListV2 {
  schema_version: 2;
  generated_at: string;
  incidents: IncidentV2[];
}
