import { parseSeriesV2 } from "@/lib/metrics/v2/schema";
import type { SeriesV2 } from "@/lib/metrics/v2/types";

const POLL_INTERVAL_MS = 15_000;
const VISIBILITY_DEBOUNCE_MS = 500;

export type PollStatus =
  | "idle"
  | "loading"
  | "ready"
  | "paused"
  | "offline"
  | "error"
  | "auth-expired";

export interface OwnerPollSnapshot {
  data: SeriesV2;
  status: PollStatus;
  etag: string | null;
  error: string | null;
}

export interface PollScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface BooleanSignal {
  get(): boolean;
  subscribe(listener: (value: boolean) => void): () => void;
}

export interface OwnerPoller {
  start(): void;
  stop(): void;
  refresh(): void;
  getSnapshot(): OwnerPollSnapshot;
  subscribe(listener: (snapshot: OwnerPollSnapshot) => void): () => void;
}

export interface OwnerPollerDependencies {
  url: string;
  initial: SeriesV2;
  fetcher?: typeof fetch;
  scheduler?: PollScheduler;
  visibility?: BooleanSignal;
  online?: BooleanSignal;
}

const browserScheduler: PollScheduler = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (id) => window.clearTimeout(id as number),
};

export function browserVisibilitySignal(): BooleanSignal {
  return {
    get: () => document.visibilityState !== "hidden",
    subscribe: (listener) => {
      const onChange = () => listener(document.visibilityState !== "hidden");
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
  };
}

export function browserOnlineSignal(): BooleanSignal {
  return {
    get: () => navigator.onLine,
    subscribe: (listener) => {
      const onOnline = () => listener(true);
      const onOffline = () => listener(false);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      };
    },
  };
}

export function createOwnerPoller({
  url,
  initial,
  fetcher = fetch,
  scheduler = browserScheduler,
  visibility = browserVisibilitySignal(),
  online = browserOnlineSignal(),
}: OwnerPollerDependencies): OwnerPoller {
  let snapshot: OwnerPollSnapshot = {
    data: initial,
    status: "idle",
    etag: null,
    error: null,
  };
  let running = false;
  let authExpired = false;
  let inFlight = false;
  let timer: unknown;
  let abortController: AbortController | null = null;
  let unsubscribeVisibility: (() => void) | null = null;
  let unsubscribeOnline: (() => void) | null = null;
  const listeners = new Set<(value: OwnerPollSnapshot) => void>();

  const detachSignals = () => {
    unsubscribeVisibility?.();
    unsubscribeOnline?.();
    unsubscribeVisibility = null;
    unsubscribeOnline = null;
  };

  const publish = (patch: Partial<OwnerPollSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  };

  const clearTimer = () => {
    if (timer !== undefined) scheduler.clearTimeout(timer);
    timer = undefined;
  };

  const isActive = () =>
    running && !authExpired && visibility.get() && online.get();

  const settledStatus = (): PollStatus =>
    !online.get() ? "offline" : !visibility.get() ? "paused" : "ready";

  const schedule = (delayMs = POLL_INTERVAL_MS) => {
    clearTimer();
    if (!isActive() || inFlight) return;
    timer = scheduler.setTimeout(() => {
      timer = undefined;
      void poll();
    }, delayMs);
  };

  const poll = async () => {
    if (!isActive() || inFlight) return;
    inFlight = true;
    abortController = new AbortController();
    publish({ status: "loading", error: null });
    try {
      const headers: Record<string, string> = {};
      if (snapshot.etag) headers["If-None-Match"] = snapshot.etag;
      const response = await fetcher(url, {
        credentials: "same-origin",
        headers,
        signal: abortController.signal,
      });
      if (response.status === 401 || response.status === 403) {
        authExpired = true;
        clearTimer();
        detachSignals();
        publish({ status: "auth-expired", error: "Owner session expired." });
        return;
      }
      if (response.status === 304) {
        publish({
          status: settledStatus(),
          etag: response.headers.get("etag") ?? snapshot.etag,
          error: null,
        });
        return;
      }
      if (!response.ok) {
        throw new Error(`Observability request failed with status ${response.status}.`);
      }
      const data = parseSeriesV2(await response.json());
      publish({
        data,
        status: settledStatus(),
        etag: response.headers.get("etag"),
        error: null,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      publish({
        status: online.get() ? "error" : "offline",
        error: online.get() ? "Chart refresh failed." : null,
      });
    } finally {
      inFlight = false;
      abortController = null;
      schedule();
    }
  };

  const onVisibility = (visible: boolean) => {
    clearTimer();
    if (!running || authExpired) return;
    if (!visible) {
      publish({ status: "paused" });
      return;
    }
    if (online.get()) schedule(VISIBILITY_DEBOUNCE_MS);
  };

  const onOnline = (connected: boolean) => {
    clearTimer();
    if (!running || authExpired) return;
    if (!connected) {
      publish({ status: "offline", error: null });
      return;
    }
    if (visibility.get()) void poll();
  };

  return {
    start() {
      if (running || authExpired) return;
      running = true;
      unsubscribeVisibility = visibility.subscribe(onVisibility);
      unsubscribeOnline = online.subscribe(onOnline);
      if (!online.get()) publish({ status: "offline" });
      else if (!visibility.get()) publish({ status: "paused" });
      else void poll();
    },
    stop() {
      running = false;
      clearTimer();
      abortController?.abort();
      detachSignals();
    },
    refresh() {
      if (isActive()) void poll();
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
