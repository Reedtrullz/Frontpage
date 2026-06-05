"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin route error", error);
  }, [error]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-green-500">
        Admin error
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-zinc-100">
        Something went wrong.
      </h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-400">
        The admin panel hit an unexpected issue. You can try again, or reload the
        page if the problem persists.
      </p>
      <p className="mt-4 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
        {error.message}
      </p>
      <button
        onClick={() => reset()}
        className="mt-6 rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-green-500 transition-colors hover:border-green-500/50 hover:text-green-400"
      >
        Try again
      </button>
    </div>
  );
}
