import { gzipSync } from "node:zlib";
import type { OwnerMetricsQuery } from "./queries";
import type { ObservabilityRange, SeriesPointSetV2, SeriesV2 } from "./types";

export const NOW = new Date("2026-07-12T19:00:00.000Z");
export const AGGREGATE_NOW = new Date("2026-07-31T00:00:00Z");
export const CASE_BYTE_CAP = 36_000_000;
export const FILE_BYTE_CAP = 50_000_000;
export const MEMBER_BYTES = 4_194_305;
export const MANIFEST_CAP_BYTES = 524_289;
export const AGGREGATE_CHUNK_BYTES = 3_500_014;
const GENERATED_AT = "2026-07-12T18:59:00.000Z";

export const EXPECT = {
  missing: "unavailable",
  json: "invalid",
  gzip: "invalid",
  traversal: "invalid",
  duplicate: "invalid",
  date: "invalid",
  future: "invalid",
  member: "too_large",
  "manifest-cap": "too_large",
  aggregate: "too_large",
} as const;

export type FaultName = keyof typeof EXPECT;

export interface WindowSpec {
  cap: number;
  resolution: 15 | 60 | 900;
  first: string;
  last: string;
  chunkRows: number;
  parseCalls: number;
}

export const WINDOWS: Record<ObservabilityRange, WindowSpec> = {
  "1h": { cap: 240, resolution: 15, first: "2026-07-12T18:00:15.000Z", last: "2026-07-12T19:00:00.000Z", chunkRows: 1, parseCalls: 2 },
  "24h": { cap: 1440, resolution: 60, first: "2026-07-11T19:01:00.000Z", last: "2026-07-12T19:00:00.000Z", chunkRows: 2, parseCalls: 3 },
  "7d": { cap: 10080, resolution: 60, first: "2026-07-05T19:01:00.000Z", last: "2026-07-12T19:00:00.000Z", chunkRows: 8, parseCalls: 9 },
  "30d": { cap: 2880, resolution: 900, first: "2026-06-12T19:15:00.000Z", last: "2026-07-12T19:00:00.000Z", chunkRows: 31, parseCalls: 32 },
};

export interface SeriesIdentity {
  id: string;
  label: string;
  unit: string;
}

export interface BuiltQuery {
  query: OwnerMetricsQuery;
  decoded: Record<string, Buffer>;
  expectedFiles: string[];
  expected: Map<number, Array<number | null>>;
  series: SeriesIdentity[];
  decodedBytesExpected: number;
}

export interface FaultCase {
  query: OwnerMetricsQuery;
  now: Date;
  filesystem: boolean;
  decoded: Record<string, Buffer>;
  rawChunks?: Buffer[];
  aggregateChunkBytes?: number;
}

export function hostQuery(range: ObservabilityRange): OwnerMetricsQuery {
  return { range, view: "host", resource: null };
}

export function ramQuery(range: ObservabilityRange): OwnerMetricsQuery {
  return { range, view: "workloads", resource: "ram" };
}

function daySpan(start: string, count: number): string[] {
  const dates: string[] = [];
  let at = Date.parse(start + "T00:00:00.000Z");
  for (let index = 0; index < count; index += 1) {
    dates.push(new Date(at).toISOString().slice(0, 10));
    at += 86_400_000;
  }
  return dates;
}

function seriesFor(query: OwnerMetricsQuery): SeriesIdentity[] {
  if (query.view === "workloads") {
    return [
      { id: "workload-a", label: "Workload A", unit: "bytes" },
      { id: "workload-b", label: "Workload B", unit: "bytes" },
    ];
  }
  return [
    { id: "host-total", label: "CPU total", unit: "percent" },
    { id: "host-load", label: "Load", unit: "percent" },
  ];
}

function sample(slot: number, seriesIndex: number): number | null {
  if ((slot + 1) % 11 === 0) return null;
  return seriesIndex === 0 ? slot + 1 : (slot + 1) / 2;
}

