"use client";

import { useLayoutEffect } from "react";
import { installOwnerNavigationGuards } from "./useUnsavedChanges";

/** Install owner history guards before the App Router's passive popstate listener. */
export function OwnerNavigationBootstrap() {
  useLayoutEffect(() => {
    installOwnerNavigationGuards();
  }, []);

  return null;
}
