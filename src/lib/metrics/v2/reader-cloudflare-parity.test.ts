import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { SqlStore } from "../cloudflare-store";
import { initializeCloudflareV2 } from "./cloudflare-upload";
import {
  AGGREGATE_CHUNK_BYTES,
  CASE_BYTE_CAP,
  EXPECT,
  FILE_BYTE_CAP,
  NOW,
  WINDOWS,
  buildFault,
  buildQuery,
  hostQuery,
  ramQuery,
  type BuiltQuery,
  type FaultName,
} from "./reader-cloudflare-parity-fixtures";
import type { OwnerMetricsQuery } from "./queries";
import { ProjectionReadError, getOwnerMetricsRootV2, readSeriesV2 } from "./reader";
import type { SeriesV2 } from "./types";

const state = vi.hoisted(() => ({ active: false, decodedBytes: 0, parseCalls: 0, manifestRows: 0, chunkRows: 0 }));
const context: { env: { FRONTPAGE_SQL?: SqlStore } } = vi.hoisted(() => ({ env: {} }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => context }));
vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  const gunzipSync = ((data: Parameters<typeof actual.gunzipSync>[0], options?: Parameters<typeof actual.gunzipSync>[1]) => {
    if (options && typeof options === "object" && "info" in options && options.info === true) {
      const result = actual.gunzipSync(data, { ...options, info: true });
      if (state.active) {
        if (!Buffer.isBuffer(result.buffer)) throw new Error("CF gunzip info result has no Buffer");
        state.decodedBytes += result.buffer.length;
      }
      return result;
    }
    return options === undefined ? actual.gunzipSync(data) : actual.gunzipSync(data, options);
  }) as typeof actual.gunzipSync;
  return { ...actual, gunzipSync };
});
vi.mock("./schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./schema")>();
  return {
    ...actual,
    parseSeriesV2(...args: Parameters<typeof actual.parseSeriesV2>) {
      const parsed = actual.parseSeriesV2(...args);
      if (state.active) state.parseCalls += 1;
      return parsed;
    },
  };
});

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (name: string) => {
    prepare(query: string): {
      all(...values: (string | number | Uint8Array)[]): Record<string, unknown>[];
      run(...values: (string | number | Uint8Array)[]): unknown;
    };
    close(): void;
  };
};
type Database = InstanceType<typeof DatabaseSync>;
const databases: Database[] = [];
const roots: string[] = [];
let writtenBytes = 0;
const FILE_SELECT = "SELECT f.data FROM metrics_v2_files f JOIN metrics_v2_active a";

function snapshotCounters() {
  return { manifestRows: state.manifestRows, chunkRows: state.chunkRows, parseCalls: state.parseCalls, decodedBytes: state.decodedBytes };
}

function measure<T>(fn: () => T): { result?: T; error?: unknown; counters: ReturnType<typeof snapshotCounters> } {
  state.decodedBytes = 0;
  state.parseCalls = 0;
  state.manifestRows = 0;
  state.chunkRows = 0;
  state.active = true;
  try {
    return { result: fn(), counters: snapshotCounters() };
  } catch (error) {
    return { error, counters: snapshotCounters() };
  } finally {
    state.active = false;
  }
}

function storeFor(database: Database): SqlStore {
  return {
    exec(query, ...bindings) {
      const statement = database.prepare(query);
      if (!query.startsWith("SELECT")) {
        statement.run(...bindings);
        return { toArray: () => [] };
      }
      const rows = statement.all(...bindings);
      if (state.active && query.startsWith(FILE_SELECT)) {
        if (bindings[0] === '$."owner/manifest.v2.json"') state.manifestRows += rows.length;
        else state.chunkRows += rows.length;
      }
      return { toArray: () => rows };
    },
  };
}

