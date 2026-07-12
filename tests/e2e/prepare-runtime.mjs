import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const outputDir = path.join(rootDir, "tests", "e2e", ".metrics");
const publicV2Dir = path.join(rootDir, "tests", "e2e", ".metrics-v2-public");
const ownerV2Dir = path.join(rootDir, "tests", "e2e", ".metrics-v2-owner");
const dataDir = path.join(rootDir, "tests", "e2e", ".data");
fs.mkdirSync(outputDir, { recursive: true });
for (const directory of [publicV2Dir, ownerV2Dir]) {
  fs.rmSync(directory, { force: true, recursive: true });
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 });
}
fs.rmSync(dataDir, { force: true, recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const now = Date.now();
const cpu = [18, 32, 64, 88, 52, 27, 21, 24];
const ram = [42, 45, 48, 61, 66, 58, 54, 52];
const disk = [55, 56, 58, 76, 77, 72, 68, 64];

function snapshot(index) {
  const collectedAt = new Date(now - (cpu.length - 1 - index) * 10 * 60_000).toISOString();
  return {
    schema_version: 1,
    collected_at: collectedAt,
    host: {
      cpu_percent: cpu[index],
      ram_used_bytes: ram[index] * 1_000_000,
      ram_total_bytes: 100_000_000,
      disk_used_bytes: disk[index] * 1_000_000,
      disk_total_bytes: 100_000_000,
      load_1m: 0.42,
      load_5m: 0.36,
      load_15m: 0.31,
      uptime_seconds: 864_000,
    },
    services: [
      {
        id: "frontpage-public",
        label: "Frontpage",
        project_slug: "frontpage",
        visibility: "public",
        status: "up",
        checked_at: collectedAt,
        latency_ms: 42,
      },
      {
        id: "nytt-public",
        label: "Nytt",
        project_slug: "nytt",
        visibility: "public",
        status: "up",
        checked_at: collectedAt,
        latency_ms: 55,
      },
      {
        id: "rfs-public",
        label: "RFS",
        project_slug: "rfs",
        visibility: "public",
        status: "up",
        checked_at: collectedAt,
        latency_ms: 68,
      },
      {
        id: "rfmc-public",
        label: "RFMC / VirtualCDU",
        project_slug: "rfmc",
        visibility: "public",
        status: "up",
        checked_at: collectedAt,
        latency_ms: 81,
      },
      {
        id: "heimdall-public",
        label: "Heimdall",
        project_slug: "heimdall",
        visibility: "public",
        status: "up",
        checked_at: collectedAt,
        latency_ms: 94,
      },
      {
        id: "frontpage-internal",
        label: "Frontpage internal",
        project_slug: "frontpage",
        visibility: "owner",
        status: "down",
        checked_at: collectedAt,
        latency_ms: null,
      },
    ],
    containers: [
      {
        id: "frontpage-container",
        label: "Frontpage container",
        project_slug: "frontpage",
        status: "up",
        checked_at: collectedAt,
      },
    ],
  };
}

const samples = cpu.map((_, index) => snapshot(index));
fs.writeFileSync(
  path.join(outputDir, "latest.json"),
  `${JSON.stringify(samples.at(-1), null, 2)}\n`,
);

function utc(timestamp) {
  return new Date(timestamp).toISOString().replace(".000Z", "Z");
}

function writeProjection(root, relative, payload) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o750 });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o640 });
}

const generatedAt = utc(now);
const publicServices = samples.at(-1).services
  .filter((service) => service.visibility === "public")
  .map((service) => ({
    id: service.id,
    label: service.label,
    status: service.status,
    checked_at: generatedAt,
    latency_ms: service.latency_ms,
    availability_percent: 100,
    coverage_percent: 100,
  }));
const publicLatestV2 = {
  schema_version: 2,
  generated_at: generatedAt,
  collected_at: generatedAt,
  freshness: "fresh",
  overall_state: "operational",
  resources: [
    { resource: "cpu", label: "CPU", state: "healthy", coverage_percent: 100 },
    { resource: "ram", label: "RAM", state: "healthy", coverage_percent: 100 },
    { resource: "disk_io", label: "Disk I/O", state: "healthy", coverage_percent: 100 },
    { resource: "network", label: "Network", state: "healthy", coverage_percent: 100 },
  ],
  services: publicServices,
};
const publicIncident = {
  id: "public-recovered-e2e",
  rule_id: "public-service-failure",
  title: "Public checks recovered after a brief disruption",
  severity: "warning",
  state: "recovered",
  visibility: "public",
  resource: "network",
  opened_at: utc(now - 90 * 60_000),
  updated_at: utc(now - 85 * 60_000),
  resolved_at: utc(now - 85 * 60_000),
  coverage_percent: 100,
  capability_state: "available",
  summary: "Public availability recovered after a brief check disruption.",
};
writeProjection(publicV2Dir, "latest.v2.json", publicLatestV2);
writeProjection(publicV2Dir, "incidents.v2.json", {
  schema_version: 2,
  generated_at: generatedAt,
  incidents: [publicIncident],
});

