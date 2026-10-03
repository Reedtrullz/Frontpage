"use client";

import { useEffect } from "react";

const navigationWarning = "Leave without saving this draft?";

type NavigationApi = EventTarget & { currentEntry?: { key?: string } };
type NavigationEvent = Event & {
  navigationType?: string;
  userInitiated?: boolean;
  destination?: { key?: string; sameDocument?: boolean; url?: string };
};
type RestorePoint = { href: string; state: string };

const approvedProgrammaticTransitions = new Set<string>();

function serializeHistoryState(state: unknown): string {
  try {
    return JSON.stringify(state) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

/** Owner actions call this immediately before a successful save/discard route change. */
export function allowUnsavedProgrammaticTransition(destination: string) {
  const approvedUrl = new URL(destination, window.location.href).href;
  approvedProgrammaticTransitions.add(approvedUrl);
  window.setTimeout(() => approvedProgrammaticTransitions.delete(approvedUrl), 2_000);
}

/** Owner-controlled transitions should call this with the editor's dirty state. */
export function confirmUnsavedNavigation(dirty: boolean): boolean {
  return !dirty || window.confirm(navigationWarning);
}

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
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
      }
    };

    const navigation = (window as Window & { navigation?: NavigationApi }).navigation;
    let acceptedNativeTraverseKey: string | undefined;
    let restorePoint: RestorePoint | null = null;
    const protectedEntry: RestorePoint = {
      href: window.location.href,
      state: serializeHistoryState(history.state),
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
      if (event.userInitiated !== false || event.destination?.sameDocument !== true) return;
      if (!event.cancelable) return;
      const destination = event.destination?.url;
      if (destination && approvedProgrammaticTransitions.delete(destination)) {
        return;
      }
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
      history.forward();
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