function put(sql: SqlStore, decoded: Record<string, Buffer>, rawChunk?: Buffer): void {
  const files: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(decoded)) {
    if (rawChunk && name === "host/1h.v2.json") continue;
    const stored = gzipSync(bytes);
    const hash = createHash("sha256").update(stored).digest("hex");
    sql.exec("INSERT INTO metrics_v2_files (hash, data, uploaded_at) VALUES (?, ?, ?) ON CONFLICT(hash) DO UPDATE SET uploaded_at = excluded.uploaded_at", hash, stored, 0);
    files["owner/" + name] = hash;
  }
  if (rawChunk) {
    const hash = createHash("sha256").update(rawChunk).digest("hex");
    sql.exec("INSERT INTO metrics_v2_files (hash, data, uploaded_at) VALUES (?, ?, ?) ON CONFLICT(hash) DO UPDATE SET uploaded_at = excluded.uploaded_at", hash, rawChunk, 0);
    files["owner/host/1h.v2.json"] = hash;
  }
  sql.exec("DELETE FROM metrics_v2_active");
  sql.exec("INSERT INTO metrics_v2_active (id, files, collected_at, enabled) VALUES (1, ?, ?, 1)", JSON.stringify(files), "2026-07-12T18:59:30.000Z");
  context.env = { FRONTPAGE_SQL: sql };
}

function openStore(decoded: Record<string, Buffer>, rawChunk?: Buffer): { database: Database; sql: SqlStore } {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const sql = storeFor(database);
  initializeCloudflareV2(sql);
  put(sql, decoded, rawChunk);
  return { database, sql };
}

function writeFs(decoded: Record<string, Buffer>, root = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-v2-parity-"))): { root: string; bytes: number } {
  if (!roots.includes(root)) roots.push(root);
  let bytes = 0;
  for (const [name, body] of Object.entries(decoded)) {
    const destination = path.join(root, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, body);
    bytes += body.byteLength;
  }
  writtenBytes += bytes;
  expect(bytes).toBeLessThanOrEqual(CASE_BYTE_CAP);
  expect(writtenBytes).toBeLessThanOrEqual(FILE_BYTE_CAP);
  return { root, bytes };
}

function readFs(root: string, query: OwnerMetricsQuery, now: Date): SeriesV2 {
  delete process.env.FRONTPAGE_CLOUDFLARE;
  return readSeriesV2(root, query, now);
}

function readCf(query: OwnerMetricsQuery, now: Date): SeriesV2 {
  process.env.FRONTPAGE_CLOUDFLARE = "1";
  try {
    const root = getOwnerMetricsRootV2();
    if (root === undefined) throw new Error("owner root missing");
    return readSeriesV2(root, query, now);
  } finally {
    delete process.env.FRONTPAGE_CLOUDFLARE;
  }
}

function digest(value: SeriesV2): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertFixtureMapped(result: SeriesV2, built: BuiltQuery): void {
  const spec = WINDOWS[built.query.range];
  expect(result).toMatchObject({ range: built.query.range, view: built.query.view, resource: built.query.resource, resolution_seconds: spec.resolution, truncated: false });
  expect(result.timestamps).toHaveLength(spec.cap);
  expect(result.timestamps[0]).toBe(spec.first);
  expect(result.timestamps[spec.cap - 1]).toBe(spec.last);
  const step = spec.resolution * 1000;
  result.timestamps.forEach((timestamp, index) => {
    const current = Date.parse(timestamp);
    expect(current % step).toBe(0);
    if (index > 0) expect(current - Date.parse(result.timestamps[index - 1] ?? "")).toBe(step);
  });
  for (const [seriesIndex, identity] of built.series.entries()) {
    const actual = result.series.find((item) => item.id === identity.id);
    expect(actual).toMatchObject(identity);
    expect(actual?.values).toEqual(result.timestamps.map((timestamp) => built.expected.get(Date.parse(timestamp))?.[seriesIndex] ?? null));
  }
  const values = result.series.flatMap((item) => item.values);
  expect(values).not.toContain(987.5);
  expect(values).not.toContain(111.1);
  const present = values.filter((value) => value !== null).length;
  expect(result.coverage_percent).toBe((present / values.length) * 100);
}

