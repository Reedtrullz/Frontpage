import type { MaintenanceWindow } from "@/lib/content/schema";
import type {
  DataFreshness,
  IncidentListV2,
  PublicLatestV2,
  PublicServiceState,
} from "./types";

export interface PublicIncidentSummaryV2 {
  id: string;
  title: string;
  summary: string;
  state: "active" | "recovered" | "maintenance";
  severity: "warning" | "critical";
  openedAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface PublicStatusV2Model {
  freshness: DataFreshness;
  collectedAt: string;
  overallState: "operational" | "degraded" | "disruption" | "maintenance" | "unknown";
  label: string;
  services: Array<PublicLatestV2["services"][number] & { status: PublicServiceState }>;
  recentIncidents: PublicIncidentSummaryV2[];
  maintenance: MaintenanceWindow[];
}

function isActive(window: MaintenanceWindow, now: Date): boolean {
  return (
    window.status === "active" &&
    Date.parse(window.startsAt) <= now.getTime() &&
    now.getTime() < Date.parse(window.endsAt)
  );
}

export function createPublicStatusV2({
  latest,
  incidents,
  maintenance,
  now = new Date(),
}: {
  latest: PublicLatestV2;
  incidents: IncidentListV2;
  maintenance: MaintenanceWindow[];
  now?: Date;
}): PublicStatusV2Model {
  if (incidents.incidents.some((incident) => incident.visibility !== "public")) {
    throw new Error("Owner incidents may not enter the public status model.");
  }
  const activeWindows = maintenance.filter((window) => isActive(window, now));
  const maintainedIds = new Set(activeWindows.flatMap((window) => window.affectedServiceIds));
  const services = latest.services.map((service) => ({
    ...service,
    status: maintainedIds.has(service.id) ? ("maintenance" as const) : service.status,
  }));
  let overallState: PublicStatusV2Model["overallState"];
  let label: string;
  if (latest.freshness !== "fresh") {
    overallState = "unknown";
    label = latest.freshness === "stale" ? "Status delayed" : "Status unavailable";
  } else if (services.some((service) => service.status === "down")) {
    overallState = "disruption";
    label = "Service disruption";
  } else if (activeWindows.length > 0) {
    overallState = "maintenance";
    label = "Maintenance";
  } else if (services.some((service) => service.status === "unknown")) {
    overallState = "degraded";
    label = "Degraded";
  } else {
    overallState = latest.overall_state === "operational" ? "operational" : latest.overall_state;
    label = overallState === "operational" ? "Operational" : overallState === "degraded" ? "Degraded" : overallState === "disruption" ? "Service disruption" : overallState === "maintenance" ? "Maintenance" : "Status unavailable";
  }
  const recentIncidents = incidents.incidents
    .map((incident): PublicIncidentSummaryV2 => ({
      id: incident.id,
      title: incident.title,
      summary: incident.summary,
      state: incident.state,
      severity: incident.severity,
      openedAt: incident.opened_at,
      updatedAt: incident.updated_at,
      ...(incident.resolved_at ? { resolvedAt: incident.resolved_at } : {}),
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const visibleMaintenance = maintenance
    .filter(
      (window) =>
        window.status !== "completed" ||
        Date.parse(window.endsAt) >= now.getTime() - 30 * 24 * 60 * 60_000,
    )
    .sort((left, right) => right.startsAt.localeCompare(left.startsAt));
  return {
    freshness: latest.freshness,
    collectedAt: latest.collected_at,
    overallState,
    label,
    services,
    recentIncidents,
    maintenance: visibleMaintenance,
  };
}
