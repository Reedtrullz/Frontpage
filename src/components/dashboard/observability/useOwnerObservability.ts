"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  ObservabilityRange,
  ObservabilityResource,
  ObservabilityView,
  IncidentListV2,
  OwnerLatestV2,
  SeriesV2,
} from "@/lib/metrics/v2/types";
import {
  createOwnerDashboardPoller,
  type OwnerDashboardSnapshot,
} from "./polling";

function emptySeries(
  initial: SeriesV2,
  range: ObservabilityRange,
  view: ObservabilityView,
  resource: ObservabilityResource | null,
): SeriesV2 {
  return {
    ...initial,
    range,
    resolution_seconds: range === "1h" ? 15 : range === "30d" ? 900 : 60,
    view,
    resource,
    timestamps: [],
    series: [],
    coverage_percent: 0,
    truncated: false,
  };
}

export function useOwnerObservability({
  initial,
  range,
  view,
  resource,
}: {
  initial: {
    latest: OwnerLatestV2;
    incidents?: IncidentListV2 | null;
    series: SeriesV2;
  };
  range: ObservabilityRange;
  view: ObservabilityView;
  resource: ObservabilityResource | null;
}): OwnerDashboardSnapshot & { isPending: boolean; refresh: () => void } {
  const [isPending, startTransition] = useTransition();
  const parameters = useMemo(() => {
    const query = new URLSearchParams({ range, view });
    if (resource) query.set("resource", resource);
    return query;
  }, [range, resource, view]);
  const seriesUrl = `/api/owner/metrics?${parameters}`;
  const seriesMatchesQuery =
    initial.series.range === range &&
    initial.series.view === view &&
    initial.series.resource === resource;
  const poller = useMemo(
    () => createOwnerDashboardPoller({
      urls: {
        latest: "/api/owner/latest",
        incidents: "/api/owner/incidents",
        series: seriesUrl,
      },
      initial: {
        latest: initial.latest,
        incidents: initial.incidents,
        series: seriesMatchesQuery
          ? initial.series
          : emptySeries(initial.series, range, view, resource),
        seriesGeneratedAt: seriesMatchesQuery ? initial.series.generated_at : null,
      },
    }),
    [initial.incidents, initial.latest, initial.series, range, resource, seriesMatchesQuery, seriesUrl, view],
  );
  const [snapshot, setSnapshot] = useState<OwnerDashboardSnapshot>(() => poller.getSnapshot());

  useEffect(() => {
    let live = true;
    const unsubscribe = poller.subscribe((next) => {
      if (!live || next.queryKey !== seriesUrl) return;
      startTransition(() => setSnapshot(next));
    });
    poller.start();
    return () => {
      live = false;
      unsubscribe();
      poller.stop();
    };
  }, [poller, seriesUrl]);

  const currentSnapshot = snapshot.queryKey === seriesUrl ? snapshot : poller.getSnapshot();
  return { ...currentSnapshot, isPending, refresh: () => poller.refresh() };
}
