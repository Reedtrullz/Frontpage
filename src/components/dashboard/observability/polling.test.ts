import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseIncidentListV2, parseOwnerLatestV2, parseSeriesV2 } from "@/lib/metrics/v2/schema";
import type { IncidentListV2, OwnerLatestV2, SeriesV2 } from "@/lib/metrics/v2/types";
import {
  createOwnerDashboardPoller,
  type BooleanSignal,
  type OwnerDashboardSnapshot,
  type PollScheduler,
} from "./polling";

const fixtureRoot = path.resolve("ops/tests/fixtures/observability-v2");
const initialLatest = parseOwnerLatestV2(JSON.parse(fs.readFileSync(path.join(fixtureRoot, "owner-latest.json"), "utf8")));
const initialSeries = parseSeriesV2({
  ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "host-series-1h.json"), "utf8")),
  resource: null,
});
const initialIncidents = parseIncidentListV2(JSON.parse(fs.readFileSync(path.join(fixtureRoot, "incidents.json"), "utf8")));
const initial = { latest: initialLatest, incidents: initialIncidents, series: initialSeries };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

class FakeScheduler implements PollScheduler {
  private now = 0;
  private nextId = 1;
  private tasks = new Map<number, { due: number; callback: () => void }>();
  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.tasks.set(id, { due: this.now + delayMs, callback });
    return id;
  }
  clearTimeout(id: unknown): void { this.tasks.delete(id as number); }
  async advanceBy(delayMs: number): Promise<void> {
    const target = this.now + delayMs;
    while (true) {
      const next = [...this.tasks.entries()].filter(([, task]) => task.due <= target)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (!next) break;
      this.now = next[1].due;
      this.tasks.delete(next[0]);
      next[1].callback();
      await flush();
    }
    this.now = target;
    await flush();
  }
}

