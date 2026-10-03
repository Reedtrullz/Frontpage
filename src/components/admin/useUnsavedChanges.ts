"use client";

import { useLayoutEffect } from "react";

const navigationWarning = "Leave without saving this draft?";
const historyPositionKey = "__frontpageHistoryPosition";

type NavigationApi = EventTarget & { currentEntry?: { key?: string } };
type NavigationEvent = Event & {
  navigationType?: string;
  userInitiated?: boolean;
  destination?: { key?: string; sameDocument?: boolean; url?: string };
};
type RestorePoint = { href: string; state: string; position: number | null };

const approvedNavigations = new Set<string>();

function serializeHistoryState(state: unknown): string {
  try {
    return JSON.stringify(state) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

function readHistoryPosition(state: unknown): number | null {
  if (state === null || typeof state !== "object") return null;
  const position = (state as Record<string, unknown>)[historyPositionKey];
  return typeof position === "number" && Number.isSafeInteger(position) ? position : null;
}

function withHistoryPosition(state: unknown, position: number): Record<string, unknown> {
  return state !== null && typeof state === "object" && !Array.isArray(state)
    ? { ...(state as Record<string, unknown>), [historyPositionKey]: position }
    : { [historyPositionKey]: position, __frontpageOriginalHistoryState: state };
}

/** Track real entry positions so the popstate fallback can reverse Back and Forward. */
export function useHistoryPositionTracking() {
  useLayoutEffect(() => {
    const trackedWindow = window as Window & { __frontpageHistoryPositionTracking?: boolean };
    if (trackedWindow.__frontpageHistoryPositionTracking) return;

    let currentPosition = readHistoryPosition(history.state) ?? 0;
    trackedWindow.__frontpageHistoryPositionTracking = true;
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.replaceState(withHistoryPosition(history.state, currentPosition), "", location.href);
    history.pushState = function pushState(data, unused, url) {
      const nextPosition = currentPosition + 1;
      const result = originalPushState(withHistoryPosition(data, nextPosition), unused, url);
      currentPosition = readHistoryPosition(history.state) ?? currentPosition;
      return result;
    };
    history.replaceState = function replaceState(data, unused, url) {
      currentPosition = readHistoryPosition(history.state) ?? currentPosition;
      return originalReplaceState(withHistoryPosition(data, currentPosition), unused, url);
    };
    window.addEventListener("popstate", (event) => {
      const position = readHistoryPosition(event.state);
      if (position !== null) currentPosition = position;
    }, true);
  }, []);
}

function approveNavigation(destination: string) {
  const approvedUrl = new URL(destination, window.location.href).href;
  approvedNavigations.add(approvedUrl);
  window.setTimeout(() => approvedNavigations.delete(approvedUrl), 2_000);
}

/** Owner actions call this immediately before a successful save/discard route change. */
export function allowUnsavedProgrammaticTransition(destination: string) {
  approveNavigation(destination);
}

/** Owner-controlled transitions should call this with the editor's dirty state. */
export function confirmUnsavedNavigation(dirty: boolean): boolean {
  return !dirty || window.confirm(navigationWarning);
}

export function useUnsavedChanges(dirty: boolean) {
  useLayoutEffect(() => {
    if (!dirty) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.getAttribute("href")?.startsWith("#")) return;
      const targetName = anchor.target.toLowerCase();
      if (
        (targetName !== "" && targetName !== "_self") ||
        anchor.hasAttribute("download") ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
        event.button !== 0
      ) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (!confirmUnsavedNavigation(dirty)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      approveNavigation(destination.href);
    };

    const navigation = (window as Window & { navigation?: NavigationApi }).navigation;
    let acceptedNativeTraverseKey: string | undefined;
    let restorePoint: RestorePoint | null = null;
    const protectedEntry: RestorePoint = {
      href: window.location.href,
      state: serializeHistoryState(history.state),
      position: readHistoryPosition(history.state),
    };

    const navigate = (rawEvent: Event) => {
      const event = rawEvent as NavigationEvent;
      if (event.navigationType === "traverse") {
        if (!event.cancelable) return;
        if (!confirmUnsavedNavigation(dirty)) {
          event.preventDefault();
          return;
        }
        acceptedNativeTraverseKey = event.destination?.key;
        return;
      }
      const destination = event.destination?.url;
      if (destination && approvedNavigations.delete(destination)) return;
      if (event.userInitiated !== false || event.destination?.sameDocument !== true) return;
      if (!event.cancelable) return;
      if (!confirmUnsavedNavigation(dirty)) event.preventDefault();
    };

    const popstate = (rawEvent: Event) => {
      const event = rawEvent as PopStateEvent;
      if (acceptedNativeTraverseKey && navigation?.currentEntry?.key === acceptedNativeTraverseKey) {
        acceptedNativeTraverseKey = undefined;
        return;
      }
      acceptedNativeTraverseKey = undefined;

      if (restorePoint) {
        const restored =
          window.location.href === restorePoint.href &&
          serializeHistoryState(event.state) === restorePoint.state;
        restorePoint = null;
        if (restored) {
          // The rejected traversal never reached Next. Suppress its compensating forward
          // event too, so Next cannot remount the editor while its local text is dirty.
          event.stopImmediatePropagation();
          return;
        }
      }
      if (confirmUnsavedNavigation(dirty)) return;

      // popstate fires after the active entry changes. Window capture runs before Next's
      // window listener, so stop it before it can route and restore without a sentinel.
      event.stopImmediatePropagation();
      restorePoint = protectedEntry;
      const targetPosition = readHistoryPosition(event.state);
      const reverseSteps =
        targetPosition !== null && protectedEntry.position !== null && targetPosition !== protectedEntry.position
          ? protectedEntry.position - targetPosition
          : 1;
      history.go(reverseSteps);
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    if (navigation) navigation.addEventListener("navigate", navigate, true);
    // Capture at window before Next's default-phase popstate listener when traversal is
    // unavailable or cannot be canceled through the Navigation API.
    window.addEventListener("popstate", popstate, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      navigation?.removeEventListener("navigate", navigate, true);
      window.removeEventListener("popstate", popstate, true);
    };
  }, [dirty]);
}
