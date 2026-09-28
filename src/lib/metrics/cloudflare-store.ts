import { gunzipSync } from "node:zlib";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type SqlStore = {
  exec(query: string, ...bindings: string[]): { toArray(): Record<string, unknown>[] };
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
