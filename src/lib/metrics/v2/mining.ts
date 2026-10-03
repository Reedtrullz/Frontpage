export interface PearlMiningV2 {
  hashrate: number;
  hashrate_avg_1h: number;
  hashrate_avg_6h: number;
  hashrate_avg_24h: number;
  accepted_shares: number;
  rejected_shares: number;
  paid: number;
  balance_unlocked: number;
  balance_locked: number;
  last_share_at_ms: number;
  worker_name: string;
  worker_agent: string;
  worker_login_ms: number;
  uptime_seconds: number | null;
}

// This is the existing public disclosure. New pool fields must not be added
// here without an owner decision. The coarser activity-only projection remains
// a recommendation pending that decision.
export type PublicPearlMiningV2 = Pick<
  PearlMiningV2,
  | "hashrate"
  | "hashrate_avg_1h"
  | "accepted_shares"
  | "last_share_at_ms"
  | "worker_name"
  | "uptime_seconds"
>;

export interface MiningFetchResult {
  data: PublicPearlMiningV2 | null;
  sourceSampleAt: null;
  observedAt: string | null;
  observationAgeMs: number | null;
  freshness: "unknown" | "stale" | "unavailable";
}

const LUCKYPOOL_URL =
  "https://pearl.luckypool.io/api/stats_address?address=prl1pzgyla44gfqf3q996w6kxrtcrdr3djkc90lwxrvea9up7x0umxrcskfpac2";
const FETCH_DEADLINE_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_STALE_MS = 60 * 60_000;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
      ? value
      : null;
  }
  if (typeof value !== "string" || !/^(?:\d+)(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed <= Number.MAX_SAFE_INTEGER ? parsed : null;
}

function numberField(
  source: JsonRecord,
  key: string,
  fallback = 0,
): number | null {
  return source[key] === undefined ? fallback : finiteNumber(source[key]);
}

function stringField(source: JsonRecord, key: string): string | null {
  const value = source[key];
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 120) return null;
  return value.trim();
}

export function parsePearlMiningPayload(
  payload: unknown,
  nowMs = Date.now(),
): PearlMiningV2 | null {
  const body = record(payload);
  const stats = record(body?.stats);
  if (!stats) return null;

  const averagesValue = stats.hashrateAvg;
  const averages = averagesValue === undefined ? {} : record(averagesValue);
  if (!averages) return null;

  const workersValue = body?.workers;
  if (workersValue !== undefined && !Array.isArray(workersValue)) return null;
  const workers = (workersValue ?? []) as unknown[];
  const worker = workers.length === 0 ? {} : record(workers[0]);
  if (!worker) return null;

  const hashrate = finiteNumber(stats.hashrate);
  const hashrateAvg1h = numberField(averages, "1h");
  const hashrateAvg6h = numberField(averages, "6h");
  const hashrateAvg24h = numberField(averages, "24h");
  const acceptedShares = numberField(stats, "acceptedShares");
  const rejectedShares = numberField(stats, "rejectedShares");
  const paid = numberField(stats, "paid");
  const unlocked = numberField(stats, "unlocked");
  const locked = numberField(stats, "locked");
  const lastShare = numberField(stats, "lastShare");
  const loginTime = numberField(worker, "loginTime");
  const workerName = stringField(worker, "name");
  const workerAgent = stringField(worker, "minerAgent");

  const numericValues = [
    hashrate,
    hashrateAvg1h,
    hashrateAvg6h,
    hashrateAvg24h,
    acceptedShares,
    rejectedShares,
    paid,
    unlocked,
    locked,
    lastShare,
    loginTime,
  ];
  if (numericValues.some((value) => value === null) || workerName === null || workerAgent === null) {
    return null;
  }
  if (
    !Number.isFinite(nowMs) ||
    lastShare! > nowMs ||
    loginTime! > nowMs ||
    (lastShare! > 0 && !Number.isFinite(new Date(lastShare!).getTime())) ||
    (loginTime! > 0 && !Number.isFinite(new Date(loginTime!).getTime()))
  ) {
    return null;
  }

  return {
    hashrate: hashrate!,
    hashrate_avg_1h: hashrateAvg1h!,
    hashrate_avg_6h: hashrateAvg6h!,
    hashrate_avg_24h: hashrateAvg24h!,
    accepted_shares: acceptedShares!,
    rejected_shares: rejectedShares!,
    paid: paid!,
    balance_unlocked: unlocked!,
    balance_locked: locked!,
    last_share_at_ms: lastShare!,
    worker_name: workerName,
    worker_agent: workerAgent,
    worker_login_ms: loginTime!,
    uptime_seconds: loginTime! > 0 ? Math.floor((nowMs - loginTime!) / 1000) : null,
  };
}

export function projectPublicMiningV2(
  data: PearlMiningV2,
): PublicPearlMiningV2 {
  return {
    hashrate: data.hashrate,
    hashrate_avg_1h: data.hashrate_avg_1h,
    accepted_shares: data.accepted_shares,
    last_share_at_ms: data.last_share_at_ms,
    worker_name: data.worker_name,
    uptime_seconds: data.uptime_seconds,
  };
}

async function readBoundedJson(response: Response): Promise<unknown | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

interface MiningCache {
  data: PublicPearlMiningV2;
  observedAtMs: number;
}

function resultFromCache(
  cached: MiningCache,
  nowMs: number,
  freshness: "unknown" | "stale",
): MiningFetchResult {
  return {
    data: cached.data,
    sourceSampleAt: null,
    observedAt: new Date(cached.observedAtMs).toISOString(),
    observationAgeMs: Math.max(0, nowMs - cached.observedAtMs),
    freshness,
  };
}

function unavailable(): MiningFetchResult {
  return {
    data: null,
    sourceSampleAt: null,
    observedAt: null,
    observationAgeMs: null,
    freshness: "unavailable",
  };
}

export function createMiningFetcher({
  fetcher = fetch,
  now = Date.now,
}: {
  fetcher?: typeof fetch;
  now?: () => number;
} = {}): () => Promise<MiningFetchResult> {
  let cache: MiningCache | null = null;

  return async () => {
    const requestedAt = now();
    if (cache && requestedAt - cache.observedAtMs < CACHE_TTL_MS) {
      return resultFromCache(cache, requestedAt, "unknown");
    }

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
    try {
      const response = await fetcher(LUCKYPOOL_URL, {
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Pool response failed.");
      const body = await readBoundedJson(response);
      if (body === null) throw new Error("Pool response was invalid or too large.");
      const parsed = parsePearlMiningPayload(body, now());
      if (!parsed) throw new Error("Pool response did not match the expected schema.");

      cache = { data: projectPublicMiningV2(parsed), observedAtMs: now() };
      return resultFromCache(cache, cache.observedAtMs, "unknown");
    } catch {
      const failedAt = now();
      if (cache && failedAt - cache.observedAtMs <= MAX_STALE_MS) {
        return resultFromCache(cache, failedAt, "stale");
      }
      return unavailable();
    } finally {
      clearTimeout(deadline);
    }
  };
}

const fetchMining = createMiningFetcher();

export async function fetchMiningV2(): Promise<MiningFetchResult> {
  return fetchMining();
}
