interface MetricsSparklineProps {
  values: number[];
  label: string;
  warningAt: number;
  criticalAt: number;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export function MetricsSparkline({
  values,
  label,
  warningAt,
  criticalAt,
}: MetricsSparklineProps) {
  if (values.length < 2) {
    return (
      <figure className="min-h-32 rounded border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <figcaption className="text-sm font-semibold text-[var(--text)]">{label}</figcaption>
        <p className="mt-3 text-sm text-[var(--text-muted)]">No 24-hour trend is available.</p>
        <p className="mt-2 text-xs text-[var(--text-subtle)]">Warning {warningAt}% / critical {criticalAt}%</p>
      </figure>
    );
  }

  const width = 320;
  const height = 80;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - (Math.max(0, Math.min(100, value)) / 100) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const latest = rounded(values.at(-1) ?? 0);
  const minimum = rounded(Math.min(...values));
  const maximum = rounded(Math.max(...values));
  const warningY = height - (warningAt / 100) * height;
  const criticalY = height - (criticalAt / 100) * height;

  return (
    <figure className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-[var(--text)]">{label}</span>
        <span className="font-mono text-lg text-[var(--text)]">{latest}%</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-4 h-20 w-full"
        role="img"
        aria-label={`${label} 24-hour trend. Latest ${latest} percent, range ${minimum} to ${maximum} percent. Warning at ${warningAt} percent and critical at ${criticalAt} percent.`}
      >
        <line x1="0" x2={width} y1={warningY} y2={warningY} stroke="var(--role-warning)" strokeWidth="1" strokeDasharray="4 4" />
        <line x1="0" x2={width} y1={criticalY} y2={criticalY} stroke="var(--role-failure)" strokeWidth="1" strokeDasharray="4 4" />
        <polyline fill="none" stroke="var(--role-info)" strokeWidth="2" points={points} />
      </svg>
      <p className="mt-3 text-xs text-[var(--text-subtle)]">
        Range {minimum}%–{maximum}% / warning {warningAt}% / critical {criticalAt}%
      </p>
    </figure>
  );
}
