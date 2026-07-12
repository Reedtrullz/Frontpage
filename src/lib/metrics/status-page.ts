import type { ProjectContent } from "@/lib/content/schema";
import {
  deriveOwnerMetrics,
  derivePublicMetrics,
  type MetricsReadResult,
  type OwnerMetricsModel,
  type PublicMetricsModel,
  type PublicServiceStatus,
} from "./reader";
import type { MetricsFreshness } from "./types";

export type OverallPublicStatusKind =
  | "unavailable"
  | "delayed"
  | "disruption"
  | "degraded"
  | "operational"
  | "no-checks";

export interface OverallPublicStatus {
  kind: OverallPublicStatusKind;
  label: string;
  description: string;
}

export interface PublicStatusMetricsModel extends PublicMetricsModel {
  lastKnownServiceCount: number | null;
}

export type ProjectRuntimeHealth =
  | "healthy"
  | "degraded"
  | "disruption"
  | "unavailable"
  | "not-monitored";

export type OwnerAttentionSeverity = "warning" | "critical";

export interface OwnerAttentionItem {
  id: string;
  severity: OwnerAttentionSeverity;
  label: string;
  reason: string;
  destination: { label: string; href: string };
}

export const OWNER_RESOURCE_THRESHOLDS = {
  cpu: { warning: 80, critical: 95 },
  ram: { warning: 85, critical: 95 },
  disk: { warning: 75, critical: 90 },
} as const;

export interface StatusPageModel {
  public: PublicStatusMetricsModel;
  overall: OverallPublicStatus;
  owner: OwnerMetricsModel | null;
  ownerAttention: OwnerAttentionItem[] | null;
}

export function deriveOverallPublicStatus(
  metrics: PublicMetricsModel,
): OverallPublicStatus {
  if (metrics.freshness === "unavailable") {
    return {
      kind: "unavailable",
      label: "Status unavailable",
      description: "Current telemetry is unavailable, so no healthy state is assumed.",
    };
  }
  if (metrics.freshness === "stale") {
    return {
      kind: "delayed",
      label: "Status delayed",
      description: "The latest sample is stale and is shown as last-known state.",
    };
  }
  if (metrics.host.serviceSummary.down > 0) {
    return {
      kind: "disruption",
      label: "Service disruption",
      description: `${metrics.host.serviceSummary.down} public service check${metrics.host.serviceSummary.down === 1 ? " is" : "s are"} down.`,
    };
  }
  if (metrics.host.serviceSummary.unknown > 0) {
    return {
      kind: "degraded",
      label: "Degraded",
      description: "A public service check has unknown current state.",
    };
  }
  if (metrics.host.diskPressure === "critical") {
    return {
      kind: "degraded",
      label: "Degraded",
      description: "Host disk pressure is critical.",
    };
  }
  if (metrics.host.serviceSummary.total > 0) {
    return {
      kind: "operational",
      label: "Operational",
      description: "All configured public service checks report up.",
    };
  }
  return {
    kind: "no-checks",
    label: "No public checks",
    description: "No public service checks are currently configured.",
  };
}

function lastKnownPublicServiceCount(
  readResult: MetricsReadResult,
  now: Date,
): number | null {
  const latestKnownSample = [...readResult.history, readResult.latest]
    .filter((sample): sample is NonNullable<MetricsReadResult["latest"]> => {
      if (!sample) return false;
      return Date.parse(sample.collected_at) <= now.getTime();
    })
    .sort(
      (left, right) =>
        Date.parse(right.collected_at) - Date.parse(left.collected_at),
    )[0];

  if (!latestKnownSample) return null;
  return latestKnownSample.services.filter(
    (service) => service.visibility === "public",
  ).length;
}

export function deriveProjectHealth(
  project: Pick<ProjectContent, "slug" | "healthServiceIds">,
  services: PublicServiceStatus[],
  freshness: MetricsFreshness,
): ProjectRuntimeHealth {
  const configuredIds = new Set(project.healthServiceIds ?? []);
  const checks = services.filter((service) =>
    configuredIds.size > 0
      ? configuredIds.has(service.id)
      : service.projectSlug === project.slug,
  );

  if (configuredIds.size > 0 && checks.length !== configuredIds.size) {
    return "unavailable";
  }
  if (checks.length === 0) return "not-monitored";
  if (freshness !== "fresh") return "unavailable";
  const upChecks = checks.filter((check) => check.status === "up").length;
  const downChecks = checks.filter((check) => check.status === "down").length;
  const unknownChecks = checks.length - upChecks - downChecks;

  if (downChecks === checks.length) return "disruption";
  if (upChecks > 0 && upChecks < checks.length) return "degraded";
  if (unknownChecks > 0) return "unavailable";
  return "healthy";
}

