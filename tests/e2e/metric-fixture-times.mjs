export function alignedTimestamps(nowMs, count, resolutionSeconds) {
  const intervalMs = resolutionSeconds * 1000;
  const lastClosedSlotMs = Math.floor(nowMs / intervalMs) * intervalMs;
  return Array.from({ length: count }, (_, index) =>
    new Date(lastClosedSlotMs - (count - 1 - index) * intervalMs)
      .toISOString()
      .replace(".000Z", "Z"),
  );
}
