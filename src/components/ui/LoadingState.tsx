interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = "Loading current data" }: LoadingStateProps) {
  return (
    <div className="mx-auto flex min-h-[45vh] max-w-7xl items-center px-4 py-16 sm:px-6" role="status">
      <div className="flex items-center gap-3 text-[var(--text-muted)]">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]" aria-hidden="true" />
        <span className="font-mono text-sm">{label}</span>
      </div>
    </div>
  );
}