function chunk(query: OwnerMetricsQuery, timestamps: string[], loserAt?: string): { payload: SeriesV2; bytes: Buffer } {
  const identity = seriesFor(query);
  const series: SeriesPointSetV2[] = identity.map((item, seriesIndex) => ({
    ...item,
    values: timestamps.map((timestamp, index) => timestamp === loserAt ? 111.1 : sample(index, seriesIndex)),
  }));
  const payload: SeriesV2 = {
    schema_version: 2,
    generated_at: GENERATED_AT,
    range: query.range,
    resolution_seconds: WINDOWS[query.range].resolution,
    view: query.view,
    resource: query.view === "workloads" ? query.resource : null,
    timestamps,
    series,
    coverage_percent: 100,
    truncated: false,
  };
  return { payload, bytes: Buffer.from(JSON.stringify(payload)) };
}

function marks(date: string): string[] {
  const start = Date.parse(date + "T00:00:00.000Z");
  const end = date === "2026-07-12" ? Date.parse("2026-07-12T19:00:00.000Z") : start + 86_400_000 - 900_000;
  const timestamps: string[] = [];
  for (let at = start; at <= end; at += 900_000) timestamps.push(new Date(at).toISOString());
  return timestamps;
}

function remember(expected: Map<number, Array<number | null>>, payload: SeriesV2, loserAt?: string): void {
  payload.timestamps.forEach((timestamp, index) => {
    if (timestamp === loserAt) return;
    expected.set(Date.parse(timestamp), payload.series.map((item) => item.values[index] ?? null));
  });
}

function manifest(files: string[]): Buffer {
  return Buffer.from(JSON.stringify({ schema_version: 2, files }));
}

function pad(bytes: Buffer, size: number): Buffer {
  return Buffer.concat([bytes, Buffer.alloc(size - bytes.byteLength, 0x20)]);
}

function relative(query: OwnerMetricsQuery, date?: string): string {
  const base = query.view === "workloads" ? "workloads/" + query.resource : "host";
  if (query.range === "1h") return base + "/1h.v2.json";
  const tier = query.range === "30d" ? "quarter-hour" : "minute";
  return base + "/" + tier + "/" + date + ".v2.json";
}

export function buildQuery(query: OwnerMetricsQuery): BuiltQuery {
  const spec = WINDOWS[query.range];
  const decoded: Record<string, Buffer> = {};
  const expected = new Map<number, Array<number | null>>();
  const expectedFiles: string[] = [];
  const listed: string[] = [];
  if (query.range === "1h") {
    const first = Date.parse(spec.first);
    const timestamps = Array.from({ length: spec.cap - 4 }, (_, index) => new Date(first + index * spec.resolution * 1000).toISOString());
    const built = chunk(query, timestamps);
    const name = relative(query);
    decoded[name] = built.bytes;
    expectedFiles.push(name);
    listed.push(name);
    remember(expected, built.payload);
  } else {
    const dates = daySpan(query.range === "24h" ? "2026-07-11" : query.range === "7d" ? "2026-07-05" : "2026-06-12", spec.chunkRows);
    const sentinel = query.range === "24h" ? "2026-07-09" : query.range === "7d" ? "2026-07-03" : "2026-06-10";
    dates.forEach((date, index) => {
      const next = dates[index + 1];
      const loserAt = next ? next + "T00:00:00.000Z" : undefined;
      const timestamps = marks(date);
      if (loserAt && Date.parse(loserAt) <= NOW.getTime()) timestamps.push(loserAt);
      const built = chunk(query, timestamps, loserAt);
      const name = relative(query, date);
      decoded[name] = built.bytes;
      expectedFiles.push(name);
      listed.push(name);
      remember(expected, built.payload, loserAt);
    });
    const sentinelName = relative(query, sentinel);
    const sentinelChunk = chunk(query, [sentinel + "T00:00:00.000Z"]);
    sentinelChunk.payload.series.forEach((item) => { item.values = [987.5]; });
    decoded[sentinelName] = Buffer.from(JSON.stringify(sentinelChunk.payload));
    listed.push(sentinelName);
  }
  const manifestBytes = manifest(listed);
  decoded["manifest.v2.json"] = manifestBytes;
  const decodedBytesExpected = manifestBytes.byteLength + expectedFiles.reduce((sum, name) => sum + (decoded[name]?.byteLength ?? 0), 0);
  return { query, decoded, expectedFiles, expected, series: seriesFor(query), decodedBytesExpected };
}

