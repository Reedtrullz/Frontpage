import { z } from "zod";
import {
  MAX_INCIDENTS,
  MAX_OWNER_API_RANKED_WORKLOAD_SERIES,
  MAX_OWNER_API_UNTRACKED_SERIES,
  MAX_OWNER_API_WORKLOAD_SERIES,
  MAX_OWNER_LATEST_WORKLOADS,
  MAX_PROCESSES_PER_WORKLOAD,
  MAX_SERIES_POINTS_BY_RANGE,
  OBSERVABILITY_RANGES,
  OBSERVABILITY_RESOURCES,
  OBSERVABILITY_SCHEMA_VERSION,
  OBSERVABILITY_VIEWS,
  type IncidentListV2,
  type OwnerLatestV2,
  type PublicLatestV2,
  type SeriesV2,
} from "./types";

export {
  MAX_OWNER_API_RANKED_WORKLOAD_SERIES,
  MAX_OWNER_API_UNTRACKED_SERIES,
  MAX_OWNER_API_WORKLOAD_SERIES,
  MAX_OWNER_LATEST_WORKLOADS,
} from "./types";

const utcDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    "Timestamp must be an ISO 8601 UTC value ending in Z.",
  )
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "Timestamp must be a real date.",
  );

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const pathLikeSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._/-]+$/);
const labelSchema = z.string().min(1).max(80);
const detailSchema = z.string().min(1).max(240);
const unitSchema = z.string().min(1).max(32);
const percentageSchema = z.number().min(0).max(100);
const nonNegativeNumberSchema = z.number().min(0);

const capabilityStateSchema = z.enum(["available", "partial", "unavailable"]);
const dataFreshnessSchema = z.enum(["fresh", "stale", "unavailable"]);
const incidentSeveritySchema = z.enum(["warning", "critical"]);
const incidentStateSchema = z.enum(["active", "recovered", "maintenance"]);
const incidentVisibilitySchema = z.enum(["public", "owner"]);
const resourceStateSchema = z.enum(["healthy", "watch", "critical", "unknown"]);
const publicOverallStateSchema = z.enum([
  "operational",
  "degraded",
  "disruption",
  "maintenance",
  "unknown",
]);
const publicServiceStateSchema = z.enum([
  "up",
  "down",
  "unknown",
  "maintenance",
]);
const workloadKindSchema = z.enum(["systemd", "container", "residual"]);
const processStateSchema = z.enum([
  "running",
  "sleeping",
  "stopped",
  "zombie",
  "unknown",
]);
const observabilityRangeSchema = z.enum(OBSERVABILITY_RANGES);
const observabilityViewSchema = z.enum(OBSERVABILITY_VIEWS);
const observabilityResourceSchema = z.enum(OBSERVABILITY_RESOURCES);

const publicResourceStatusSchema = z
  .object({
    resource: observabilityResourceSchema,
    label: labelSchema,
    state: resourceStateSchema,
    coverage_percent: percentageSchema,
  })
  .strict();

const publicServiceStatusSchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    status: publicServiceStateSchema,
    checked_at: utcDateTimeSchema,
    latency_ms: z.number().int().min(0).max(10_000).nullable(),
    availability_percent: percentageSchema.nullable(),
    coverage_percent: percentageSchema,
  })
  .strict();

export const publicLatestV2Schema = z
  .object({
    schema_version: z.literal(OBSERVABILITY_SCHEMA_VERSION),
    generated_at: utcDateTimeSchema,
    collected_at: utcDateTimeSchema,
    freshness: dataFreshnessSchema,
    overall_state: publicOverallStateSchema,
    resources: z.array(publicResourceStatusSchema).min(1).max(4),
    services: z.array(publicServiceStatusSchema).max(32),
  })
  .strict();

const capabilityStatusSchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    state: capabilityStateSchema,
    detail: detailSchema,
  })
  .strict();

const ownerResourceTotalSchema = z
  .object({
    resource: observabilityResourceSchema,
    label: labelSchema,
    unit: unitSchema,
    current: nonNegativeNumberSchema,
    average: nonNegativeNumberSchema,
    peak: nonNegativeNumberSchema,
    state: resourceStateSchema,
    freshness: dataFreshnessSchema,
    updated_at: utcDateTimeSchema,
    attribution_coverage_percent: percentageSchema,
    reconciliation_error_percent: percentageSchema,
    workload_view: capabilityStateSchema,
  })
  .strict()
  .refine((value) => value.peak >= value.average, {
    message: "Peak must be greater than or equal to average.",
  })
  .refine((value) => value.peak >= value.current, {
    message: "Peak must be greater than or equal to current.",
  });