const ownerFixture = JSON.parse(
  fs.readFileSync(path.join(rootDir, "ops/tests/fixtures/observability-v2/owner-latest.json"), "utf8"),
);
ownerFixture.generated_at = generatedAt;
ownerFixture.collected_at = generatedAt;
ownerFixture.freshness = "fresh";
for (const total of ownerFixture.host.totals) {
  total.updated_at = generatedAt;
  total.freshness = "fresh";
}
for (const incident of ownerFixture.incidents) {
  incident.opened_at = utc(now - 70 * 60_000);
  incident.updated_at = utc(now - 65 * 60_000);
  incident.resolved_at = utc(now - 65 * 60_000);
  for (const [index, point] of (incident.evidence?.points ?? []).entries()) {
    point.recorded_at = utc(now - (70 - index * 5) * 60_000);
  }
}
writeProjection(ownerV2Dir, "latest.v2.json", ownerFixture);
writeProjection(ownerV2Dir, "incidents.v2.json", {
  schema_version: 2,
  generated_at: generatedAt,
  incidents: ownerFixture.incidents,
});

function hostSeries(range, resolution, count) {
  const timestamps = Array.from({ length: count }, (_, index) =>
    utc(now - (count - 1 - index) * resolution * 1000),
  );
  return {
    schema_version: 2,
    generated_at: generatedAt,
    range,
    resolution_seconds: resolution,
    view: "host",
    resource: null,
    timestamps,
    series: [
      { id: "cpu-total", label: "CPU total", unit: "percent", values: timestamps.map((_, index) => index % 37 === 0 ? null : 25 + Math.sin(index / 8) * 12) },
      { id: "ram-used", label: "RAM used", unit: "bytes", values: timestamps.map((_, index) => 48 * 1024 ** 3 + Math.sin(index / 12) * 1024 ** 3) },
      { id: "disk-io-total", label: "Disk I/O total", unit: "bytes_per_second", values: timestamps.map((_, index) => 320_000 + (index % 9) * 28_000) },
      { id: "network-total", label: "Network total", unit: "bytes_per_second", values: timestamps.map((_, index) => 110_000 + (index % 13) * 15_000) },
    ],
    coverage_percent: 98.8,
    truncated: false,
  };
}

const host1h = hostSeries("1h", 15, 240);
const minute = hostSeries("24h", 60, 1440);
const quarterHour = hostSeries("30d", 900, 2880);
const day = generatedAt.slice(0, 10);
writeProjection(ownerV2Dir, "host/1h.v2.json", host1h);
writeProjection(ownerV2Dir, `host/minute/${day}.v2.json`, minute);
writeProjection(ownerV2Dir, `host/quarter-hour/${day}.v2.json`, quarterHour);

function workloadSeries(resource, unit, values) {
  return {
    schema_version: 2,
    generated_at: generatedAt,
    range: "1h",
    resolution_seconds: 15,
    view: "workloads",
    resource,
    timestamps: host1h.timestamps,
    series: [
      { id: "frontpage-app", label: "frontpage-app", unit, values: values.map((value) => value * 0.6) },
      { id: "system-untracked", label: "system/untracked", unit, values: values.map((value) => value * 0.4) },
    ],
    coverage_percent: 96,
    truncated: false,
  };
}
for (const [resource, seriesId] of [["cpu", "cpu-total"], ["ram", "ram-used"], ["disk_io", "disk-io-total"]]) {
  const source = host1h.series.find((series) => series.id === seriesId);
  const values = source.values.map((value) => value ?? 0);
  writeProjection(
    ownerV2Dir,
    `workloads/${resource}/1h.v2.json`,
    workloadSeries(resource, source.unit, values),
  );
}
const manifestFiles = [
  "latest.v2.json",
  "incidents.v2.json",
  "host/1h.v2.json",
  `host/minute/${day}.v2.json`,
  `host/quarter-hour/${day}.v2.json`,
  "workloads/cpu/1h.v2.json",
  "workloads/ram/1h.v2.json",
  "workloads/disk_io/1h.v2.json",
];
writeProjection(ownerV2Dir, "manifest.v2.json", { schema_version: 2, files: manifestFiles });
fs.writeFileSync(
  path.join(outputDir, "history.json"),
  `${JSON.stringify({ schema_version: 1, samples }, null, 2)}\n`,
);

const standaloneDir = path.join(rootDir, ".next", "standalone");
const serverPath = path.join(standaloneDir, "server.js");

if (!fs.existsSync(serverPath)) {
  throw new Error(
    "Missing standalone build. Run `npm run build` before the browser suite.",
  );
}

for (const [source, target] of [
  [path.join(rootDir, "public"), path.join(standaloneDir, "public")],
  [
    path.join(rootDir, ".next", "static"),
    path.join(standaloneDir, ".next", "static"),
  ],
]) {
  fs.rmSync(target, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}