function futureChunk(): Buffer {
  const payload: SeriesV2 = {
    schema_version: 2,
    generated_at: GENERATED_AT,
    range: "1h",
    resolution_seconds: 15,
    view: "host",
    resource: null,
    timestamps: ["2026-07-12T20:00:00.000Z"],
    series: [{ id: "host-total", label: "CPU total", unit: "percent", values: [1] }],
    coverage_percent: 100,
    truncated: false,
  };
  return Buffer.from(JSON.stringify(payload));
}

export function buildFault(name: FaultName): FaultCase {
  const oneHour = hostQuery("1h");
  const month = hostQuery("30d");
  if (name === "missing") return { query: oneHour, now: NOW, filesystem: true, decoded: { "manifest.v2.json": manifest(["host/1h.v2.json"]) } };
  if (name === "json") {
    return { query: oneHour, now: NOW, filesystem: true, decoded: { "manifest.v2.json": manifest(["host/1h.v2.json"]), "host/1h.v2.json": Buffer.from("{not json") } };
  }
  if (name === "gzip") {
    const valid = gzipSync(futureChunk());
    return {
      query: oneHour,
      now: NOW,
      filesystem: false,
      decoded: { "manifest.v2.json": manifest(["host/1h.v2.json"]) },
      rawChunks: [Buffer.from("not gzip"), valid.subarray(0, valid.length - 6)],
    };
  }
  if (name === "traversal") return { query: oneHour, now: NOW, filesystem: true, decoded: { "manifest.v2.json": manifest(["../x.v2.json"]) } };
  if (name === "duplicate") return { query: oneHour, now: NOW, filesystem: true, decoded: { "manifest.v2.json": manifest(["host/1h.v2.json", "host/1h.v2.json"]) } };
  if (name === "date") return { query: month, now: NOW, filesystem: true, decoded: { "manifest.v2.json": manifest(["host/quarter-hour/2026-02-30.v2.json"]) } };
  if (name === "future") {
    return { query: oneHour, now: NOW, filesystem: true, decoded: { "manifest.v2.json": manifest(["host/1h.v2.json"]), "host/1h.v2.json": futureChunk() } };
  }
  if (name === "member") {
    const bytes = pad(buildQuery(oneHour).decoded["host/1h.v2.json"] ?? Buffer.alloc(0), MEMBER_BYTES);
    return { query: oneHour, now: NOW, filesystem: true, decoded: { "manifest.v2.json": manifest(["host/1h.v2.json"]), "host/1h.v2.json": bytes } };
  }
  if (name === "manifest-cap") {
    return { query: oneHour, now: NOW, filesystem: true, decoded: { "manifest.v2.json": pad(manifest(["host/1h.v2.json"]), MANIFEST_CAP_BYTES) } };
  }
  const files = Array.from({ length: 10 }, (_, index) => "host/quarter-hour/2026-07-" + String(index + 1).padStart(2, "0") + ".v2.json");
  const padding = Buffer.from(JSON.stringify({ padding: "x".repeat(3_500_000) }));
  if (padding.byteLength !== AGGREGATE_CHUNK_BYTES) throw new Error("aggregate fixture changed size");
  const decoded: Record<string, Buffer> = { "manifest.v2.json": manifest(files) };
  for (const file of files) decoded[file] = padding;
  return { query: month, now: AGGREGATE_NOW, filesystem: true, decoded, aggregateChunkBytes: AGGREGATE_CHUNK_BYTES };
}
