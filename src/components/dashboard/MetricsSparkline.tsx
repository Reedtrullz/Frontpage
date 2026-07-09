interface MetricsSparklineProps {
  values: number[];
  label: string;
}

export function MetricsSparkline({ values, label }: MetricsSparklineProps) {
  if (values.length < 2) {
    return (
      <div className="h-10 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-3 font-mono text-[11px] text-zinc-600">
        {label}: no history
      </div>
    );
  }

  const width = 120;
  const height = 32;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - (Math.max(0, Math.min(100, value)) / 100) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <figure className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
      <figcaption className="mb-1 font-mono text-[11px] text-zinc-500">
        {label}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-8 w-full"
        role="img"
        aria-label={`${label} 24 hour sparkline`}
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={points}
          className="text-cyan-300"
        />
      </svg>
    </figure>
  );
}
