import fs from "node:fs";
import path from "node:path";
import {
  parseIncidentListV2,
  parseOwnerLatestV2,
  parsePublicLatestV2,
  parseSeriesV2,
} from "./schema";
import type { OwnerMetricsQuery } from "./queries";
import {
  MAX_SERIES_POINTS_BY_RANGE,
  type DataFreshness,
  type IncidentListV2,
  type OwnerLatestV2,
  type PublicLatestV2,
  type SeriesPointSetV2,
  type SeriesV2,
} from "./types";

const LATEST_CAP_BYTES = 512 * 1024;
const SERIES_CAP_BYTES = 4 * 1024 * 1024;
const FRESH_MS = 45_000;
const UNAVAILABLE_MS = 120_000;
const RANGE_MS = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
} as const;
const MANIFEST_PATH_PATTERN = /^(?:latest|incidents)\.v2\.json$|^(?:host|workloads)\/1h\.v2\.json$|^(?:host|workloads)\/(?:minute|quarter-hour)\/\d{4}-\d{2}-\d{2}\.v2\.json$/;

export type ProjectionAvailability = "available" | "unavailable" | "invalid";
export type ProjectionReadErrorCode = "unavailable" | "invalid" | "too_large";

export interface ProjectionReadResult<T> {
  availability: ProjectionAvailability;
  data: T | null;
  diagnostics: string[];
}

export class ProjectionReadError extends Error {
  constructor(
    public readonly code: ProjectionReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectionReadError";
  }
}

interface OwnerManifestV2 {
  schema_version: 2;
  files: string[];
}

export function getPublicMetricsRootV2(): string | undefined {
  return process.env.PUBLIC_METRICS_DIR;
}

export function getOwnerMetricsRootV2(): string | undefined {
  return process.env.OWNER_METRICS_DIR;
}

function unavailable<T>(diagnostic: string): ProjectionReadResult<T> {
  return { availability: "unavailable", data: null, diagnostics: [diagnostic] };
}

function invalid<T>(diagnostic: string): ProjectionReadResult<T> {
  return { availability: "invalid", data: null, diagnostics: [diagnostic] };
}

function resolveInside(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new ProjectionReadError("invalid", "Projection path escapes its configured root.");
  }
  return resolved;
}

function readCappedJson(root: string, relative: string, cap: number): unknown {
  const filePath = resolveInside(root, relative);
  let descriptor: number | undefined;
  let bytes: Buffer;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new ProjectionReadError("invalid", "Projection path is not a regular file.");
    }
    if (stat.size > cap) {
      throw new ProjectionReadError(
        "too_large",
        `Projection exceeds ${cap === SERIES_CAP_BYTES ? "4 MiB" : "512 KiB"}.`,
      );
    }
    bytes = fs.readFileSync(descriptor);
  } catch (error) {
    if (error instanceof ProjectionReadError) throw error;
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new ProjectionReadError("unavailable", "Projection file is unavailable.");
    }
    throw new ProjectionReadError("invalid", "Projection file could not be read.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (bytes.byteLength > cap) {
    throw new ProjectionReadError("too_large", "Projection exceeds its size cap.");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ProjectionReadError("invalid", "Projection contains invalid JSON.");
  }
}

function assertNotFuture(timestamp: string, now: Date, label: string): void {
  if (Date.parse(timestamp) > now.getTime()) {
    throw new ProjectionReadError("invalid", `${label} is dated in the future.`);
  }
}

function freshnessFor(timestamp: string, now: Date): DataFreshness {
  const age = now.getTime() - Date.parse(timestamp);
  if (age <= FRESH_MS) return "fresh";
  if (age <= UNAVAILABLE_MS) return "stale";
  return "unavailable";
}

function readLatest<T extends PublicLatestV2 | OwnerLatestV2>(
  root: string | undefined,
  parse: (input: unknown) => T,
  now: Date,
): ProjectionReadResult<T> {
  if (!root) return unavailable("The metrics projection root is not configured.");
  try {
    const data = parse(readCappedJson(root, "latest.v2.json", LATEST_CAP_BYTES));
    assertNotFuture(data.generated_at, now, "Projection generation time");
    assertNotFuture(data.collected_at, now, "Projection collection time");
    return {
      availability: "available",
      data: { ...data, freshness: freshnessFor(data.collected_at, now) },
      diagnostics: [],
    };
  } catch (error) {
    if (error instanceof ProjectionReadError && error.code === "unavailable") {
      return unavailable(error.message);
    }
    return invalid(
      error instanceof ProjectionReadError
        ? error.message
        : "Projection failed schema validation.",
    );
  }
}

