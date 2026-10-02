import { gunzipSync } from "node:zlib";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export type SqlStore = {
  exec(query: string, ...bindings: (string | number | Uint8Array)[]): { toArray(): Record<string, unknown>[] };
};

export function readCloudflareMetric(filename: string): unknown | null {
  if (process.env.FRONTPAGE_CLOUDFLARE !== "1") return null;
  const sql = (getCloudflareContext().env as { FRONTPAGE_SQL?: SqlStore }).FRONTPAGE_SQL;
  if (!sql) throw new Error("Frontpage Durable Object storage is unavailable.");
  const row = sql.exec("SELECT data FROM metrics_snapshot WHERE name = ?", filename).toArray()[0];
  if (!row) {
    const error = new Error(`${filename} is missing.`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }
  return JSON.parse(gunzipSync(row.data as Uint8Array).toString("utf8"));
}

const V2_ROOT = "/cloudflare/metrics-v2/";

function cloudflareSql(): SqlStore {
  const sql = (getCloudflareContext().env as { FRONTPAGE_SQL?: SqlStore }).FRONTPAGE_SQL;
  if (!sql) throw new Error("Frontpage Durable Object storage is unavailable.");
  return sql;
}

export function isObservabilityV2Enabled(): boolean {
  if (process.env.FRONTPAGE_CLOUDFLARE !== "1") {
    return process.env.FRONTPAGE_OBSERVABILITY_V2 === "1";
  }
  return cloudflareSql().exec("SELECT enabled FROM metrics_v2_active WHERE id = 1").toArray()[0]?.enabled === 1;
}

export function getCloudflareMetricsRootV2(namespace: "public" | "owner"): string | undefined {
  return isObservabilityV2Enabled() ? V2_ROOT + namespace : undefined;
}

export function readCloudflareProjectionV2(root: string, relative: string, cap: number): unknown {
  if (![V2_ROOT + "public", V2_ROOT + "owner"].includes(root) || !isObservabilityV2Enabled()) {
    throw new Error("Cloudflare v2 projections are disabled.");
  }
  const name = root.slice(V2_ROOT.length) + "/" + relative;
  const row = cloudflareSql().exec(
    "SELECT f.data FROM metrics_v2_files f JOIN metrics_v2_active a ON f.hash = json_extract(a.files, ?) WHERE a.id = 1",
    '$."' + name + '"',
  ).toArray()[0];
  if (!row) {
    const error = new Error("Projection is unavailable.") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }
  return JSON.parse(gunzipSync(row.data as Uint8Array, { maxOutputLength: cap }).toString("utf8"));
}
