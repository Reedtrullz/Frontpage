"use client";

import { useEffect } from "react";

const navigationWarning = "Leave without saving this draft?";

/** Owner-controlled router transitions should call this with the editor's dirty state. */
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
      if (anchor.target === "_blank" || anchor.hasAttribute("download") || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (!confirmUnsavedNavigation(dirty)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    const guardedStateKey = "__frontpageUnsavedGuard";
    history.pushState({ ...(history.state ?? {}), [guardedStateKey]: true }, "", window.location.href);
    const popstate = (event: PopStateEvent) => {
      if (event.state?.[guardedStateKey]) return;
      if (!confirmUnsavedNavigation(dirty)) {
        history.forward();
      }
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", popstate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", popstate);
    };
  }, [dirty]);
}
