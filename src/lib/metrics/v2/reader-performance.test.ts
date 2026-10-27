import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import * as before from "./reader-before-slots.fixture";
import * as candidate from "./reader";
import {
  NOW, WINDOWS, buildFault, buildQuery, hostQuery, ramQuery,
} from "./reader-cloudflare-parity-fixtures";
import type { OwnerMetricsQuery } from "./queries";
import { parseSeriesV2 } from "./schema";
import { OBSERVABILITY_RANGES, type SeriesV2 } from "./types";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => { throw new Error("Native fixture must use local files only."); },
}));

const CAP_BYTES = 16 * 1024 * 1024;
const OUTPUT_CAP_BYTES = 1024 * 1024;
const WALL_MS = 120_000;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const digest = (value: unknown) => sha(JSON.stringify(value));

interface FixtureCase {
  name: string;
  query: OwnerMetricsQuery;
  decoded: Record<string, Buffer>;
  readFiles: string[];
  expected?: SeriesV2;
  error?: { name: string; code: string; message: string };
}

it("native reader fixed protocol: strict Date.parse gain after all controls", { timeout: WALL_MS }, () => {
  const started = performance.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-reader-slots-"));
  let outputBytes = 0;
  let writtenBytes = 0;
  let writtenFiles = 0;
  let invocations = 0;
  const emit = (record: unknown) => {
    const line = "FRONTPAGE_READER_NATIVE " + JSON.stringify(record);
    outputBytes += Buffer.byteLength(line + "\n");
    expect(outputBytes).toBeLessThanOrEqual(OUTPUT_CAP_BYTES);
    console.log(line);
  };
  const withinDeadline = () => expect(performance.now() - started).toBeLessThan(WALL_MS);
  try {
    vi.stubEnv("FRONTPAGE_CLOUDFLARE", "0");
    const cases: FixtureCase[] = [];
    for (const range of OBSERVABILITY_RANGES) {
      for (const query of [hostQuery(range), ramQuery(range)]) {
        const built = buildQuery(query);
        if (query.view === "workloads") {
          const identities = Array.from({ length: 17 }, (_, index) => ({
            id: index === 16 ? "untracked" : `workload-${index}`,
            label: index === 16 ? "Untracked" : `Workload ${index}`,
            unit: "bytes",
          }));
          for (const [name, bytes] of Object.entries(built.decoded)) {
            if (name === "manifest.v2.json") continue;
            const payload = parseSeriesV2(JSON.parse(bytes.toString("utf8")));
            payload.series = identities.map((identity, index) => ({
              ...identity, values: [...payload.series[index % 2].values],
            }));
            built.decoded[name] = Buffer.from(JSON.stringify(payload));
          }
          for (const [at, values] of built.expected) {
            built.expected.set(at, identities.map((_, index) => values[index % 2] ?? null));
          }
          built.series = identities;
        }
        const spec = WINDOWS[range];
        const first = Date.parse(spec.first);
        const timestamps = Array.from({ length: spec.cap }, (_, index) =>
          new Date(first + index * spec.resolution * 1000).toISOString());
        const series = built.series.map((identity, index) => ({
          ...identity,
          values: timestamps.map((timestamp) => built.expected.get(Date.parse(timestamp))?.[index] ?? null),
        }));
        const present = series.reduce((sum, item) => sum + item.values.filter((value) => value !== null).length, 0);
        const expected: SeriesV2 = {
          schema_version: 2, generated_at: "2026-07-12T18:59:00.000Z", range,
          resolution_seconds: spec.resolution, view: query.view, resource: query.resource,
          timestamps, series, coverage_percent: present / (timestamps.length * series.length) * 100,
          truncated: false,
        };
        expect(parseSeriesV2(expected)).toEqual(expected);
        expect(series.flatMap((item) => item.values)).not.toContain(987.5);
        expect(series.flatMap((item) => item.values)).not.toContain(111.1);
        cases.push({ name: `${range}-${query.view}`, query, decoded: built.decoded,
          readFiles: ["manifest.v2.json", ...built.expectedFiles], expected });
      }
    }
    const faults = [
      ["missing", "unavailable", "Projection file is unavailable.", ["manifest.v2.json"]],
      ["json", "invalid", "Projection contains invalid JSON.", ["manifest.v2.json", "host/1h.v2.json"]],
      ["traversal", "invalid", "Owner manifest contains a non-allowlisted path.", ["manifest.v2.json"]],
      ["duplicate", "invalid", "Owner manifest contains duplicate paths.", ["manifest.v2.json"]],
      ["date", "invalid", "Series manifest contains an invalid chunk date.", ["manifest.v2.json"]],
      ["future", "invalid", "Series timestamp is dated in the future.", ["manifest.v2.json", "host/1h.v2.json"]],
      ["member", "too_large", "Projection exceeds 4 MiB.", ["manifest.v2.json"]],
      ["manifest-cap", "too_large", "Projection exceeds 512 KiB.", []],
    ] as const;
    for (const [name, code, message, readFiles] of faults) {
      const fault = buildFault(name);
      expect(fault.filesystem).toBe(true);
      expect(fault.now).toEqual(NOW);
      cases.push({ name, query: fault.query, decoded: fault.decoded, readFiles: [...readFiles],
        error: { name: "ProjectionReadError", code, message } });
    }
    expect(cases).toHaveLength(16);
    const fixtureIdentity = createHash("sha256");
    for (const item of cases) {
      for (const [name, bytes] of Object.entries(item.decoded).sort(([a], [b]) => a.localeCompare(b))) {
        withinDeadline();
        writtenBytes += bytes.byteLength;
        writtenFiles += 1;
        expect(writtenBytes).toBeLessThanOrEqual(CAP_BYTES);
        expect(writtenFiles).toBeLessThanOrEqual(128);
        const destination = path.join(root, item.name, name);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, bytes, { flag: "wx" });
        expect(fs.statSync(destination).size).toBe(bytes.byteLength);
        expect(fs.readFileSync(destination)).toEqual(bytes);
        fixtureIdentity.update(JSON.stringify([item.name, name, bytes.byteLength, sha(bytes)]));
      }
    }
    const sourceFiles = [
      "./reader-before-slots.fixture.ts", "./reader.ts", "./reader-performance.test.ts",
      "./reader-cloudflare-parity-fixtures.ts", "./schema.ts", "./types.ts", "./queries.ts",
      "./paths.ts", "../cloudflare-store.ts", "../schema.ts", "../types.ts",
      "../../../../package.json", "../../../../pnpm-lock.yaml", "../../../../vitest.config.ts",
      "../../../../tsconfig.json", "../../../../.github/workflows/ci.yml",
    ];
    const sources = Object.fromEntries(sourceFiles.map((name) =>
      [name, sha(fs.readFileSync(new URL(name, import.meta.url)))]));
    expect(sources["./reader-before-slots.fixture.ts"]).toBe("40654e61a633ffcb5fa354ebf6bb0048c774ba6bddecb1e2013257cb51233343");
    const shape = cases.map((item) => ({ name: item.name, query: item.query,
      expected: item.expected ? digest(item.expected) : item.error, readFiles: item.readFiles }));
    const negative = structuredClone(cases[0].expected);
    if (!negative) throw new Error("Missing semantic control.");
    negative.series[0].values[0] = 987.5;
    expect(digest(negative)).not.toBe(digest(cases[0].expected));
    const shifted = structuredClone(cases[0].expected);
    if (!shifted) throw new Error("Missing timestamp control.");
    shifted.timestamps[0] = "2026-07-12T18:00:30.000Z";
    expect(digest(shifted)).not.toBe(digest(cases[0].expected));
    emit({ kind: "protocol", protocol: "frontpage-native-slots-v1", now: NOW.toISOString(), sources,
      fixtureSha256: fixtureIdentity.digest("hex"), shapeSha256: digest(shape), shape,
      node: process.versions, platform: process.platform, arch: process.arch,
      writtenBytes, writtenFiles, instrumentation: "Date.parse/openSync/readFileSync call-through spies; all timings instrumented",
      wallScope: "reader calls only; suiteWallMs also includes counters/assertions",
      cpuUnit: "microseconds", rssUnit: "bytes", rssScope: "current process snapshots and cumulative lifetime maxRSS, not query peak" });
    const parseSpy = vi.spyOn(Date, "parse");
    const openSpy = vi.spyOn(fs, "openSync");
    const readSpy = vi.spyOn(fs, "readFileSync");
    const readDigest = (buffers: Buffer[]) => digest(buffers.map((bytes) => [bytes.byteLength, sha(bytes)]));
    const invoke = (arm: "A" | "B", phase: string, pair: number, recorded: boolean) => {
      invocations += 1;
      const suiteStart = performance.now();
      const rssBeforeBytes = process.memoryUsage().rss;
      let wallMs = 0;
      let cpuUserUs = 0;
      let cpuSystemUs = 0;
      const rows = cases.map((item) => {
        withinDeadline();
        parseSpy.mockClear();
        openSpy.mockClear();
        readSpy.mockClear();
        const caseRoot = path.join(root, item.name);
        let value: SeriesV2 | undefined;
        let error: FixtureCase["error"];
        const cpuStart = process.cpuUsage();
        const callStart = performance.now();
        try {
          value = (arm === "B" ? before : candidate).readSeriesV2(caseRoot, item.query, NOW);
        } catch (caught) {
          if (!(caught instanceof before.ProjectionReadError) && !(caught instanceof candidate.ProjectionReadError)) throw caught;
          error = { name: caught.name, code: caught.code, message: caught.message };
        }
        wallMs += performance.now() - callStart;
        const cpu = process.cpuUsage(cpuStart);
        cpuUserUs += cpu.user;
        cpuSystemUs += cpu.system;
        const dateParseCalls = parseSpy.mock.calls.length;
        const buffers: Buffer[] = [];
        for (const read of readSpy.mock.results) {
          expect(read.type).toBe("return");
          expect(Buffer.isBuffer(read.value)).toBe(true);
          if (Buffer.isBuffer(read.value)) buffers.push(read.value);
        }
        const openAttempts: string[] = openSpy.mock.calls.map((call: Parameters<typeof fs.openSync>) => path.relative(caseRoot, String(call[0])));
        const readFiles = openAttempts.filter((_, index) => openSpy.mock.results[index]?.type === "return").slice(0, buffers.length);
        const row = { name: item.name, semanticSha256: digest(value ?? error), error: error ?? null,
          dateParseCalls, readCalls: readSpy.mock.calls.length,
          readBytes: buffers.reduce((sum, bytes) => sum + bytes.byteLength, 0), readSha256: readDigest(buffers), readFiles, openAttempts };
        expect(error).toEqual(item.error);
        expect(row.semanticSha256).toBe(digest(item.expected ?? item.error));
        expect(row.readCalls).toBe(item.readFiles.length);
        expect(row.readFiles).toEqual(item.readFiles);
        expect(row.readSha256).toBe(readDigest(item.readFiles.map((name) => item.decoded[name])));
        withinDeadline();
        return row;
      });
      const record = { kind: "invocation", invocation: invocations, phase, pair, arm,
        wallMs, cpuUserUs, cpuSystemUs, suiteWallMs: performance.now() - suiteStart,
        rssBeforeBytes, rssAfterBytes: process.memoryUsage().rss,
        processLifetimeMaxRssBytes: process.resourceUsage().maxRSS * 1024, rows };
      if (recorded) emit(record);
      return record;
    };
    const pilot: ReturnType<typeof invoke>[] = [];
    for (let pair = 0; pair < 5; pair += 1) {
      pilot.push(invoke("B", "pilot", pair, true), invoke("B", "pilot", pair, true));
    }
    for (const record of pilot) expect(record.rows).toEqual(pilot[0].rows);
    invoke("A", "warmup", 0, false);
    invoke("B", "warmup", 0, false);
    invoke("B", "warmup", 1, false);
    invoke("A", "warmup", 1, false);
    const measured: ReturnType<typeof invoke>[] = [];
    for (let pair = 0; pair < 10; pair += 1) {
      const order = pair % 2 === 0 ? ["A", "B"] as const : ["B", "A"] as const;
      for (const arm of order) measured.push(invoke(arm, "measured", pair, true));
    }
    for (const record of measured) {
      const reference = record.arm === "B" ? pilot[0] : measured.find((item) => item.arm === "A");
      expect(record.rows).toEqual(reference?.rows);
    }
    expect(invocations).toBe(34);
    expect(pilot).toHaveLength(10);
    expect(measured).toHaveLength(20);
    const total = (arm: "A" | "B") => measured.filter((item) => item.arm === arm)
      .reduce((sum, item) => sum + item.rows.reduce((calls, row) => calls + row.dateParseCalls, 0), 0);
    const baselineDateParseCalls = total("B");
    const candidateDateParseCalls = total("A");
    expect(baselineDateParseCalls).toBeGreaterThan(0);
    expect(candidateDateParseCalls).toBeGreaterThan(0);
    withinDeadline();
    parseSpy.mockRestore();
    openSpy.mockRestore();
    readSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
    expect(fs.existsSync(root)).toBe(false);
    vi.unstubAllEnvs();
    emit({ kind: "final-controls", invocations, pilotInvocations: 10, unrecordedWarmupInvocations: 4,
      measuredInvocations: 20, baselineDateParseCalls, candidateDateParseCalls,
      semanticAndErrorParity: true, baselineControls: true, rawRetained: true, rootRemoved: true,
      totalWallMs: performance.now() - started, outputBytesBeforeFinalRecord: outputBytes,
      uninstrumentedLatencyMs: null });
    expect(candidateDateParseCalls, "STRICT_COUNTER_GAIN: native candidate must use fewer actual Date.parse calls").toBeLessThan(baselineDateParseCalls);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