const workloadResourceSnapshotSchema = z
  .object({
    resource: observabilityResourceSchema,
    unit: unitSchema,
    current: nonNegativeNumberSchema,
    average: nonNegativeNumberSchema,
    peak: nonNegativeNumberSchema,
    change_1h: z.number().nullable(),
    coverage_percent: percentageSchema,
  })
  .strict()
  .refine((value) => value.peak >= value.average, {
    message: "Peak must be greater than or equal to average.",
  })
  .refine((value) => value.peak >= value.current, {
    message: "Peak must be greater than or equal to current.",
  });

const ownerProcessSchema = z
  .object({
    workload_id: idSchema,
    pid: z.number().int().min(1),
    comm: z.string().min(1).max(64),
    uid: z.number().int().min(0),
    cpu_percent: percentageSchema,
    rss_bytes: z.number().int().min(0),
    state: processStateSchema,
  })
  .strict();

const workloadSnapshotSchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    kind: workloadKindSchema,
    systemd_unit: pathLikeSchema.optional(),
    cgroup_path: pathLikeSchema.optional(),
    container_id: pathLikeSchema.optional(),
    resources: z.array(workloadResourceSnapshotSchema).min(1).max(4),
    processes: z.array(ownerProcessSchema).max(MAX_PROCESSES_PER_WORKLOAD),
  })
  .strict();

const diagnosticSchema = z
  .object({
    id: idSchema,
    severity: incidentSeveritySchema,
    message: detailSchema,
  })
  .strict();

const incidentEvidencePointSchema = z
  .object({
    recorded_at: utcDateTimeSchema,
    value: z.number().nullable(),
  })
  .strict();

const incidentEvidenceSchema = z
  .object({
    trigger_value: z.number().nullable(),
    threshold_value: z.number().nullable(),
    peak_value: z.number().nullable(),
    points: z.array(incidentEvidencePointSchema).max(64),
  })
  .strict();

const incidentSchema = z
  .object({
    id: idSchema,
    rule_id: idSchema,
    title: z.string().min(1).max(120),
    severity: incidentSeveritySchema,
    state: incidentStateSchema,
    visibility: incidentVisibilitySchema,
    resource: observabilityResourceSchema.nullable(),
    workload_id: idSchema.optional(),
    opened_at: utcDateTimeSchema,
    updated_at: utcDateTimeSchema,
    resolved_at: utcDateTimeSchema.optional(),
    coverage_percent: percentageSchema,
    capability_state: capabilityStateSchema,
    summary: detailSchema,
    evidence: incidentEvidenceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "recovered" && !value.resolved_at) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recovered incidents require resolved_at.",
        path: ["resolved_at"],
      });
    }
    if (value.state !== "recovered" && value.resolved_at) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only recovered incidents may include resolved_at.",
        path: ["resolved_at"],
      });
    }
    if (value.visibility === "public" && value.workload_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Public incidents may not expose workload ids.",
        path: ["workload_id"],
      });
    }
    if (value.visibility === "public" && value.evidence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Public incidents may not expose owner evidence.",
        path: ["evidence"],
      });
    }
  });

export const ownerLatestV2Schema = z
  .object({
    schema_version: z.literal(OBSERVABILITY_SCHEMA_VERSION),
    generated_at: utcDateTimeSchema,
    collected_at: utcDateTimeSchema,
    freshness: dataFreshnessSchema,
    host: z
      .object({
        totals: z.array(ownerResourceTotalSchema).min(1).max(4),
        capabilities: z.array(capabilityStatusSchema).max(8),
      })
      .strict(),
    workloads: z.array(workloadSnapshotSchema).max(MAX_OWNER_LATEST_WORKLOADS),
    diagnostics: z.array(diagnosticSchema).max(32),
    incidents: z.array(incidentSchema).max(MAX_INCIDENTS),
  })
  .strict();

const seriesPointSetSchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    unit: unitSchema,
    values: z.array(z.number().nullable()),
  })
  .strict();

