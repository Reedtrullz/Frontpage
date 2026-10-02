import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { SqlStore } from "../cloudflare-store";
import { MANIFEST_PATH_PATTERN, projectionCap } from "./paths";
import { parseIncidentListV2, parseOwnerLatestV2, parsePublicLatestV2, parseSeriesV2 } from "./schema";

const MiB = 1024 * 1024;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.object({
  schema_version: z.literal(2),
  files: z.record(z.string(), hashSchema),
}).strict().refine(({ files }) => Object.keys(files).length >= 5 && Object.keys(files).length <= 259
  && Object.keys(files).every((name) => name === "owner/manifest.v2.json"
    || /^public\/(latest|incidents)\.v2\.json$/.test(name)
    || (name.startsWith("owner/") && MANIFEST_PATH_PATTERN.test(name.slice(6)))), "Invalid projection paths");
const dateSchema = z.string().datetime();
const gateSchema = z.object({
  schema_version: z.literal(3), approved: z.literal(true), generated_at: dateSchema,
  evidence_started_at: dateSchema, window_started_at: dateSchema, window_ended_at: dateSchema,
  duration_hours: z.number().min(48), paired_minutes: z.number().int().min(2881),
  missed_minutes: z.literal(0), incomplete_v1_host_minutes: z.literal(0), incomplete_v2_host_minutes: z.literal(0),
  maximum_gap_seconds: z.number().min(0).max(120), evidence_age_seconds: z.number().min(0).max(120),
  p99_relative_divergence_percent: z.object({ cpu: z.number().min(0).lt(2), ram: z.number().min(0).lt(2), disk: z.number().min(0).lt(2) }).strict(),
  public_service_comparisons: z.number().int().positive(), public_service_mismatch_percent: z.literal(0),
  evidence_epoch: z.object({ schema_version: z.literal(1), started_at: dateSchema, commit_sha: z.string().regex(/^[a-f0-9]{40}$/), reason: z.string().min(1) }).strict(),
  thresholds: z.object({ minimum_duration_hours: z.literal(48), maximum_gap_seconds: z.literal(120), maximum_evidence_age_seconds: z.literal(120), maximum_p99_relative_divergence_percent: z.literal(2), public_service_mismatch_percent: z.literal(0) }).strict(),
});

type Storage = { sql: SqlStore; transactionSync<T>(callback: () => T): T };
export function initializeCloudflareV2(sql: SqlStore): void {
  sql.exec("CREATE TABLE IF NOT EXISTS metrics_v2_files (hash TEXT PRIMARY KEY, data BLOB NOT NULL, uploaded_at INTEGER NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS metrics_v2_active (id INTEGER PRIMARY KEY CHECK(id = 1), files TEXT NOT NULL, collected_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, acceptance TEXT)");
}

function decoded(sql: SqlStore, hash: string, cap: number): Buffer {
  const row = sql.exec("SELECT data FROM metrics_v2_files WHERE hash = ?", hash).toArray()[0];
  if (!row) throw new Error("Missing projection");
  return gunzipSync(row.data as Uint8Array, { maxOutputLength: cap });
}

function validateSnapshot(sql: SqlStore, files: Record<string, string>, now: number): string {
  let total = 0;
  let collectedAt = "";
  let ownerGeneratedAt = "";
  let publicGeneratedAt = "";
  let ownerFiles: string[] = [];
  for (const required of ["public/latest.v2.json", "public/incidents.v2.json", "owner/latest.v2.json", "owner/incidents.v2.json", "owner/manifest.v2.json"]) {
    if (!files[required]) throw new Error("Missing required projection");
  }
  for (const [name, hash] of Object.entries(files)) {
    const relative = name.slice(name.indexOf("/") + 1);
    const bytes = decoded(sql, hash, projectionCap(relative));
    total += bytes.length;
    if (total > 32 * MiB) throw new Error("Snapshot exceeds 32 MiB");
    const payload = JSON.parse(bytes.toString("utf8"));
    if (name === "owner/manifest.v2.json") {
      ownerFiles = z.object({ schema_version: z.literal(2), files: z.array(z.string().regex(MANIFEST_PATH_PATTERN)).max(256) }).strict().parse(payload).files;
      if (new Set(ownerFiles).size !== ownerFiles.length) throw new Error("Duplicate manifest paths");
    } else {
      const parsed = relative === "latest.v2.json"
        ? name.startsWith("public/") ? parsePublicLatestV2(payload) : parseOwnerLatestV2(payload)
        : relative === "incidents.v2.json" ? parseIncidentListV2(payload) : parseSeriesV2(payload);
      if (Date.parse(parsed.generated_at) > now) throw new Error("Future projection");
      if ("timestamps" in parsed && parsed.timestamps.some((timestamp) => Date.parse(timestamp) > now)) throw new Error("Future series");
      if (name.startsWith("public/") && "incidents" in parsed && parsed.incidents.some((incident) => incident.visibility !== "public")) throw new Error("Owner incident in public projection");
      if (name === "public/latest.v2.json" && "collected_at" in parsed) {
        collectedAt = parsed.collected_at;
        publicGeneratedAt = parsed.generated_at;
      }
      if (name === "owner/latest.v2.json" && "collected_at" in parsed) {
        if (payload.collected_at !== collectedAt && collectedAt) throw new Error("Latest projections disagree");
        ownerGeneratedAt = parsed.generated_at;
      }
    }
  }
  const actualOwnerFiles = Object.keys(files).filter((name) => name.startsWith("owner/") && name !== "owner/manifest.v2.json").map((name) => name.slice(6));
  if (actualOwnerFiles.length !== ownerFiles.length || ownerFiles.some((name) => !files["owner/" + name])) throw new Error("Incomplete owner manifest");
  const owner = parseOwnerLatestV2(JSON.parse(decoded(sql, files["owner/latest.v2.json"], 512 * 1024).toString("utf8")));
  if (owner.collected_at !== collectedAt || ownerGeneratedAt !== publicGeneratedAt || now - Date.parse(collectedAt) > 45_000 || Date.parse(collectedAt) > now) throw new Error("Snapshot is stale or inconsistent");
  return collectedAt;
}

