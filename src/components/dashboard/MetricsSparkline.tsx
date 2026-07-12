import type { HistoryCoverage } from "@/lib/metrics/types";

interface MetricsSparklineProps {
  samples: Array<{
    collectedAt: string;
    value: number;
    gapBefore: boolean;
  }>;
  label: string;
  warningAt: number;
  criticalAt: number;
  coverage?: HistoryCoverage;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function historyMessage(coverage?: HistoryCoverage): string {
  if (coverage?.availability === "unavailable") return "History unavailable";
  if (coverage?.availability === "empty" || !coverage) return "No recent samples";
  return "Not enough recent samples for a trend.";
}

function coverageLabels(coverage?: HistoryCoverage): string[] | null {
  if (!coverage || coverage.availability !== "available") return null;
  return [
    "24-hour window",
    ...(coverage.gapCount > 0
      ? [`${coverage.gapCount} gap${coverage.gapCount === 1 ? "" : "s"} in coverage`]
      : []),
  ];
}

export function MetricsSparkline({
  samples,
  label,
  warningAt,
  criticalAt,
  coverage,
}: MetricsSparklineProps) {
  if (coverage?.availability !== "available" || samples.length < 2) {
    return (
      <figure className="min-h-32 rounded border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <figcaption className="text-sm font-semibold text-[var(--text)]">{label}</figcaption>
        <p className="mt-3 text-sm text-[var(--text-muted)]">{historyMessage(coverage)}</p>
        <p className="mt-2 text-xs text-[var(--text-subtle)]">Warning {warningAt}% / critical {criticalAt}%</p>
      </figure>
    );
  }

  const width = 320;
  const height = 80;
  const windowStart = Date.parse(coverage.windowStartAt);
  const windowDuration = Math.max(1, Date.parse(coverage.windowEndAt) - windowStart);
  const pointFor = (sample: MetricsSparklineProps["samples"][number]) => {
    const x = ((Date.parse(sample.collectedAt) - windowStart) / windowDuration) * width;
    const y = height - (Math.max(0, Math.min(100, sample.value)) / 100) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const segments: string[][] = [];
  for (const sample of samples) {
    if (sample.gapBefore && segments.at(-1)?.length) {
      segments.push([pointFor(sample)]);
    } else if (segments.length === 0) {
      segments.push([pointFor(sample)]);
    } else {
      segments.at(-1)!.push(pointFor(sample));
    }
  }
  const latest = rounded(samples.at(-1)?.value ?? 0);
  const minimum = rounded(Math.min(...samples.map((sample) => sample.value)));
  const maximum = rounded(Math.max(...samples.map((sample) => sample.value)));
  const warningY = height - (warningAt / 100) * height;
  const criticalY = height - (criticalAt / 100) * height;
  const windowLabels = coverageLabels(coverage);

  return (
    <figure className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-[var(--text)]">{label}</span>
        <span className="font-mono text-lg text-[var(--text)]">{latest}%</span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-20 w-full" role="img" aria-label={`${label} recent history. Latest ${latest} percent, range ${minimum} to ${maximum} percent. Warning at ${warningAt} percent and critical at ${criticalAt} percent.`}>
        <line x1="0" x2={width} y1={warningY} y2={warningY} stroke="var(--role-warning)" strokeWidth="1" strokeDasharray="4 4" />
        <line x1="0" x2={width} y1={criticalY} y2={criticalY} stroke="var(--role-failure)" strokeWidth="1" strokeDasharray="4 4" />
        {segments.map((points, index) => (
          <polyline key={index} fill="none" stroke="var(--role-info)" strokeWidth="2" points={points.join(" ")} />
        ))}
      </svg>
      <p className="mt-3 text-xs text-[var(--text-subtle)]">
        Range {minimum}%–{maximum}% / warning {warningAt}% / critical {criticalAt}%
        {windowLabels?.map((label) => ` / ${label}`).join("")}
      </p>
    </figure>
  );
}
