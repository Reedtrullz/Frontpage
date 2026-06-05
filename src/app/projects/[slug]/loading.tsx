export default function Loading() {
  return (
    <div className="min-h-[50vh] bg-zinc-950 px-6 py-16">
      <div className="mx-auto flex max-w-5xl items-center gap-3 text-green-500">
        <div
          className="h-4 w-4 animate-spin rounded-full border-2 border-green-500 border-t-transparent"
          aria-hidden="true"
        />
        <p className="font-mono text-sm uppercase tracking-[0.2em]">Loading...</p>
      </div>
    </div>
  );
}
