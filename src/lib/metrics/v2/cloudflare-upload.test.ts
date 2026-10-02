import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { initializeCloudflareV2, uploadCloudflareV2 } from "./cloudflare-upload";
import { getOwnerMetricsRootV2, getPublicMetricsRootV2, readOwnerLatestV2, readPublicLatestV2, readSeriesV2 } from "./reader";
import type { SqlStore } from "../cloudflare-store";

const context = vi.hoisted(() => ({ env: {} }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => context }));
// Node 22 SQLite exercises the real SQL without another database dependency.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (name: string) => { prepare(query: string): { all(...values: (string | number | Uint8Array)[]): Record<string, unknown>[] }; exec(query: string): void; close(): void };
};
const version = "a".repeat(40);
const now = new Date("2026-07-12T19:00:00Z");
const fixtureRoot = path.join(process.cwd(), "ops/tests/fixtures/observability-v2");
const databases: InstanceType<typeof DatabaseSync>[] = [];
function store() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const sql: SqlStore = { exec: (query, ...values) => { const rows = database.prepare(query).all(...values); return { toArray: () => rows }; } };
  initializeCloudflareV2(sql);
  context.env = { FRONTPAGE_SQL: sql };
  process.env.FRONTPAGE_CLOUDFLARE = "1";
  vi.useFakeTimers();
  vi.setSystemTime(now);
  return { sql, transactionSync<T>(callback: () => T): T {
    database.exec("BEGIN");
    try { const result = callback(); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  } };
}
function fixture(name: string) { return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8")); }
function snapshot() {
  const publicLatest = fixture("public-latest.json");
  const ownerLatest = fixture("owner-latest.json");
  const series = fixture("host-series-1h.json");
  const generated = publicLatest.generated_at;
  ownerLatest.generated_at = generated;
  ownerLatest.collected_at = publicLatest.collected_at;
  series.generated_at = generated;
  const incidents = { schema_version: 2, generated_at: generated, incidents: [] };
  return {
    "public/latest.v2.json": publicLatest,
    "public/incidents.v2.json": incidents,
    "owner/latest.v2.json": ownerLatest,
    "owner/incidents.v2.json": incidents,
    "owner/host/1h.v2.json": series,
    "owner/manifest.v2.json": { schema_version: 2, files: ["latest.v2.json", "incidents.v2.json", "host/1h.v2.json"] },
  };
}
function request(action: string, payload: unknown) {
  return new Request("https://example.test/__collector/v2/" + action, { method: "PUT", body: JSON.stringify(payload) });
}
async function stage(storage: ReturnType<typeof store>, payloads = snapshot()) {
  const files: Record<string, string> = {};
  for (const [name, payload] of Object.entries(payloads)) {
    const bytes = Buffer.from(JSON.stringify(payload));
    const hash = createHash("sha256").update(bytes).digest("hex");
    files[name] = hash;
    expect((await uploadCloudflareV2(new Request("https://example.test/__collector/v2/" + hash, { method: "PUT", body: gzipSync(bytes) }), storage, version)).status).toBe(204);
  }
  return { schema_version: 2, files };
}
function acceptedGate() {
  const end = new Date(now.getTime() - 60_000).toISOString();
  const start = new Date(Date.parse(end) - 48 * 3_600_000).toISOString();
  return { schema_version: 3, approved: true, generated_at: now.toISOString(), evidence_started_at: start,
    window_started_at: start, window_ended_at: end, duration_hours: 48, paired_minutes: 2881,
    missed_minutes: 0, incomplete_v1_host_minutes: 0, incomplete_v2_host_minutes: 0, maximum_gap_seconds: 60, evidence_age_seconds: 60,
    p99_relative_divergence_percent: { cpu: 0.1, ram: 0.1, disk: 0.1 }, public_service_comparisons: 17286, public_service_mismatch_percent: 0,
    evidence_epoch: { schema_version: 1, started_at: start, commit_sha: version, reason: "collector_or_comparator_change" },
    thresholds: { minimum_duration_hours: 48, maximum_gap_seconds: 120, maximum_evidence_age_seconds: 120, maximum_p99_relative_divergence_percent: 2, public_service_mismatch_percent: 0 } };
}
afterEach(() => { databases.splice(0).forEach((database) => database.close()); vi.useRealTimers(); delete process.env.FRONTPAGE_CLOUDFLARE; });

it("stages and atomically commits complete projections, stays disabled, then reads through existing strict public/owner/series readers after fresh acceptance", async () => {
  const storage = store();
  const manifest = await stage(storage);
  expect((await uploadCloudflareV2(request("prepare", manifest), storage, version)).status).toBe(200);
  expect((await uploadCloudflareV2(request("commit", manifest), storage, version)).status).toBe(204);
  expect(getPublicMetricsRootV2()).toBeUndefined();
  expect(getOwnerMetricsRootV2()).toBeUndefined();
  expect((await uploadCloudflareV2(request("activate", { version, gate: acceptedGate() }), storage, version)).status).toBe(204);
  expect(readPublicLatestV2(getPublicMetricsRootV2(), now).data?.services).toBeDefined();
  expect(readOwnerLatestV2(getOwnerMetricsRootV2(), now).data?.workloads).toHaveLength(2);
  expect(readSeriesV2(getOwnerMetricsRootV2(), { range: "1h", view: "host", resource: null }, now).view).toBe("host");
  expect((await uploadCloudflareV2(request("deactivate", {}), storage, version)).status).toBe(204);
  expect(getPublicMetricsRootV2()).toBeUndefined();
});

it("rejects partial commits and public owner payloads without changing the committed snapshot", async () => {
  const storage = store();
  const manifest = await stage(storage);
  expect((await uploadCloudflareV2(request("commit", manifest), storage, version)).status).toBe(204);
  const before = storage.sql.exec("SELECT files FROM metrics_v2_active").toArray();
  const missing = { ...manifest, files: { ...manifest.files, "owner/host/1h.v2.json": "f".repeat(64) } };
  expect((await uploadCloudflareV2(request("commit", missing), storage, version)).status).toBe(400);
  const payloads = snapshot();
  payloads["public/latest.v2.json"] = payloads["owner/latest.v2.json"];
  expect((await uploadCloudflareV2(request("commit", await stage(storage, payloads)), storage, version)).status).toBe(400);
  expect(storage.sql.exec("SELECT files FROM metrics_v2_active").toArray()).toEqual(before);
});

it("rejects forged approval booleans, relaxed thresholds, stale receipts, stale snapshots and wrong production SHA", async () => {
  const storage = store();
  const manifest = await stage(storage);
  expect((await uploadCloudflareV2(request("commit", manifest), storage, version)).status).toBe(204);
  for (const change of [{ approved: false }, { missed_minutes: 1 }, { duration_hours: 47 }, { paired_minutes: 2880 },
    { p99_relative_divergence_percent: { cpu: 2, ram: 0, disk: 0 } },
    { thresholds: { ...acceptedGate().thresholds, minimum_duration_hours: 1 } },
    { generated_at: "2026-07-12T18:57:00Z" }]) {
    expect((await uploadCloudflareV2(request("activate", { version, gate: { ...acceptedGate(), ...change } }), storage, version)).status).toBe(400);
  }
  expect((await uploadCloudflareV2(request("activate", { version: "b".repeat(40), gate: acceptedGate() }), storage, version)).status).toBe(400);
  vi.setSystemTime(new Date(now.getTime() + 60_000));
  expect((await uploadCloudflareV2(request("activate", { version, gate: acceptedGate() }), storage, version)).status).toBe(400);
  expect(getPublicMetricsRootV2()).toBeUndefined();
});

it("rejects traversal, hash mismatch, decompression bombs and streamed oversized uploads", async () => {
  const storage = store();
  expect((await uploadCloudflareV2(request("prepare", { schema_version: 2, files: { "owner/../private.sqlite3": "f".repeat(64) } }), storage, version)).status).toBe(400);
  for (const body of [gzipSync("{}"), gzipSync(Buffer.alloc(4 * 1024 * 1024 + 1))]) {
    expect((await uploadCloudflareV2(new Request("https://example.test/__collector/v2/" + "f".repeat(64), { method: "PUT", body }), storage, version)).status).toBe(400);
  }
  expect((await uploadCloudflareV2(new Request("https://example.test/__collector/v2/" + "f".repeat(64), { method: "PUT", body: Buffer.alloc(1024 * 1024 + 1) }), storage, version)).status).toBe(413);
});