function percentage(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0;
}

function resourceAttention(
  id: "cpu" | "ram" | "disk",
  value: number,
): OwnerAttentionItem | null {
  const thresholds = OWNER_RESOURCE_THRESHOLDS[id];
  if (value < thresholds.warning) return null;
  const critical = value >= thresholds.critical;
  const label = id === "cpu" ? "CPU" : id === "ram" ? "RAM" : "Disk";
  return {
    id: `${id}-${critical ? "critical" : "warning"}`,
    severity: critical ? "critical" : "warning",
    label: `${label} ${critical ? "critical" : "elevated"}`,
    reason: `${label} is at ${Math.round(value * 10) / 10}% (warning ${thresholds.warning}%, critical ${thresholds.critical}%).`,
    destination: { label: "Open operations runbook", href: "/ansible" },
  };
}

export function deriveOwnerAttention(
  metrics: OwnerMetricsModel | null,
): OwnerAttentionItem[] {
  if (!metrics?.latest) {
    return [
      {
        id: "metrics-unavailable",
        severity: "critical",
        label: "Metrics unavailable",
        reason: "No schema-valid current host sample is available.",
        destination: { label: "Open operations runbook", href: "/ansible" },
      },
    ];
  }

  const items: OwnerAttentionItem[] = [];
  if (metrics.freshness !== "fresh") {
    items.push({
      id: `metrics-${metrics.freshness}`,
      severity: metrics.freshness === "unavailable" ? "critical" : "warning",
      label: metrics.freshness === "unavailable" ? "Metrics unavailable" : "Metrics delayed",
      reason: "The collector has not produced a current sample within the freshness threshold.",
      destination: { label: "Open operations runbook", href: "/ansible" },
    });
  }

  const host = metrics.latest.host;
  const resourceItems = [
    resourceAttention("cpu", host.cpu_percent),
    resourceAttention("ram", percentage(host.ram_used_bytes, host.ram_total_bytes)),
    resourceAttention("disk", percentage(host.disk_used_bytes, host.disk_total_bytes)),
  ].filter((item): item is OwnerAttentionItem => item !== null);
  items.push(...resourceItems);

  const downServices = metrics.latest.services.filter(
    (service) => service.status === "down",
  );
  if (downServices.length > 0) {
    items.push({
      id: "services-down",
      severity: "critical",
      label: "Services down",
      reason: `${downServices.length} allowlisted service check${downServices.length === 1 ? " is" : "s are"} down.`,
      destination: { label: "Review service inventory", href: "#owner-services" },
    });
  }
  const unknownServices = metrics.latest.services.filter(
    (service) => service.status === "unknown",
  );
  if (unknownServices.length > 0) {
    items.push({
      id: "services-unknown",
      severity: "warning",
      label: "Services unknown",
      reason: `${unknownServices.length} allowlisted service check${unknownServices.length === 1 ? " has" : "s have"} unknown state.`,
      destination: { label: "Review service inventory", href: "#owner-services" },
    });
  }
  const containerIssues = metrics.latest.containers.filter(
    (container) => container.status !== "up",
  );
  if (containerIssues.length > 0) {
    items.push({
      id: "containers-attention",
      severity: containerIssues.some((container) => container.status === "down")
        ? "critical"
        : "warning",
      label: "Container attention",
      reason: `${containerIssues.length} allowlisted container${containerIssues.length === 1 ? " needs" : "s need"} review.`,
      destination: { label: "Review container inventory", href: "#owner-containers" },
    });
  }
  return items;
}

export function createStatusPageModel({
  readResult,
  isOwner,
  now = new Date(),
}: {
  readResult: MetricsReadResult;
  isOwner: boolean;
  now?: Date;
}): StatusPageModel {
  const publicModel: PublicStatusMetricsModel = {
    ...derivePublicMetrics(readResult, now),
    lastKnownServiceCount: lastKnownPublicServiceCount(readResult, now),
  };
  const owner = isOwner ? deriveOwnerMetrics(readResult, now) : null;
  return {
    public: publicModel,
    overall: deriveOverallPublicStatus(publicModel),
    owner,
    ownerAttention: isOwner ? deriveOwnerAttention(owner) : null,
  };
}
