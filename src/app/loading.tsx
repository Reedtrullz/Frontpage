export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6">
      <div className="flex items-center gap-3 text-green-500">
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-800 border-t-green-500"
          aria-hidden="true"
        />
        <span className="font-mono text-sm tracking-[0.2em]">Loading...</span>
      </div>
    </div>
  );
}
