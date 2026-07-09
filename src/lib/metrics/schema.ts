import { z } from "zod";
import {
  MAX_CONTAINER_ITEMS,
  MAX_HISTORY_SAMPLES,
  MAX_SERVICE_ITEMS,
  METRICS_SCHEMA_VERSION,
  type MetricsHistory,
  type MetricsSnapshot,
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
const statusSchema = z.enum(["up", "down", "unknown"]);

export function assertUniqueIds(
  items: { id: string }[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate ${label} id: ${item.id}`);
    }
    seen.add(item.id);
  }
}

const hostSchema = z
  .object({
    cpu_percent: z.number().min(0).max(100),
    ram_used_bytes: z.number().int().min(0),
    ram_total_bytes: z.number().int().min(1),
    disk_used_bytes: z.number().int().min(0),
    disk_total_bytes: z.number().int().min(1),
    load_1m: z.number().min(0),
    load_5m: z.number().min(0),
    load_15m: z.number().min(0),
    uptime_seconds: z.number().int().min(0),
  })
  .strict();

const serviceCheckSchema = z
  .object({
    id: idSchema,
    label: z.string().min(1).max(80),
    project_slug: idSchema.optional(),
    visibility: z.enum(["public", "owner"]),
    status: statusSchema,
    checked_at: utcDateTimeSchema,
    latency_ms: z.number().int().min(0).max(10_000).nullable(),
  })
  .strict();

const containerStatusSchema = z
  .object({
    id: idSchema,
    label: z.string().min(1).max(80),
    project_slug: idSchema.optional(),
    status: statusSchema,
    checked_at: utcDateTimeSchema,
  })
  .strict();

export const metricsSnapshotSchema = z
  .object({
    schema_version: z.literal(METRICS_SCHEMA_VERSION),
    collected_at: utcDateTimeSchema,
    host: hostSchema,
    services: z.array(serviceCheckSchema).max(MAX_SERVICE_ITEMS),
    containers: z.array(containerStatusSchema).max(MAX_CONTAINER_ITEMS),
  })
  .strict();

export const metricsHistorySchema = z
  .object({
    schema_version: z.literal(METRICS_SCHEMA_VERSION),
    samples: z.array(metricsSnapshotSchema).max(MAX_HISTORY_SAMPLES),
  })
  .strict();

export function parseMetricsSnapshot(input: unknown): MetricsSnapshot {
  const parsed = metricsSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid metrics snapshot: ${parsed.error.message}`);
  }
  assertUniqueIds(parsed.data.services, "service");
  assertUniqueIds(parsed.data.containers, "container");
  return parsed.data;
}

export function parseMetricsHistory(input: unknown): MetricsHistory {
  const parsed = metricsHistorySchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid metrics history: ${parsed.error.message}`);
  }
  for (const sample of parsed.data.samples) {
    assertUniqueIds(sample.services, "service");
    assertUniqueIds(sample.containers, "container");
  }
  return parsed.data;
}