class FakeSignal implements BooleanSignal {
  private listeners = new Set<(value: boolean) => void>();
  constructor(private value: boolean) {}
  get(): boolean { return this.value; }
  subscribe(listener: (value: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(value: boolean): void {
    this.value = value;
    for (const listener of this.listeners) listener(value);
  }
}

function changedLatest(): OwnerLatestV2 {
  const result = structuredClone(initialLatest);
  result.generated_at = "2026-07-12T19:00:00Z";
  result.collected_at = "2026-07-12T19:00:00Z";
  result.host.totals[0]!.current += 1;
  result.host.capabilities[0]!.detail = "Updated from poll";
  result.workloads = [];
  return parseOwnerLatestV2(result);
}

function changedIncidents(): IncidentListV2 {
  return parseIncidentListV2({ schema_version: 2, generated_at: "2026-07-12T19:00:01Z", incidents: [] });
}

function changedSeries(): SeriesV2 {
  return parseSeriesV2({
    ...initialSeries,
    generated_at: "2026-07-12T19:00:02Z",
    series: initialSeries.series.map((item) => ({ ...item, values: item.values.map((value) => value === null ? null : value + 1) })),
  });
}

function response(url: string, payloads = { latest: changedLatest(), incidents: changedIncidents(), series: changedSeries() }): Response {
  const parsedUrl = new URL(url, "https://frontpage.invalid");
  const data = url.includes("/latest") ? payloads.latest : url.includes("/incidents") ? payloads.incidents : {
    ...payloads.series,
    range: parsedUrl.searchParams.get("range") ?? payloads.series.range,
    resolution_seconds: parsedUrl.searchParams.get("range") === "30d" ? 900 : parsedUrl.searchParams.get("range") === "1h" ? 15 : 60,
  };
  const suffix = url.includes("/latest") ? "latest" : url.includes("/incidents") ? "incidents" : "series";
  return new Response(JSON.stringify(data), { status: 200, headers: { ETag: `"${suffix}-etag"` } });
}

async function flush(): Promise<void> { for (let index = 0; index < 16; index += 1) await Promise.resolve(); }

function setup(fetcher: typeof fetch = vi.fn(async (input: RequestInfo | URL) => response(String(input))) as typeof fetch) {
  const scheduler = new FakeScheduler();
  const visibility = new FakeSignal(true);
  const online = new FakeSignal(true);
  const poller = createOwnerDashboardPoller({
    urls: {
      latest: "/api/owner/latest",
      incidents: "/api/owner/incidents",
      series: "/api/owner/metrics?range=1h&view=host",
    },
    initial,
    fetcher,
    scheduler,
    visibility,
    online,
  });
  return { fetcher, scheduler, visibility, online, poller };
}

describe("owner dashboard polling", () => {
  it("refreshes latest, incidents and selected history on one 15-second cadence", async () => {
    const { poller, fetcher, scheduler } = setup();
    poller.start();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(poller.getSnapshot().latest?.host.capabilities[0]?.detail).toBe("Updated from poll");
    expect(poller.getSnapshot().latest?.host.totals[0]?.current).toBe(initialLatest.host.totals[0]!.current + 1);
    expect(poller.getSnapshot().latest?.workloads).toEqual([]);
    expect(poller.getSnapshot()).toMatchObject({
      incidents: [],
      data: { generated_at: "2026-07-12T19:00:02Z" },
      seriesGeneratedAt: "2026-07-12T19:00:02Z",
      status: "ready",
    });
    await scheduler.advanceBy(15_000);
    expect(fetcher).toHaveBeenCalledTimes(6);
    poller.stop();
  });

  it("revalidates each resource with its own ETag and preserves 304 data", async () => {
    const requestOptions: RequestInit[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init) requestOptions.push(init);
      if (fetcher.mock.calls.length > 3) return new Response(null, { status: 304 });
      return response(String(input));
    });
    const { poller, scheduler } = setup(fetcher as typeof fetch);
    poller.start();
    await flush();
    await scheduler.advanceBy(15_000);
    expect(requestOptions.slice(3).map((init) => init.headers)).toEqual([
      { "If-None-Match": '"latest-etag"' },
      { "If-None-Match": '"incidents-etag"' },
      { "If-None-Match": '"series-etag"' },
    ]);
    expect(poller.getSnapshot().data?.generated_at).toBe("2026-07-12T19:00:02Z");
    poller.stop();
  });

  it("clears every private snapshot and stops all routes after any 401 or 403", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/incidents") ? new Response(null, { status: 403 }) : response(String(input)),
    );
    const { poller, scheduler, visibility, online } = setup(fetcher as typeof fetch);
    poller.start();
    await flush();
    expect(poller.getSnapshot()).toMatchObject({ latest: null, incidents: [], data: null, seriesGeneratedAt: null, status: "auth-expired" });
    await scheduler.advanceBy(60_000);
    visibility.set(false);
    visibility.set(true);
    online.set(false);
    online.set(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it("pauses while hidden/offline and resumes on visibility or connectivity", async () => {
    const { poller, fetcher, scheduler, visibility, online } = setup();
    poller.start();
    await flush();
    visibility.set(false);
    await scheduler.advanceBy(30_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    visibility.set(true);
    await scheduler.advanceBy(500);
    expect(fetcher).toHaveBeenCalledTimes(6);
    online.set(false);
    await scheduler.advanceBy(30_000);
    expect(fetcher).toHaveBeenCalledTimes(6);
    online.set(true);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(9);
    poller.stop();
  });

  it("times out a stalled cycle and recovers on the next poll", async () => {
    let timedOut = false;
    let call = 0;
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      if (call <= 3 && !timedOut) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            timedOut = true;
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
      return Promise.resolve(response(String(input)));
    });
    const { poller, scheduler } = setup(fetcher as typeof fetch);
    poller.start();
    await scheduler.advanceBy(10_000);
    expect(poller.getSnapshot().status).toBe("error");
    await scheduler.advanceBy(15_000);
    expect(poller.getSnapshot().status).toBe("ready");
    expect(poller.getSnapshot().latest?.host.capabilities[0]?.detail).toBe("Updated from poll");
    poller.stop();
  });

  it("ignores range A responses that return after range B has replaced the poller", async () => {
    const delayed = deferred<Response>();
    const rangeA = createOwnerDashboardPoller({
      urls: { latest: "/api/owner/latest", incidents: "/api/owner/incidents", series: "/api/owner/metrics?range=24h&view=host" },
      initial,
      fetcher: vi.fn(() => delayed.promise) as typeof fetch,
      scheduler: new FakeScheduler(), visibility: new FakeSignal(true), online: new FakeSignal(true),
    });
    rangeA.start();
    const rangeB = createOwnerDashboardPoller({
      urls: { latest: "/api/owner/latest", incidents: "/api/owner/incidents", series: "/api/owner/metrics?range=7d&view=host" },
      initial,
      fetcher: vi.fn(async (input: RequestInfo | URL) => response(String(input))) as typeof fetch,
      scheduler: new FakeScheduler(), visibility: new FakeSignal(true), online: new FakeSignal(true),
    });
    rangeA.stop();
    rangeB.start();
    await flush();
    delayed.resolve(response("/api/owner/metrics?range=24h&view=host"));
    await flush();
    expect(rangeB.getSnapshot().data?.range).toBe("7d");
    expect(rangeB.getSnapshot().queryKey).toContain("range=7d");
    rangeB.stop();
  });

  it("exposes separate source times and an empty incident update", () => {
    const snapshot: OwnerDashboardSnapshot = {
      latest: initial.latest, incidents: initial.incidents.incidents, incidentsGeneratedAt: initial.incidents.generated_at,
      data: initial.series, seriesGeneratedAt: initial.series.generated_at, status: "ready", etags: { latest: null, incidents: null, series: null },
      error: null, queryKey: "/api/owner/metrics?range=1h&view=host", requestGeneration: 1,
    };
    expect(changedLatest().collected_at).not.toBe(changedSeries().generated_at);
    expect(changedIncidents().generated_at).not.toBe(changedSeries().generated_at);
    expect(snapshot.incidentsGeneratedAt).toBe(initial.incidents.generated_at);
  });

  it("does not attribute the prior range timestamp to a newly requested empty history", () => {
    const poller = createOwnerDashboardPoller({
      urls: {
        latest: "/api/owner/latest",
        incidents: "/api/owner/incidents",
        series: "/api/owner/metrics?range=24h&view=host",
      },
      initial: { ...initial, seriesGeneratedAt: null },
      scheduler: new FakeScheduler(),
      visibility: new FakeSignal(true),
      online: new FakeSignal(true),
    });

    expect(poller.getSnapshot().data?.generated_at).toBe(initial.series.generated_at);
    expect(poller.getSnapshot().seriesGeneratedAt).toBeNull();
  });
});
