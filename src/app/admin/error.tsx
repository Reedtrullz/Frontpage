"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Owner workspace route error", error);
  }, [error]);

  return (
    <section className="border-l-2 border-[var(--role-failure)] py-4 pl-6">
      <TriangleAlert className="h-6 w-6 text-[var(--role-failure)]" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-semibold text-[var(--text)]">Owner workspace unavailable</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-muted)]">The workspace could not load. Draft files were not changed.</p>
      <button type="button" onClick={reset} className="primary-command mt-6"><RotateCcw className="h-4 w-4" aria-hidden="true" />Try again</button>
    </section>
  );
}
