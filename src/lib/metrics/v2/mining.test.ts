import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMiningFetcher,
  parsePearlMiningPayload,
  projectPublicMiningV2,
} from "./mining";

const now = Date.parse("2026-10-03T14:00:00.000Z");

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    stats: {
      hashrate: "1200",
      hashrateAvg: { "1h": "1100", "6h": "1000", "24h": "900" },
      acceptedShares: "12",
      rejectedShares: "2",
      paid: "3.5",
      unlocked: "4",
      locked: "1",
      lastShare: String(now - 120_000),
      ...((overrides.stats as Record<string, unknown> | undefined) ?? {}),
    },
    workers: [
      {
        name: "rig-main",
        minerAgent: "private-agent-build",
        loginTime: String(now - 3_600_000),
      },
    ],
  };
}

function okResponse(payload: unknown = validPayload()): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.useRealTimers());

describe("Pearl mining response validation", () => {
  it.each([
    ["numeric suffix", { hashrate: "12oops" }],
    ["non-finite numeric string", { hashrate: "Infinity" }],
    ["invalid nested averages", { hashrateAvg: "1100" }],
    ["future last share", { lastShare: String(now + 1) }],
  ])("rejects %s instead of returning misleading metrics", (_label, stats) => {
    expect(parsePearlMiningPayload(validPayload({ stats }), now)).toBeNull();
  });

  it("rejects missing stats and future worker login timestamps", () => {
    expect(parsePearlMiningPayload({ workers: [] }, now)).toBeNull();
    expect(
      parsePearlMiningPayload(
        {
          ...validPayload(),
          workers: [{ name: "rig-main", loginTime: String(now + 1) }],
        },
        now,
      ),
    ).toBeNull();
  });

  it("rejects a missing required hashrate instead of calling it zero activity", () => {
    expect(parsePearlMiningPayload({ stats: {}, workers: [] }, now)).toBeNull();
  });

  it("keeps zero activity as valid data without inventing shares or uptime", () => {
    const parsed = parsePearlMiningPayload(
      {
        stats: { hashrate: "0", lastShare: "0", acceptedShares: "0" },
        workers: [],
      },
      now,
    );

    expect(parsed).toMatchObject({
      hashrate: 0,
      accepted_shares: 0,
      last_share_at_ms: 0,
      uptime_seconds: null,
    });
  });

  it("projects only fields that the current public status page already displays", () => {
    const parsed = parsePearlMiningPayload(validPayload(), now);
    expect(parsed).not.toBeNull();

    const publicData = projectPublicMiningV2(parsed!);
    expect(Object.keys(publicData).sort()).toEqual([
      "accepted_shares",
      "hashrate",
      "hashrate_avg_1h",
      "last_share_at_ms",
      "uptime_seconds",
      "worker_name",
    ]);
    expect(JSON.stringify(publicData)).not.toContain("private-agent-build");
    expect(JSON.stringify(publicData)).not.toContain('"paid"');
    expect(JSON.stringify(publicData)).not.toContain("balance_");
    expect(JSON.stringify(publicData)).not.toContain("rejected_shares");
  });
});

describe("mining observation and cache freshness", () => {
  it("marks a successful response unknown when the source has no sample timestamp", async () => {
    const fetchMining = createMiningFetcher({
      fetcher: vi.fn().mockResolvedValue(okResponse()),
      now: () => now,
    });

    const result = await fetchMining();
    expect(result).toMatchObject({
      sourceSampleAt: null,
      observedAt: "2026-10-03T14:00:00.000Z",
      observationAgeMs: 0,
      freshness: "unknown",
    });
    expect("age" in result).toBe(false);
  });

  it("returns an explicitly stale last-good observation after the pool request fails", async () => {
    let clock = now;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(okResponse())
      .mockRejectedValueOnce(new Error("upstream unavailable"));
    const fetchMining = createMiningFetcher({ fetcher, now: () => clock });
    await fetchMining();
    clock += 301_000;

    expect(await fetchMining()).toMatchObject({
      sourceSampleAt: null,
      observedAt: "2026-10-03T14:00:00.000Z",
      observationAgeMs: 301_000,
      freshness: "stale",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("aborts a pool request after the five second deadline", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    );
    const fetchMining = createMiningFetcher({ fetcher, now: () => now });
    const pending = fetchMining();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await pending).toMatchObject({ data: null, freshness: "unavailable" });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("stops reading a response once it exceeds the body byte limit", async () => {
    const fetchMining = createMiningFetcher({
      fetcher: vi.fn().mockResolvedValue(okResponse({ junk: "x".repeat(70_000) })),
      now: () => now,
    });

    expect(await fetchMining()).toMatchObject({ data: null, freshness: "unavailable" });
  });
});
