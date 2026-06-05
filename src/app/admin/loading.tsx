export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center rounded border border-zinc-800 bg-zinc-950 px-6 py-12">
      <div className="flex items-center gap-3 text-sm text-zinc-400">
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-green-500"
          aria-hidden="true"
        />
        <span className="font-mono text-green-500">Loading...</span>
      </div>
    </div>
  );
}
