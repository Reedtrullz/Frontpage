export const MANIFEST_PATH_PATTERN = /^(?:latest|incidents)\.v2\.json$|^host\/1h\.v2\.json$|^host\/(?:minute|quarter-hour)\/\d{4}-\d{2}-\d{2}\.v2\.json$|^workloads\/(?:cpu|ram|disk_io|network)\/1h\.v2\.json$|^workloads\/(?:cpu|ram|disk_io|network)\/(?:minute|quarter-hour)\/\d{4}-\d{2}-\d{2}\.v2\.json$/;

export function projectionCap(relative: string): number {
  return relative.includes("/") ? 4 * 1024 * 1024 : 512 * 1024;
}
