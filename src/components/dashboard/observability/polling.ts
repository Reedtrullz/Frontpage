import { parseIncidentListV2, parseOwnerLatestV2, parseSeriesV2 } from "@/lib/metrics/v2/schema";
import type { IncidentListV2, IncidentV2, OwnerLatestV2, SeriesV2 } from "@/lib/metrics/v2/types";
import { markOwnerSessionExpired } from "./owner-session";

const POLL_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const VISIBILITY_DEBOUNCE_MS = 500;

export type PollStatus = "idle" | "loading" | "ready" | "paused" | "offline" | "error" | "auth-expired";

export interface OwnerDashboardSnapshot {
  latest: OwnerLatestV2 | null;
  incidents: IncidentV2[];
  incidentsGeneratedAt: string | null;
  data: SeriesV2 | null;
  seriesGeneratedAt: string | null;
  status: PollStatus;
  etags: { latest: string | null; incidents: string | null; series: string | null };
  error: string | null;
  queryKey: string;
  requestGeneration: number;
}

export interface PollScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface BooleanSignal {
  get(): boolean;
  subscribe(listener: (value: boolean) => void): () => void;
}

export interface OwnerDashboardPoller {
  start(): void;
  stop(): void;
  refresh(): void;
  getSnapshot(): OwnerDashboardSnapshot;
  subscribe(listener: (snapshot: OwnerDashboardSnapshot) => void): () => void;
}

export interface OwnerDashboardPollerDependencies {
  urls: { latest: string; incidents: string; series: string };
  initial: {
    latest: OwnerLatestV2;
    incidents?: IncidentListV2 | null;
    series: SeriesV2;
    seriesGeneratedAt?: string | null;
  };
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

class OwnerAuthExpiredError extends Error {}
class OwnerRequestTimeoutError extends Error {}

export function createOwnerDashboardPoller({
  urls,
  initial,
  fetcher = fetch,
  scheduler = browserScheduler,
  visibility = browserVisibilitySignal(),
  online = browserOnlineSignal(),
}: OwnerDashboardPollerDependencies): OwnerDashboardPoller {
  const queryKey = urls.series;
  const query = new URL(queryKey, "https://frontpage.invalid").searchParams;
  const initialSeriesMatchesQuery =
    initial.series.range === query.get("range") &&
    initial.series.view === query.get("view") &&
    (query.get("resource") ?? null) === initial.series.resource;
  let snapshot: OwnerDashboardSnapshot = {
    latest: initial.latest,
    incidents: initial.incidents?.incidents ?? initial.latest.incidents,
    incidentsGeneratedAt: initial.incidents?.generated_at ?? null,
    data: initial.series,
    seriesGeneratedAt: initial.seriesGeneratedAt === undefined
      ? initialSeriesMatchesQuery ? initial.series.generated_at : null
      : initial.seriesGeneratedAt,
    status: "idle",
    etags: { latest: null, incidents: null, series: null },
    error: null,
    queryKey,
    requestGeneration: 0,
  };
  let running = false;
  let authExpired = false;
  let inFlight = false;
  let cycle = 0;
  let timer: unknown;
  const controllers = new Set<AbortController>();
  let unsubscribeVisibility: (() => void) | null = null;
  let unsubscribeOnline: (() => void) | null = null;
  const listeners = new Set<(value: OwnerDashboardSnapshot) => void>();

  const publish = (patch: Partial<OwnerDashboardSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  };
  const clearTimer = () => {
    if (timer !== undefined) scheduler.clearTimeout(timer);
    timer = undefined;
  };
  const abortCurrentCycle = () => {
    cycle += 1;
    inFlight = false;
    for (const controller of controllers) controller.abort();
    controllers.clear();
  };
  const detachSignals = () => {
    unsubscribeVisibility?.();
    unsubscribeOnline?.();
    unsubscribeVisibility = null;
    unsubscribeOnline = null;
  };
  const active = () => running && !authExpired && visibility.get() && online.get();
  const settledStatus = (): PollStatus => !online.get() ? "offline" : !visibility.get() ? "paused" : "ready";
  const schedule = (delayMs = POLL_INTERVAL_MS) => {
    clearTimer();
    if (!active() || inFlight) return;
    timer = scheduler.setTimeout(() => {
      timer = undefined;
      void poll();
    }, delayMs);
  };
  const expireAuthentication = () => {
    if (authExpired) return;
    authExpired = true;
    markOwnerSessionExpired();
    clearTimer();
    detachSignals();
    abortCurrentCycle();
    publish({
      latest: null,
      incidents: [],
      incidentsGeneratedAt: null,
      data: null,
      seriesGeneratedAt: null,
      etags: { latest: null, incidents: null, series: null },
      status: "auth-expired",
      error: "Owner session expired.",
    });
  };

  const fetchJson = async <T>(
    url: string,
    etag: string | null,
    parse: (input: unknown) => T,
    cycleAtStart: number,
  ): Promise<{ data: T | null; etag: string | null }> => {
    const controller = new AbortController();
    controllers.add(controller);
    let timedOut = false;
    const deadline = scheduler.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {};
      if (etag) headers["If-None-Match"] = etag;
      const response = await fetcher(url, {
        credentials: "same-origin",
        headers,
        signal: controller.signal,
      });
      if (cycleAtStart !== cycle || !running) throw new DOMException("Request superseded", "AbortError");
      if (response.status === 401 || response.status === 403) {
        expireAuthentication();
        throw new OwnerAuthExpiredError();
      }
      if (response.status === 304) {
        return { data: null, etag: response.headers.get("etag") ?? etag };
      }
      if (!response.ok) throw new Error(`Owner telemetry request failed with status ${response.status}.`);
      const data = parse(await response.json());
      if (cycleAtStart !== cycle || !running) throw new DOMException("Request superseded", "AbortError");
      return { data, etag: response.headers.get("etag") };
    } catch (error) {
      if (timedOut) throw new OwnerRequestTimeoutError();
      throw error;
    } finally {
      scheduler.clearTimeout(deadline);
      controllers.delete(controller);
    }
  };

