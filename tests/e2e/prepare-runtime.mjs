import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const outputDir = path.join(rootDir, "tests", "e2e", ".metrics");
const dataDir = path.join(rootDir, "tests", "e2e", ".data");
fs.mkdirSync(outputDir, { recursive: true });
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
