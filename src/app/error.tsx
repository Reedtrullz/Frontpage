'use client';

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-8 shadow-2xl shadow-black/20">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-green-500">
          Unexpected error
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-100">
          Something went wrong.
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          The page hit a problem and could not finish loading. You can try
          again, or return home and continue from there.
        </p>

        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="font-mono text-xs text-zinc-500">Error details</p>
          <p className="mt-2 break-words font-mono text-sm text-zinc-300">
            {error.message || "Unknown error"}
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-green-500/40 hover:text-green-400"
          >
            Back home
          </Link>
        </div>
      </div>
    </div>
  );
}