  const poll = async () => {
    if (!active() || inFlight) return;
    inFlight = true;
    const thisCycle = ++cycle;
    publish({ status: "loading", error: null, requestGeneration: thisCycle });
    try {
      const [latestResult, incidentsResult, seriesResult] = await Promise.all([
        fetchJson(urls.latest, snapshot.etags.latest, parseOwnerLatestV2, thisCycle),
        fetchJson(urls.incidents, snapshot.etags.incidents, parseIncidentListV2, thisCycle),
        fetchJson(urls.series, snapshot.etags.series, (input) => {
          const series = parseSeriesV2(input);
          const parameters = new URL(urls.series, "https://frontpage.invalid").searchParams;
          if (
            series.range !== parameters.get("range") ||
            series.view !== parameters.get("view") ||
            (parameters.get("resource") ?? null) !== series.resource
          ) throw new Error("Owner history response does not match the active query.");
          return series;
        }, thisCycle),
      ]);
      if (thisCycle !== cycle || !running || authExpired) return;
      const latest = latestResult.data ?? snapshot.latest;
      const incidents = incidentsResult.data ?? null;
      publish({
        latest,
        incidents: incidents?.incidents ?? snapshot.incidents,
        incidentsGeneratedAt: incidents?.generated_at ?? snapshot.incidentsGeneratedAt,
        data: seriesResult.data ?? snapshot.data,
        seriesGeneratedAt: seriesResult.data?.generated_at ?? snapshot.seriesGeneratedAt,
        etags: {
          latest: latestResult.etag,
          incidents: incidentsResult.etag,
          series: seriesResult.etag,
        },
        status: settledStatus(),
        error: null,
      });
    } catch (error) {
      if (thisCycle !== cycle || !running || authExpired || error instanceof OwnerAuthExpiredError) return;
      for (const controller of controllers) controller.abort();
      publish({
        status: online.get() ? "error" : "offline",
        error: online.get()
          ? error instanceof OwnerRequestTimeoutError
            ? "Owner telemetry refresh timed out."
            : "Owner telemetry refresh failed."
          : null,
      });
    } finally {
      if (thisCycle === cycle) {
        inFlight = false;
        schedule();
      }
    }
  };

  const onVisibility = (visible: boolean) => {
    clearTimer();
    if (!running || authExpired) return;
    if (!visible) {
      abortCurrentCycle();
      publish({ status: "paused" });
      return;
    }
    if (online.get()) schedule(VISIBILITY_DEBOUNCE_MS);
  };
  const onOnline = (connected: boolean) => {
    clearTimer();
    if (!running || authExpired) return;
    if (!connected) {
      abortCurrentCycle();
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
      abortCurrentCycle();
      detachSignals();
    },
    refresh() {
      if (active()) void poll();
    },
    getSnapshot() { return snapshot; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