function codeOf(fn: () => void): ProjectionReadError {
  try { fn(); } catch (error) {
    expect(error).toBeInstanceOf(ProjectionReadError);
    if (error instanceof ProjectionReadError) return error;
  }
  throw new Error("did not throw");
}

function copySeries(result: SeriesV2): SeriesV2 {
  return structuredClone(result);
}

function reseed(sql: SqlStore, root?: string): void {
  const built = buildQuery(hostQuery("1h"));
  sql.exec("DELETE FROM metrics_v2_files");
  put(sql, built.decoded);
  if (root) readFs(writeFs(built.decoded, root).root, built.query, NOW);
  const measured = measure(() => readCf(built.query, NOW));
  if (measured.error) throw measured.error;
}

function alterChunk(built: BuiltQuery): Record<string, Buffer> {
  const copy = Object.fromEntries(Object.entries(built.decoded).map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const name = built.expectedFiles[0];
  const bytes = name ? copy[name] : undefined;
  if (!name || !bytes) throw new Error("missing chunk");
  const payload: unknown = JSON.parse(bytes.toString("utf8"));
  if (typeof payload !== "object" || payload === null || !("series" in payload) || !Array.isArray(payload.series)) throw new Error("chunk shape");
  const series = payload.series[0];
  if (typeof series !== "object" || series === null || !("values" in series) || !Array.isArray(series.values)) throw new Error("series shape");
  series.values[0] = typeof series.values[0] === "number" ? series.values[0] + 1 : 1;
  copy[name] = Buffer.from(JSON.stringify(payload));
  return copy;
}

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  delete process.env.FRONTPAGE_CLOUDFLARE;
});

afterAll(() => { expect(roots.filter((root) => fs.existsSync(root))).toEqual([]); });

describe("fixed-clock Node/SQLite adapter parity", () => {
  function run(query: OwnerMetricsQuery, negative = false): void {
    const built = buildQuery(query);
    const written = writeFs(built.decoded);
    const opened = openStore(built.decoded);
    const filesystem = readFs(written.root, query, NOW);
    const measured = measure(() => readCf(query, NOW));
    expect(measured.error).toBeUndefined();
    if (!measured.result) throw new Error("missing result");
    const result = measured.result;
    expect(digest(filesystem)).toBe(digest(result));
    assertFixtureMapped(result, built);
    expect(measured.counters).toEqual({ manifestRows: 1, chunkRows: WINDOWS[query.range].chunkRows, parseCalls: WINDOWS[query.range].parseCalls, decodedBytes: built.decodedBytesExpected });
    if (!negative) return;
    const changed = copySeries(result);
    const changedValues = changed.series[0]?.values;
    if (!changedValues) throw new Error("missing series");
    changedValues[0] = typeof changedValues[0] === "number" ? changedValues[0] + 1 : 1;
    const shifted = copySeries(result);
    const first = shifted.timestamps[0];
    if (!first) throw new Error("missing timestamp");
    shifted.timestamps[0] = new Date(Date.parse(first) + WINDOWS[query.range].resolution * 1000).toISOString();
    const injected = copySeries(result);
    const injectedValues = injected.series[0]?.values;
    if (!injectedValues) throw new Error("missing series");
    injectedValues[0] = 987.5;
    expect(() => assertFixtureMapped(changed, built)).toThrow();
    expect(() => assertFixtureMapped(shifted, built)).toThrow();
    expect(() => assertFixtureMapped(injected, built)).toThrow();
    openStore(alterChunk(built));
    const cross = measure(() => readCf(query, NOW));
    expect(cross.error).toBeUndefined();
    const crossResult = cross.result;
    if (!crossResult) throw new Error("missing cross result");
    expect(digest(crossResult)).not.toBe(digest(filesystem));
    expect(() => assertFixtureMapped(crossResult, built)).toThrow();
    reseed(opened.sql, written.root);
  }

  it("fixed-clock adapter parity: 1h host", { timeout: 60_000 }, () => run(hostQuery("1h"), true));
  it("fixed-clock adapter parity: 1h workloads ram", { timeout: 60_000 }, () => run(ramQuery("1h")));
  it("fixed-clock adapter parity: 24h host", { timeout: 60_000 }, () => run(hostQuery("24h")));
  it("fixed-clock adapter parity: 24h workloads ram", { timeout: 60_000 }, () => run(ramQuery("24h")));
  it("fixed-clock adapter parity: 7d host", { timeout: 60_000 }, () => run(hostQuery("7d")));
  it("fixed-clock adapter parity: 7d workloads ram", { timeout: 60_000 }, () => run(ramQuery("7d")));
  it("fixed-clock adapter parity: 30d host", { timeout: 60_000 }, () => run(hostQuery("30d")));
  it("fixed-clock adapter parity: 30d workloads ram", { timeout: 60_000 }, () => run(ramQuery("30d")));
});

