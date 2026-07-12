import { describe, expect, it, vi } from "vitest";
import type { SeriesV2 } from "@/lib/metrics/v2/types";
import {
  createOwnerPoller,
  type BooleanSignal,
  type PollScheduler,
} from "./polling";

const payload: SeriesV2 = {
  schema_version: 2,
  generated_at: "2026-07-12T18:59:45Z",
  range: "1h",
  resolution_seconds: 15,
  view: "host",
  resource: null,
  timestamps: ["2026-07-12T18:59:45Z"],
  series: [{ id: "cpu-total", label: "CPU total", unit: "percent", values: [20] }],
  coverage_percent: 100,
  truncated: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
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

  clearTimeout(id: unknown): void {
    this.tasks.delete(id as number);
  }

  async advanceBy(delayMs: number): Promise<void> {
    const target = this.now + delayMs;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.due <= target)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (!next) break;
      this.now = next[1].due;
      this.tasks.delete(next[0]);
      next[1].callback();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.now = target;
    await Promise.resolve();
  }
}

class FakeSignal implements BooleanSignal {
  private listeners = new Set<(value: boolean) => void>();

  constructor(private value: boolean) {}

  get(): boolean {
    return this.value;
  }

  subscribe(listener: (value: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(value: boolean): void {
    this.value = value;
    for (const listener of this.listeners) listener(value);
  }
}

function jsonResponse(data = payload, etag = '"etag-1"'): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", ETag: etag },
  });
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function setup(fetcher = vi.fn().mockResolvedValue(jsonResponse())) {
  const scheduler = new FakeScheduler();
  const visibility = new FakeSignal(true);
  const online = new FakeSignal(true);
  const poller = createOwnerPoller({
    url: "/api/owner/metrics?range=1h&view=host",
    initial: payload,
    fetcher,
    scheduler,
    visibility,
    online,
  });
  return { fetcher, scheduler, visibility, online, poller };
}

describe("owner observability polling", () => {
  it("polls immediately and then every 15 seconds with ETag revalidation", async () => {
    const { poller, fetcher, scheduler } = setup();
    poller.start();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({});

    await scheduler.advanceBy(15_000);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({ "If-None-Match": '"etag-1"' });
    poller.stop();
  });

  it("never overlaps polling requests", async () => {
    const first = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise);
    const { poller, scheduler } = setup(fetcher);
    poller.start();
    await scheduler.advanceBy(30_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    first.resolve(jsonResponse());
    await flush();
    poller.stop();
  });

  it("pauses while hidden and refreshes after a 500 ms visibility debounce", async () => {
    const { poller, fetcher, scheduler, visibility } = setup();
    poller.start();
    await flush();
    visibility.set(false);
    await scheduler.advanceBy(30_000);
    expect(fetcher).toHaveBeenCalledTimes(1);

    visibility.set(true);
    await scheduler.advanceBy(499);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await scheduler.advanceBy(1);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("keeps data on 304 and marks the snapshot ready", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, { status: 304, headers: { ETag: '"etag-1"' } }),
    );
    const { poller } = setup(fetcher);
    poller.start();
    await flush();
    expect(poller.getSnapshot()).toMatchObject({ data: payload, status: "ready" });
    poller.stop();
  });

  it("pauses offline and refreshes immediately when connectivity returns", async () => {
    const { poller, fetcher, scheduler, online } = setup();
    poller.start();
    await flush();
    online.set(false);
    expect(poller.getSnapshot().status).toBe("offline");
    await scheduler.advanceBy(30_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    online.set(true);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("stops permanently after authentication expires", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const { poller, scheduler, visibility, online } = setup(fetcher);
    poller.start();
    await flush();
    expect(poller.getSnapshot().status).toBe("auth-expired");
    await scheduler.advanceBy(60_000);
    visibility.set(false);
    visibility.set(true);
    online.set(false);
    online.set(true);
    await scheduler.advanceBy(1_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
