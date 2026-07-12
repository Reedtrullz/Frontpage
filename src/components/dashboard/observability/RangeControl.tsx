"use client";

import type { ObservabilityRange } from "@/lib/metrics/v2/types";

const ranges: Array<{ value: ObservabilityRange; label: string }> = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export function RangeControl({
  value,
  onChange,
}: {
  value: ObservabilityRange;
  onChange: (value: ObservabilityRange) => void;
}) {
  return (
    <div aria-label="History range" className="grid w-full grid-cols-4 border border-[var(--border)] sm:inline-grid sm:w-auto" role="group">
      {ranges.map((range) => (
        <button
          aria-label={range.label}
          aria-pressed={value === range.value}
          className="min-h-11 min-w-0 border-r border-[var(--border)] px-2 text-xs font-semibold text-[var(--text-muted)] last:border-r-0 aria-pressed:bg-[var(--surface-overlay)] aria-pressed:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] sm:px-3"
          key={range.value}
          onClick={() => onChange(range.value)}
          type="button"
        >
          {range.value}
        </button>
      ))}
    </div>
  );
}
