import {
  OBSERVABILITY_RANGES,
  OBSERVABILITY_RESOURCES,
  OBSERVABILITY_VIEWS,
  type ObservabilityRange,
  type ObservabilityResource,
  type ObservabilityView,
} from "./types";

export interface OwnerMetricsQuery {
  range: ObservabilityRange;
  view: ObservabilityView;
  resource: ObservabilityResource | null;
}

export class OwnerMetricsQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerMetricsQueryError";
  }
}

function oneValue(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) {
    throw new OwnerMetricsQueryError(`${name} may be provided only once.`);
  }
  return values[0] ?? null;
}

export function parseOwnerMetricsQuery(url: URL): OwnerMetricsQuery {
  const allowedKeys = new Set(["range", "view", "resource"]);
  for (const key of url.searchParams.keys()) {
    if (!allowedKeys.has(key)) {
      throw new OwnerMetricsQueryError(`Unknown query parameter: ${key}.`);
    }
  }

  const range = oneValue(url, "range");
  const view = oneValue(url, "view");
  const resource = oneValue(url, "resource");
  if (!range || !OBSERVABILITY_RANGES.includes(range as ObservabilityRange)) {
    throw new OwnerMetricsQueryError("range must be one of 1h, 24h, 7d, or 30d.");
  }
  if (!view || !OBSERVABILITY_VIEWS.includes(view as ObservabilityView)) {
    throw new OwnerMetricsQueryError("view must be host or workloads.");
  }
  if (
    resource !== null &&
    !OBSERVABILITY_RESOURCES.includes(resource as ObservabilityResource)
  ) {
    throw new OwnerMetricsQueryError(
      "resource must be cpu, ram, disk_io, or network.",
    );
  }
  if (view === "workloads" && resource === null) {
    throw new OwnerMetricsQueryError("resource is required for workload history.");
  }

  return {
    range: range as ObservabilityRange,
    view: view as ObservabilityView,
    resource: resource as ObservabilityResource | null,
  };
}
