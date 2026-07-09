import type { CheckStatus, MetricsFreshness } from "@/lib/metrics/types";

const statusClasses: Record<CheckStatus | MetricsFreshness, string> = {
  up: "border-green-500/30 bg-green-500/10 text-green-300",
  down: "border-red-500/30 bg-red-500/10 text-red-300",
  unknown: "border-zinc-700 bg-zinc-900 text-zinc-400",
  fresh: "border-green-500/30 bg-green-500/10 text-green-300",
  stale: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  unavailable: "border-zinc-700 bg-zinc-900 text-zinc-400",
};

interface StatusTokenProps {
  value: CheckStatus | MetricsFreshness;
  label?: string;
}

export function StatusToken({ value, label = value }: StatusTokenProps) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11px] uppercase ${statusClasses[value]}`}
    >
      {label}
    </span>
  );
}