describe("fault codes", () => {
  function runFault(name: FaultName): void {
    const fault = buildFault(name);
    if (fault.rawChunks) {
      const opened = openStore(fault.decoded, fault.rawChunks[0]);
      for (const rawChunk of fault.rawChunks) {
        put(opened.sql, fault.decoded, rawChunk);
        const measured = measure(() => readCf(fault.query, fault.now));
        expect(measured.error).toBeInstanceOf(ProjectionReadError);
        if (!(measured.error instanceof ProjectionReadError)) throw new Error("did not throw");
        expect(measured.error.code).toBe(EXPECT[name]);
      }
      reseed(opened.sql);
      return;
    }
    const written = writeFs(fault.decoded);
    if (name === "aggregate") {
      const manifestBytes = fault.decoded["manifest.v2.json"]?.byteLength ?? 0;
      expect(manifestBytes).toBeGreaterThan(0);
      expect(manifestBytes).toBeLessThan(1000);
      expect(written.bytes).toBe(10 * AGGREGATE_CHUNK_BYTES + manifestBytes);
    }
    const opened = openStore(fault.decoded);
    expect(codeOf(() => readFs(written.root, fault.query, fault.now)).code).toBe(EXPECT[name]);
    const measured = measure(() => readCf(fault.query, fault.now));
    expect(measured.error).toBeInstanceOf(ProjectionReadError);
    if (!(measured.error instanceof ProjectionReadError)) throw new Error("did not throw");
    expect(measured.error.code).toBe(EXPECT[name]);
    if (name === "aggregate") {
      const manifestBytes = fault.decoded["manifest.v2.json"]?.byteLength ?? 0;
      expect(measured.counters).toEqual({ manifestRows: 1, chunkRows: 10, parseCalls: 0, decodedBytes: manifestBytes + 9 * AGGREGATE_CHUNK_BYTES });
    }
    reseed(opened.sql, written.root);
  }

  it("fault code: missing", { timeout: 60_000 }, () => runFault("missing"));
  it("fault code: json", { timeout: 60_000 }, () => runFault("json"));
  it("fault code: gzip CF-only", { timeout: 60_000 }, () => runFault("gzip"));
  it("fault code: traversal", { timeout: 60_000 }, () => runFault("traversal"));
  it("fault code: duplicate", { timeout: 60_000 }, () => runFault("duplicate"));
  it("fault code: date", { timeout: 60_000 }, () => runFault("date"));
  it("fault code: future", { timeout: 60_000 }, () => runFault("future"));
  it("fault code: member", { timeout: 60_000 }, () => runFault("member"));
  it("fault code: manifest-cap", { timeout: 60_000 }, () => runFault("manifest-cap"));
  it("fault code: aggregate", { timeout: 60_000 }, () => runFault("aggregate"));
});
