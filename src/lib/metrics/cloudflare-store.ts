import { gunzipSync } from "node:zlib";
import {parseMetricsSnapshot,parseMetricsHistory} from "./schema";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export type SqlStore = {
  exec(query: string, ...bindings: (string | number | Uint8Array)[]): { toArray(): Record<string, unknown>[] };
};

export function readCloudflareMetric(filename: string): unknown | null {
  if (process.env.FRONTPAGE_CLOUDFLARE !== "1") return null;
  const sql = (getCloudflareContext().env as { FRONTPAGE_SQL?: SqlStore }).FRONTPAGE_SQL;
  if (!sql) throw new Error("Frontpage Durable Object storage is unavailable.");
  if (!['latest.json','history.json'].includes(filename)) throw new Error('Invalid metrics name.');
  const pointer = sql.exec('SELECT generation FROM metrics_v1_active WHERE id=1').toArray()[0];
  if(!pointer){
    const rows=sql.exec("SELECT name,data FROM metrics_snapshot WHERE name IN ('latest.json','history.json')").toArray();
    const latestRow=rows.find(row=>row.name==='latest.json'),historyRow=rows.find(row=>row.name==='history.json');
    if(!latestRow || !historyRow)throw Object.assign(new Error('A complete legacy metrics pair is unavailable.'),{code:'ENOENT'});
    const latest=parseMetricsSnapshot(JSON.parse(gunzipSync(latestRow.data as Uint8Array,{maxOutputLength:512*1024}).toString('utf8')));
    const history=parseMetricsHistory(JSON.parse(gunzipSync(historyRow.data as Uint8Array,{maxOutputLength:4*1024*1024}).toString('utf8')));
    if(JSON.stringify(history.samples.at(-1))!==JSON.stringify(latest))throw new Error('Legacy metrics generations disagree.');
    return filename==='latest.json'?latest:history;
  }
  const row=sql.exec(`SELECT ${filename === 'latest.json' ? 'latest' : 'history'} AS data FROM metrics_v1_generations WHERE generation=?`,String(pointer.generation)).toArray()[0];
  if (!row) {
    const error = new Error(`${filename} is missing.`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }
  return JSON.parse(gunzipSync(row.data as Uint8Array, {maxOutputLength: filename === 'latest.json' ? 512 * 1024 : 4 * 1024 * 1024}).toString("utf8"));
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

export class CloudflareMetricsTooLargeError extends Error {
  constructor() {
    super("Cloudflare metrics projection exceeds its decoded size budget.");
    this.name = "CloudflareMetricsTooLargeError";
  }
}

export function readCloudflareProjectionV2(
  root: string,
  relative: string,
  cap: number,
  budget?: { remainingBytes: number },
): unknown {
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
  const maxOutputLength = Math.min(cap, budget?.remainingBytes ?? cap);
  if (maxOutputLength <= 0) throw new CloudflareMetricsTooLargeError();
  let decoded: Buffer;
  try {
    decoded = gunzipSync(row.data as Uint8Array, { maxOutputLength });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw new CloudflareMetricsTooLargeError();
    }
    throw error;
  }
  if (budget) {
    if (decoded.byteLength > budget.remainingBytes) throw new CloudflareMetricsTooLargeError();
    budget.remainingBytes -= decoded.byteLength;
  }
  return JSON.parse(decoded.toString("utf8"));
}