export const seriesV2Schema = z
  .object({
    schema_version: z.literal(OBSERVABILITY_SCHEMA_VERSION),
    generated_at: utcDateTimeSchema,
    range: observabilityRangeSchema,
    resolution_seconds: z.union([z.literal(15), z.literal(60), z.literal(900)]),
    view: observabilityViewSchema,
    resource: observabilityResourceSchema.nullable(),
    timestamps: z.array(utcDateTimeSchema),
    series: z.array(seriesPointSetSchema).min(1).max(MAX_OWNER_API_WORKLOAD_SERIES),
    coverage_percent: percentageSchema,
    truncated: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const maxPoints = MAX_SERIES_POINTS_BY_RANGE[value.range];
    if (value.timestamps.length === 0 || value.timestamps.length > maxPoints) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Range ${value.range} must include between 1 and ${maxPoints} timestamps.`,
        path: ["timestamps"],
      });
    }

    const expectedResolution =
      value.range === "1h" ? 15 : value.range === "30d" ? 900 : 60;
    if (value.resolution_seconds !== expectedResolution) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Range ${value.range} requires resolution ${expectedResolution}.`,
        path: ["resolution_seconds"],
      });
    }

    if (value.view === "workloads" && value.resource === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Workload series require a resource.",
        path: ["resource"],
      });
    }

    value.series.forEach((series, index) => {
      if (series.values.length !== value.timestamps.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Series value counts must match timestamps.",
          path: ["series", index, "values"],
        });
      }
    });
  });

export const incidentListV2Schema = z
  .object({
    schema_version: z.literal(OBSERVABILITY_SCHEMA_VERSION),
    generated_at: utcDateTimeSchema,
    incidents: z.array(incidentSchema).max(MAX_INCIDENTS),
  })
  .strict();

export class ObservabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObservabilityValidationError";
  }
}

function assertUniqueIds(items: { id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new ObservabilityValidationError(`Duplicate ${label} id: ${item.id}`);
    }
    seen.add(item.id);
  }
}

function assertUniqueValues<T>(
  items: T[],
  valueFor: (item: T) => string,
  label: string,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    const value = valueFor(item);
    if (seen.has(value)) {
      throw new ObservabilityValidationError(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

export function parsePublicLatestV2(input: unknown): PublicLatestV2 {
  const parsed = publicLatestV2Schema.safeParse(input);
  if (!parsed.success) {
    throw new ObservabilityValidationError(
      `Invalid public observability payload: ${parsed.error.message}`,
    );
  }
  assertUniqueValues(parsed.data.resources, (item) => item.resource, "resource");
  assertUniqueIds(parsed.data.services, "service");
  return parsed.data;
}

export function parseOwnerLatestV2(input: unknown): OwnerLatestV2 {
  const parsed = ownerLatestV2Schema.safeParse(input);
  if (!parsed.success) {
    throw new ObservabilityValidationError(
      `Invalid owner observability payload: ${parsed.error.message}`,
    );
  }
  assertUniqueValues(
    parsed.data.host.totals,
    (item) => item.resource,
    "host resource",
  );
  assertUniqueIds(parsed.data.host.capabilities, "capability");
  assertUniqueIds(parsed.data.workloads, "workload");
  const hostNetworkTotal = parsed.data.host.totals.find(
    (total) => total.resource === "network",
  );
  for (const workload of parsed.data.workloads) {
    assertUniqueValues(
      workload.resources,
      (item) => item.resource,
      `workload resource for ${workload.id}`,
    );
    if (
      hostNetworkTotal?.workload_view === "unavailable" &&
      workload.resources.some((resource) => resource.resource === "network")
    ) {
      throw new ObservabilityValidationError(
        "Network resource rows may not be serialized for workloads when host network workload_view is unavailable.",
      );
    }

    for (const process of workload.processes) {
      if (process.workload_id !== workload.id) {
        throw new ObservabilityValidationError(
          `Process workload_id must match its containing workload: ${workload.id}`,
        );
      }
    }
  }
  assertUniqueIds(parsed.data.diagnostics, "diagnostic");
  assertUniqueIds(parsed.data.incidents, "incident");
  return parsed.data;
}

export function parseSeriesV2(input: unknown): SeriesV2 {
  const parsed = seriesV2Schema.safeParse(input);
  if (!parsed.success) {
    throw new ObservabilityValidationError(
      `Invalid observability series payload: ${parsed.error.message}`,
    );
  }
  assertUniqueIds(parsed.data.series, "series");
  return parsed.data;
}

export function parseIncidentListV2(input: unknown): IncidentListV2 {
  const parsed = incidentListV2Schema.safeParse(input);
  if (!parsed.success) {
    throw new ObservabilityValidationError(
      `Invalid observability incident payload: ${parsed.error.message}`,
    );
  }
  assertUniqueIds(parsed.data.incidents, "incident");
  return parsed.data;
}