export function readPublicLatestV2(
  root: string | undefined = getPublicMetricsRootV2(),
  now: Date = new Date(),
): ProjectionReadResult<PublicLatestV2> {
  return readLatest(root, parsePublicLatestV2, now);
}

export function readOwnerLatestV2(
  root: string | undefined = getOwnerMetricsRootV2(),
  now: Date = new Date(),
): ProjectionReadResult<OwnerLatestV2> {
  const result = readLatest(root, parseOwnerLatestV2, now);
  if (!result.data) return result;
  try {
    assertIncidentsNotFuture(
      {
        schema_version: 2,
        generated_at: result.data.generated_at,
        incidents: result.data.incidents,
      },
      now,
    );
  } catch (error) {
    return invalid(
      error instanceof ProjectionReadError
        ? error.message
        : "Owner incident timestamps are invalid.",
    );
  }
  return {
    ...result,
    data: {
      ...result.data,
      host: {
        ...result.data.host,
        totals: result.data.host.totals.map((total) => ({
          ...total,
          freshness: result.data!.freshness,
        })),
      },
    },
  };
}

function assertIncidentsNotFuture(data: IncidentListV2, now: Date): void {
  for (const incident of data.incidents) {
    assertNotFuture(incident.opened_at, now, "Incident open time");
    assertNotFuture(incident.updated_at, now, "Incident update time");
    if (incident.resolved_at) {
      assertNotFuture(incident.resolved_at, now, "Incident resolution time");
    }
    for (const point of incident.evidence?.points ?? []) {
      assertNotFuture(point.recorded_at, now, "Incident evidence time");
    }
  }
}

export function readOwnerIncidentsV2(
  root: string | undefined = getOwnerMetricsRootV2(),
  now: Date = new Date(),
): ProjectionReadResult<IncidentListV2> {
  if (!root) return unavailable("The owner metrics projection root is not configured.");
  try {
    const data = parseIncidentListV2(
      readCappedJson(root, "incidents.v2.json", LATEST_CAP_BYTES),
    );
    assertNotFuture(data.generated_at, now, "Incident projection generation time");
    assertIncidentsNotFuture(data, now);
    return { availability: "available", data, diagnostics: [] };
  } catch (error) {
    if (error instanceof ProjectionReadError && error.code === "unavailable") {
      return unavailable(error.message);
    }
    if (error instanceof ProjectionReadError && error.code === "too_large") throw error;
    return invalid(
      error instanceof ProjectionReadError
        ? error.message
        : "Incident projection failed schema validation.",
    );
  }
}

function parseManifest(root: string): OwnerManifestV2 {
  const payload = readCappedJson(root, "manifest.v2.json", LATEST_CAP_BYTES);
  if (
    typeof payload !== "object" ||
    payload === null ||
    Object.keys(payload).some((key) => key !== "schema_version" && key !== "files") ||
    !("schema_version" in payload) ||
    payload.schema_version !== 2 ||
    !("files" in payload) ||
    !Array.isArray(payload.files) ||
    payload.files.length > 128 ||
    payload.files.some(
      (file) =>
        typeof file !== "string" ||
        !MANIFEST_PATH_PATTERN.test(file) ||
        file.includes("\\"),
    )
  ) {
    throw new ProjectionReadError("invalid", "Owner manifest contains a non-allowlisted path.");
  }
  if (new Set(payload.files).size !== payload.files.length) {
    throw new ProjectionReadError("invalid", "Owner manifest contains duplicate paths.");
  }
  return payload as OwnerManifestV2;
}

function filesForQuery(manifest: OwnerManifestV2, query: OwnerMetricsQuery): string[] {
  const expected =
    query.range === "1h"
      ? `${query.view}/1h.v2.json`
      : `${query.view}/${query.range === "30d" ? "quarter-hour" : "minute"}/`;
  const files = manifest.files
    .filter((file) =>
      query.range === "1h" ? file === expected : file.startsWith(expected),
    )
    .sort();
  if (files.length === 0) {
    throw new ProjectionReadError("unavailable", "Requested series projection is unavailable.");
  }
  return files;
}

