"use client";

import Link from "next/link";
import { House, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import {
  getPublicErrorCopy,
  type PublicErrorScope,
} from "@/lib/public-errors";

interface PublicErrorPanelProps {
  error: Error & { digest?: string };
  reset: () => void;
  scope?: PublicErrorScope;
}

export function PublicErrorPanel({
  error,
  reset,
  scope = "default",
}: PublicErrorPanelProps) {
  const copy = getPublicErrorCopy(scope, error);

  useEffect(() => {
    console.error(`Public ${scope} route error`, {
      digest: error.digest ?? "unavailable",
    });
  }, [error.digest, scope]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-7xl items-center px-4 py-16 sm:px-6">
      <section className="max-w-2xl border-l-2 border-[var(--role-failure)] pl-6 sm:pl-10">
        <TriangleAlert className="h-7 w-7 text-[var(--role-failure)]" aria-hidden="true" />
        <p className="mt-5 font-mono text-sm text-[var(--role-failure)]">{copy.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold text-[var(--text)]">{copy.title}</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-[var(--text-muted)]">{copy.description}</p>
        <div className="mt-8 flex flex-wrap gap-4">
          <button type="button" onClick={reset} className="primary-command">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
          <Link href="/" className="secondary-command">
            <House className="h-4 w-4" aria-hidden="true" />
            Back home
          </Link>
        </div>
      </section>
    </div>
  );
}