// Caller authenticates the shared collector secret before reading any request body.
export async function uploadCloudflareV2(request: Request, storage: Storage, version: string): Promise<Response> {
  const action = new URL(request.url).pathname.slice("/__collector/v2/".length);
  const hash = hashSchema.safeParse(action);
  if (!["prepare", "commit", "activate", "deactivate"].includes(action) && !hash.success) return new Response("Not found", { status: 404 });
  if (action === "deactivate") {
    await request.body?.cancel();
    storage.sql.exec("UPDATE metrics_v2_active SET enabled = 0 WHERE id = 1");
    return new Response(null, { status: 204 });
  }
  // Stream limits apply even when Content-Length is absent or untrusted.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (reader) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > (hash.success ? MiB : 512 * 1024)) {
      await reader.cancel();
      return new Response("Payload too large", { status: 413 });
    }
    chunks.push(chunk.value);
  }
  const body = Buffer.concat(chunks);
  try {
    if (hash.success) {
      const bytes = gunzipSync(body, { maxOutputLength: 4 * MiB });
      JSON.parse(bytes.toString("utf8"));
      if (createHash("sha256").update(bytes).digest("hex") !== action) throw new Error("Hash mismatch");
      storage.transactionSync(() => {
        storage.sql.exec("DELETE FROM metrics_v2_files WHERE uploaded_at < ? AND hash NOT IN (SELECT value FROM metrics_v2_active, json_each(files))", Date.now() - 600_000);
        const usage = storage.sql.exec("SELECT count(*) AS files, coalesce(sum(length(data)), 0) AS bytes FROM metrics_v2_files").toArray()[0];
        if (Number(usage.files) >= 520 || Number(usage.bytes) + body.length > 64 * MiB) throw new Error("Staging quota exceeded");
        storage.sql.exec("INSERT INTO metrics_v2_files (hash, data, uploaded_at) VALUES (?, ?, ?) ON CONFLICT(hash) DO UPDATE SET uploaded_at = excluded.uploaded_at", action, body, Date.now());
      });
      return new Response(null, { status: 204 });
    }
    const payload = JSON.parse(body.toString("utf8"));
    if (action === "activate") {
      const input = z.object({ version: z.string().regex(/^[a-f0-9]{40}$/), gate: gateSchema }).strict().parse(payload);
      const gate = input.gate;
      const now = Date.now();
      const end = Date.parse(gate.window_ended_at);
      const start = Date.parse(gate.window_started_at);
      if (input.version !== version || now - Date.parse(gate.generated_at) < 0 || now - Date.parse(gate.generated_at) > 120_000 || now - end < 0 || now - end > 120_000 || end - start < 48 * 3_600_000 || start < Date.parse(gate.evidence_started_at) || Date.parse(gate.evidence_started_at) < Date.parse(gate.evidence_epoch.started_at) || gate.paired_minutes !== (end - start) / 60_000 + 1) throw new Error("Acceptance is stale or inconsistent");
      storage.transactionSync(() => {
        const active = storage.sql.exec("SELECT files FROM metrics_v2_active WHERE id = 1").toArray()[0];
        if (!active) throw new Error("No staged snapshot");
        validateSnapshot(storage.sql, JSON.parse(String(active.files)), now);
        storage.sql.exec("UPDATE metrics_v2_active SET enabled = 1, acceptance = ? WHERE id = 1", JSON.stringify(payload));
      });
      return new Response(null, { status: 204 });
    }
    const { files } = manifestSchema.parse(payload);
    if (action === "prepare") {
      const missing = [...new Set(Object.values(files))].filter((value) => !storage.sql.exec("SELECT hash FROM metrics_v2_files WHERE hash = ?", value).toArray().length);
      return Response.json({ missing }, { headers: { "Cache-Control": "private, no-store" } });
    }
    storage.transactionSync(() => {
      const collectedAt = validateSnapshot(storage.sql, files, Date.now());
      const active = storage.sql.exec("SELECT collected_at FROM metrics_v2_active WHERE id = 1").toArray()[0];
      if (active && Date.parse(String(active.collected_at)) > Date.parse(collectedAt)) throw new Error("Out-of-order snapshot");
      storage.sql.exec("INSERT INTO metrics_v2_active (id, files, collected_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET files = excluded.files, collected_at = excluded.collected_at", JSON.stringify(files), collectedAt);
      storage.sql.exec("DELETE FROM metrics_v2_files WHERE hash NOT IN (SELECT value FROM metrics_v2_active, json_each(files))");
    });
    return new Response(null, { status: 204 });
  } catch {
    return new Response("Invalid or incomplete v2 snapshot or acceptance", { status: 400 });
  }
}
