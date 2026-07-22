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
  collected_at: string;
  error?: string;
}

const LUCKYPOOL_URL =
  "https://pearl.luckypool.io/api/stats_address?address=prl1pzgyla44gfqf3q996w6kxrtcrdr3djkc90lwxrvea9up7x0umxrcskfpac2";

export async function fetchMiningV2(): Promise<{
  data: PearlMiningV2 | null;
  age: number | null;
}> {
  try {
    const res = await fetch(LUCKYPOOL_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 300 }, // ponytail: 5min ISR cache
    });
    if (!res.ok) return { data: null, age: null };
    const body = (await res.json()) as {
      stats?: Record<string, string>;
      workers?: Array<Record<string, string>>;
    };
    const stats = body.stats ?? {};
    const worker = (body.workers ?? [])[0] ?? {};
    const loginMs = parseInt(worker.loginTime ?? "0", 10);
    const uptime_s = loginMs
      ? Math.floor(Date.now() / 1000 - loginMs / 1000)
      : null;

    const avg = stats.hashrateAvg as unknown as Record<string, string> | undefined;
    return {
      data: {
        hashrate: parseInt(stats.hashrate ?? "0", 10),
        hashrate_avg_1h: parseInt(avg?.["1h"] ?? "0", 10),
        hashrate_avg_6h: parseInt(avg?.["6h"] ?? "0", 10),
        hashrate_avg_24h: parseInt(avg?.["24h"] ?? "0", 10),
        accepted_shares: parseInt(stats.acceptedShares ?? "0", 10),
        rejected_shares: parseInt(stats.rejectedShares ?? "0", 10),
        paid: parseInt(stats.paid ?? "0", 10),
        balance_unlocked: parseInt(stats.unlocked ?? "0", 10),
        balance_locked: parseInt(stats.locked ?? "0", 10),
        last_share_at_ms: parseInt(stats.lastShare ?? "0", 10),
        worker_name: worker.name ?? "",
        worker_agent: worker.minerAgent ?? "",
        worker_login_ms: loginMs,
        uptime_seconds: uptime_s,
        collected_at: new Date().toISOString(),
      },
      age: 0,
    };
  } catch {
    return { data: null, age: null };
  }
}
