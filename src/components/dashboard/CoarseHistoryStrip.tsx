type HistoryTone = "positive" | "information" | "warning" | "failure" | "unknown";

interface LegendItem<T extends string> {
  value: T;
  label: string;
  tone: HistoryTone;
}

const toneClasses: Record<HistoryTone, string> = {
  positive: "bg-[var(--role-positive)]",
  information: "bg-[var(--role-info)]",
  warning: "bg-[var(--role-warning)]",
  failure: "bg-[var(--role-failure)]",
  unknown: "bg-[var(--border-strong)]",
};

function compressValues<T extends string>(
  values: T[],
  severity: T[],
  maximum = 96,
): T[] {
  if (values.length <= maximum) return values;
  const size = Math.ceil(values.length / maximum);
  const severityIndex = new Map(severity.map((value, index) => [value, index]));
  const compressed: T[] = [];
  for (let index = 0; index < values.length; index += size) {
    const group = values.slice(index, index + size);
    compressed.push(
      group.toSorted(
        (left, right) =>
          (severityIndex.get(right) ?? 0) - (severityIndex.get(left) ?? 0),
      )[0],
    );
  }
  return compressed;
}

export function CoarseHistoryStrip<T extends string>({
  label,
  values,
  legend,
}: {
  label: string;
  values: T[];
  legend: Array<LegendItem<T>>;
}) {
  const labels = new Map(legend.map((item) => [item.value, item.label]));
  const tones = new Map(legend.map((item) => [item.value, item.tone]));
  const compressed = compressValues(values, legend.map((item) => item.value));
  const summary = legend
    .map((item) => `${item.label} ${values.filter((value) => value === item.value).length}`)
    .join(", ");

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
      {compressed.length > 0 ? (
        <div
          className="mt-4 grid h-10 gap-px overflow-hidden bg-[var(--surface)]"
          style={{ gridTemplateColumns: `repeat(${compressed.length}, minmax(2px, 1fr))` }}
          role="img"
          aria-label={`${label} over the available 24-hour window: ${summary}`}
        >
          {compressed.map((value, index) => (
            <span
              key={`${value}-${index}`}
              className={toneClasses[tones.get(value) ?? "unknown"]}
              title={labels.get(value)}
              aria-hidden="true"
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--text-muted)]">No 24-hour history available.</p>
      )}
    </figure>
  );
}
