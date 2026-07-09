interface RelativeTimeProps {
  value: string | Date;
  now?: Date;
  className?: string;
}

const units = [
  { seconds: 365 * 24 * 60 * 60, suffix: "y" },
  { seconds: 30 * 24 * 60 * 60, suffix: "mo" },
  { seconds: 24 * 60 * 60, suffix: "d" },
  { seconds: 60 * 60, suffix: "h" },
  { seconds: 60, suffix: "m" },
] as const;

function parseDate(value: string | Date): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("RelativeTime requires a valid date.");
  }
  return parsed;
}

export function formatRelativeTime(
  value: string | Date,
  now = new Date(),
): string {
  const seconds = Math.round((parseDate(value).getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 45) return "just now";

  const unit = units.find((candidate) => absolute >= candidate.seconds);
  if (!unit) return "just now";
  const amount = Math.round(absolute / unit.seconds);
  return seconds < 0 ? `${amount}${unit.suffix} ago` : `in ${amount}${unit.suffix}`;
}

function exactTime(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}

export function RelativeTime({ value, now, className }: RelativeTimeProps) {
  const date = parseDate(value);
  const exact = exactTime(date);
  return (
    <time
      dateTime={date.toISOString()}
      aria-label={exact}
      title={exact}
      className={className}
    >
      {formatRelativeTime(date, now)}
    </time>
  );
}
