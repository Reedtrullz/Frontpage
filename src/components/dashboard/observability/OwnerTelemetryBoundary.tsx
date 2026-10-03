"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import {
  ownerSessionExpired,
  ownerSessionServerSnapshot,
  subscribeOwnerSession,
} from "./owner-session";

export function OwnerTelemetryBoundary({ children }: { children: ReactNode }) {
  const expired = useSyncExternalStore(
    subscribeOwnerSession,
    ownerSessionExpired,
    ownerSessionServerSnapshot,
  );
  if (expired) {
    return (
      <p className="mx-auto max-w-7xl border-y border-[var(--role-warning-border)] px-4 py-8 text-sm text-[var(--role-warning)]" role="status">
        Owner session expired. Private telemetry was cleared; sign in again to continue.
      </p>
    );
  }
  return children;
}
