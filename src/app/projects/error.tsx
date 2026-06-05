"use client";

import { useEffect } from "react";

type ErrorBoundaryProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] bg-zinc-950 px-6 py-16 text-green-500">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-lg shadow-black/20">
        <div className="space-y-2">
          <p className="text-sm font-mono uppercase tracking-[0.3em] text-green-400/80">
            Projects error
          </p>
          <h1 className="text-2xl font-semibold text-green-400">
            Something went wrong while loading projects.
          </h1>
          <p className="text-sm leading-6 text-zinc-300">
            Try again in a moment. If the issue keeps happening, the error has
            been logged for debugging.
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 font-mono text-sm text-zinc-400">
          {error.message}
        </div>

        <div>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center rounded-md border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400 transition hover:border-green-400 hover:bg-green-500/20 hover:text-green-300 focus:outline-none focus:ring-2 focus:ring-green-500/50"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
