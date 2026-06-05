'use client';

import { useEffect } from 'react';

interface ProjectErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorBoundary({ error, reset }: ProjectErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-green-500">
          Project error
        </p>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-zinc-100">
          Something went wrong while loading this project.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">
          Try again in a moment. If the problem keeps happening, the project may
          have an issue with its data or rendering.
        </p>

        <div className="mt-8 flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-green-400 transition-colors hover:border-green-500 hover:text-green-300"
          >
            Try again
          </button>
          {error.digest ? (
            <span className="font-mono text-xs text-zinc-500">
              Digest: {error.digest}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
