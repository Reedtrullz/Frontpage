"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  ObservabilityRange,
  ObservabilityResource,
  ObservabilityView,
  SeriesV2,
} from "@/lib/metrics/v2/types";
import {
  createOwnerPoller,
  type OwnerPollSnapshot,
} from "./polling";

export function useOwnerObservability({
  initial,
  range,
  view,
  resource,
}: {
  initial: SeriesV2;
  range: ObservabilityRange;
  view: ObservabilityView;
  resource: ObservabilityResource | null;
}): OwnerPollSnapshot & { isPending: boolean; refresh: () => void } {
  const [isPending, startTransition] = useTransition();
  const [snapshot, setSnapshot] = useState<OwnerPollSnapshot>({
    data: initial,
    status: "idle",
    etag: null,
    error: null,
  });
  const url = useMemo(() => {
    const parameters = new URLSearchParams({ range, view });
    if (resource) parameters.set("resource", resource);
    return `/api/owner/metrics?${parameters}`;
  }, [range, resource, view]);
  const poller = useMemo(
    () => createOwnerPoller({ url, initial }),
    [initial, url],
  );

  useEffect(() => {
    const unsubscribe = poller.subscribe((next) => {
      startTransition(() => setSnapshot(next));
    });
    poller.start();
    return () => {
      unsubscribe();
      poller.stop();
    };
  }, [poller]);

  return { ...snapshot, isPending, refresh: () => poller.refresh() };
}