function expectedResolution(range: OwnerMetricsQuery["range"]): 15 | 60 | 900 {
  return range === "1h" ? 15 : range === "30d" ? 900 : 60;
}

function mergeSeries(chunks: SeriesV2[], query: OwnerMetricsQuery, now: Date): SeriesV2 {
  const resolution = expectedResolution(query.range);
  const byTimestamp = new Map<string, Map<string, number | null>>();
  const metadata = new Map<string, Omit<SeriesPointSetV2, "values">>();
  let generatedAt = "";
  let truncated = false;

  for (const chunk of chunks) {
    if (chunk.view !== query.view || chunk.resolution_seconds !== resolution) {
      throw new ProjectionReadError("invalid", "Series chunk does not match the requested view and resolution.");
    }
    if (query.view === "workloads" && chunk.resource !== query.resource) {
      throw new ProjectionReadError("invalid", "Workload series chunk does not match the requested resource.");
    }
    assertNotFuture(chunk.generated_at, now, "Series generation time");
    generatedAt = !generatedAt || chunk.generated_at > generatedAt ? chunk.generated_at : generatedAt;
    truncated ||= chunk.truncated;
    chunk.series.forEach((series) => {
      const prior = metadata.get(series.id);
      if (prior && (prior.label !== series.label || prior.unit !== series.unit)) {
        throw new ProjectionReadError("invalid", "Series metadata changes between chunks.");
      }
      metadata.set(series.id, { id: series.id, label: series.label, unit: series.unit });
    });
    chunk.timestamps.forEach((timestamp, index) => {
      assertNotFuture(timestamp, now, "Series timestamp");
      const row = byTimestamp.get(timestamp) ?? new Map<string, number | null>();
      for (const series of chunk.series) row.set(series.id, series.values[index] ?? null);
      byTimestamp.set(timestamp, row);
    });
  }

  const cap = MAX_SERIES_POINTS_BY_RANGE[query.range];
  const orderedTimestamps = [...byTimestamp.keys()].sort();
  const latestTimestampMs = Date.parse(orderedTimestamps.at(-1)!);
  const windowStartMs = latestTimestampMs - RANGE_MS[query.range];
  const timestamps = orderedTimestamps
    .filter((timestamp) => Date.parse(timestamp) > windowStartMs)
    .slice(-cap);
  const series = [...metadata.values()].map((item) => ({
    ...item,
    values: timestamps.map((timestamp) => byTimestamp.get(timestamp)?.get(item.id) ?? null),
  }));
  const possibleValues = timestamps.length * series.length;
  const availableValues = series.reduce(
    (count, item) => count + item.values.filter((value) => value !== null).length,
    0,
  );
  return parseSeriesV2({
    schema_version: 2,
    generated_at: generatedAt,
    range: query.range,
    resolution_seconds: resolution,
    view: query.view,
    resource: query.view === "workloads" ? query.resource : null,
    timestamps,
    series,
    coverage_percent: possibleValues > 0 ? (availableValues / possibleValues) * 100 : 0,
    truncated,
  });
}

export function readSeriesV2(
  root: string | undefined,
  query: OwnerMetricsQuery,
  now: Date = new Date(),
): SeriesV2 {
  if (!root) {
    throw new ProjectionReadError("unavailable", "The owner metrics projection root is not configured.");
  }
  const manifest = parseManifest(root);
  const chunks = filesForQuery(manifest, query).map((file) => {
    try {
      return parseSeriesV2(readCappedJson(root, file, SERIES_CAP_BYTES));
    } catch (error) {
      if (error instanceof ProjectionReadError) throw error;
      throw new ProjectionReadError("invalid", "Series projection failed schema validation.");
    }
  });
  const merged = mergeSeries(chunks, query, now);
  if (Buffer.byteLength(JSON.stringify(merged), "utf8") > SERIES_CAP_BYTES) {
    throw new ProjectionReadError("too_large", "Series projection exceeds 4 MiB.");
  }
  return merged;
}
