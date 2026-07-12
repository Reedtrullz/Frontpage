import type { HistoryCoverage } from "@/lib/metrics/types";

type HistoryTone = "positive" | "information" | "warning" | "failure" | "unknown";

interface LegendItem<T extends string> {
  value: T;
  label: string;
  tone: HistoryTone;
}

interface HistorySample<T extends string> {
  collectedAt: string;
  value: T;
  gapBefore: boolean;
}

interface HistorySegment<T extends string> {
  value: T;
  startAt: string;
  endAt: string;
  gapBefore: boolean;
  gapLabel?: string;
}

const toneClasses: Record<HistoryTone, string> = {
  positive: "bg-[var(--role-positive)]",
  information: "bg-[var(--role-info)]",
  warning: "bg-[var(--role-warning)]",
  failure: "bg-[var(--role-failure)]",
  unknown: "bg-[var(--border-strong)]",
};

function exactTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(new Date(value));
}

function relativeWindowLabel(value: string, windowEndAt: string): string {
  const elapsedHours = Math.round(
    (Date.parse(windowEndAt) - Date.parse(value)) / (60 * 60 * 1000),
  );
  return elapsedHours <= 0 ? "now" : `${elapsedHours}h ago`;
}

function compressSamples<T extends string>(
  samples: HistorySample<T>[],
  severity: T[],
  coverage: HistoryCoverage,
): HistorySegment<T>[] {
  if (samples.length === 0) return [];
  const windowStart = Date.parse(coverage.windowStartAt);
  const windowEnd = Date.parse(coverage.windowEndAt);
  const windowDuration = Math.max(1, windowEnd - windowStart);
  const midpoint = (left: number, right: number) => left + (right - left) / 2;
  const segments: HistorySegment<T>[] = [];
  const values = samples.map((sample) => ({
    ...sample,
    timestamp: Date.parse(sample.collectedAt),
  }));

  const unknown = (start: number, end: number, gapBefore: boolean, gapLabel: string) => {
    if (end <= start) return;
    segments.push({
      value: severity[severity.length - 1] as T,
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      gapBefore,
      gapLabel,
    });
  };

  const firstTimestamp = values[0]!.timestamp;
  if (coverage.leadingGap) {
    unknown(windowStart, firstTimestamp, true, "Coverage missing before first sample");
  }

  values.forEach((sample, index) => {
    const previous = values[index - 1]?.timestamp ?? windowStart;
    const next = values[index + 1]?.timestamp ?? windowEnd;
    const start = index === 0
      ? (coverage.leadingGap ? sample.timestamp : windowStart)
      : sample.gapBefore ? sample.timestamp : midpoint(previous, sample.timestamp);
    const end = index === values.length - 1
      ? (coverage.trailingGap ? sample.timestamp : windowEnd)
      : midpoint(sample.timestamp, next);
    if (sample.gapBefore && index > 0) {
      unknown(midpoint(previous, sample.timestamp), sample.timestamp, true, "Coverage missing before this sample");
    }
    if (end > start) {
      segments.push({
        value: sample.value,
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        gapBefore: sample.gapBefore,
      });
    }
  });

  if (coverage.trailingGap) {
    const lastTimestamp = values.at(-1)!.timestamp;
    unknown(lastTimestamp, windowEnd, true, "Coverage missing after last sample");
  }

  return segments.filter((segment) => {
    const start = (Date.parse(segment.startAt) - windowStart) / windowDuration;
    const end = (Date.parse(segment.endAt) - windowStart) / windowDuration;
    return end > 0 && start < 1;
  });
}

function coverageMessage(coverage?: HistoryCoverage): string | null {
  if (!coverage) return null;
  if (coverage.availability === "unavailable") return "History unavailable";
  if (coverage.availability === "empty") return "No recent samples";
  if (coverage.gapCount > 0) {
    return `${coverage.gapCount} gap${coverage.gapCount === 1 ? "" : "s"} in coverage`;
  }
  return null;
}

export function CoarseHistoryStrip<T extends string>({
  label,
  values,
  legend,
  history,
  coverage,
}: {
  label: string;
  values: T[];
  legend: Array<LegendItem<T>>;
  history?: Array<HistorySample<T>>;
  coverage?: HistoryCoverage;
}) {
  const labels = new Map(legend.map((item) => [item.value, item.label]));
  const tones = new Map(legend.map((item) => [item.value, item.tone]));
  const samples = history ?? values.map((value, index) => ({
    value,
    collectedAt: coverage?.windowEndAt ?? new Date(index).toISOString(),
    gapBefore: false,
  }));
  const compressed = coverage
    ? compressSamples(samples, legend.map((item) => item.value), coverage)
    : [];
  const summary = legend
    .map((item) => `${item.label} ${values.filter((value) => value === item.value).length}`)
    .join(", ");
  const message = coverageMessage(coverage);
  const showHistory = coverage?.availability !== "unavailable" && compressed.length > 0;

  return (
    <figure className="border-t border-[var(--border)] py-5 first:border-t-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <figcaption className="text-sm font-semibold text-[var(--text)]">{label}</figcaption>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--text-subtle)]" aria-label={`${label} legend`}>
          {legend.map((item) => (
            <span key={item.value} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 ${toneClasses[item.tone]}`} aria-hidden="true" />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      {message && (coverage?.availability !== "available" || coverage.gapCount > 0) ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">{message}</p>
      ) : null}
      {showHistory ? (
        <>
          <div className="relative mt-4 h-10 overflow-hidden bg-[var(--surface)]" role="img" aria-label={`${label} history: ${summary}`}>
            {compressed.map((segment, index) => {
              const start = segment.startAt ? exactTime(segment.startAt) : null;
              const end = segment.endAt ? exactTime(segment.endAt) : null;
              const valueLabel = labels.get(segment.value) ?? "Unknown";
              const context = start && end
                ? `${label}: ${valueLabel} from ${start}${start === end ? "" : ` to ${end}`}${segment.gapLabel ? `. ${segment.gapLabel}` : segment.gapBefore ? ". Coverage missing before this sample" : ""}`
                : `${label}: ${valueLabel}`;
              const left = Math.max(0, (Date.parse(segment.startAt) - Date.parse(coverage!.windowStartAt)) / (Date.parse(coverage!.windowEndAt) - Date.parse(coverage!.windowStartAt)) * 100);
              const width = Math.max(0, Math.min(100 - left, (Date.parse(segment.endAt) - Date.parse(segment.startAt)) / (Date.parse(coverage!.windowEndAt) - Date.parse(coverage!.windowStartAt)) * 100));
              return (
                <span key={`${segment.value}-${index}`} className={`absolute top-0 h-full ${toneClasses[tones.get(segment.value) ?? "unknown"]}`} style={{ left: `${left}%`, width: `${width}%` }} title={context} role="img" aria-label={context} />
              );
            })}
          </div>
          {coverage ? (
            <div className="mt-2 flex justify-between text-xs text-[var(--text-subtle)]" aria-label={`${label} time direction`}>
              <span>{relativeWindowLabel(coverage.windowStartAt, coverage.windowEndAt)}</span>
              {compressed.length > 2 ? <span>{relativeWindowLabel(new Date((Date.parse(coverage.windowStartAt) + Date.parse(coverage.windowEndAt)) / 2).toISOString(), coverage.windowEndAt)}</span> : null}
              <span>now</span>
            </div>
          ) : null}
        </>
      ) : null}
      {coverage?.availability === "available" && compressed.length === 0 && !message ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">No recent samples</p>
      ) : null}
    </figure>
  );
}
