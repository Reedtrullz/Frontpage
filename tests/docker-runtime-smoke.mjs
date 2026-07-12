import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing ${name} argument`);
  }
  return process.argv[index + 1];
}

function docker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getText(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timeout);
  }
}

function writeMetrics(metricsDir) {
  fs.mkdirSync(metricsDir, { recursive: true, mode: 0o750 });
  const collectedAt = new Date().toISOString();
  const snapshot = {
    schema_version: 1,
    collected_at: collectedAt,
    host: {
      cpu_percent: 42,
      ram_used_bytes: 42_000_000,
      ram_total_bytes: 100_000_000,
      disk_used_bytes: 58_000_000,
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

  fs.writeFileSync(path.join(metricsDir, "latest.json"), `${JSON.stringify(snapshot)}\n`);
  fs.writeFileSync(
    path.join(metricsDir, "history.json"),
    `${JSON.stringify({ schema_version: 1, samples: [snapshot] })}\n`,
  );
  fs.chmodSync(path.join(metricsDir, "latest.json"), 0o640);
  fs.chmodSync(path.join(metricsDir, "history.json"), 0o640);
  fs.chmodSync(metricsDir, 0o750);
}

function writeV2Metrics(publicDir, ownerDir) {
  const timestamp = new Date().toISOString();
  const publicLatest = {
    schema_version: 2,
    generated_at: timestamp,
    collected_at: timestamp,
    freshness: "fresh",
    overall_state: "operational",
    resources: [
      { resource: "cpu", label: "CPU", state: "healthy", coverage_percent: 100 },
      { resource: "ram", label: "RAM", state: "healthy", coverage_percent: 100 },
      { resource: "disk_io", label: "Disk I/O", state: "healthy", coverage_percent: 100 },
      { resource: "network", label: "Network", state: "healthy", coverage_percent: 100 },
    ],
    services: [{ id: "frontpage-public", label: "Frontpage", status: "up", checked_at: timestamp, latency_ms: 20, availability_percent: 100, coverage_percent: 100 }],
  };
  const incidents = { schema_version: 2, generated_at: timestamp, incidents: [] };
  const ownerLatest = {
    schema_version: 2,
    generated_at: timestamp,
    collected_at: timestamp,
    freshness: "fresh",
    host: {
      totals: [
        { resource: "cpu", label: "CPU total", unit: "percent", current: 42, average: 40, peak: 50, state: "healthy", freshness: "fresh", updated_at: timestamp, attribution_coverage_percent: 100, reconciliation_error_percent: 0, workload_view: "available" },
      ],
      capabilities: [],
    },
    workloads: [],
    diagnostics: [],
    incidents: [],
  };
  const series = {
    schema_version: 2,
    generated_at: timestamp,
    range: "1h",
    resolution_seconds: 15,
    view: "host",
    resource: null,
    timestamps: [timestamp],
    series: [{ id: "cpu-total", label: "CPU total", unit: "percent", values: [42] }],
    coverage_percent: 100,
    truncated: false,
  };
  for (const directory of [publicDir, ownerDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o750 });
  for (const [target, payload] of [
    [path.join(publicDir, "latest.v2.json"), publicLatest],
    [path.join(publicDir, "incidents.v2.json"), incidents],
    [path.join(ownerDir, "latest.v2.json"), ownerLatest],
    [path.join(ownerDir, "incidents.v2.json"), incidents],
    [path.join(ownerDir, "host", "1h.v2.json"), series],
    [path.join(ownerDir, "manifest.v2.json"), { schema_version: 2, files: ["latest.v2.json", "incidents.v2.json", "host/1h.v2.json"] }],
  ]) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o750 });
    fs.writeFileSync(target, `${JSON.stringify(payload)}\n`, { mode: 0o640 });
  }
}

function assertMode(filePath, expectedMode) {
  const actualMode = fs.statSync(filePath).mode & 0o777;
  if (actualMode !== expectedMode) {
    throw new Error(
      `${filePath} mode ${actualMode.toString(8)} did not match ${expectedMode.toString(8)}`,
    );
  }
}

async function poll(label, check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(1_000);
  }
  throw new Error(`${label} did not pass before timeout${lastError ? `: ${lastError.message}` : ""}`);
}

async function main() {
  const image = argument("--image");
  const version = argument("--version");
  const metricsDir = fs.mkdtempSync(
    path.join(process.cwd(), ".docker-runtime-smoke-"),
  );
  const publicV2Dir = path.join(metricsDir, "public");
  const ownerV2Dir = path.join(metricsDir, "owner");
  const v1Dir = path.join(metricsDir, "v1");
  const container = `frontpage-smoke-${process.pid}-${Date.now()}`;
  writeMetrics(v1Dir);
  writeV2Metrics(publicV2Dir, ownerV2Dir);
  assertMode(v1Dir, 0o750);
  assertMode(path.join(v1Dir, "latest.json"), 0o640);
  assertMode(path.join(publicV2Dir, "latest.v2.json"), 0o640);
  assertMode(path.join(ownerV2Dir, "latest.v2.json"), 0o640);
  const metricsGroupId = String(fs.statSync(metricsDir).gid);

  try {
    docker([
      "run",
      "--detach",
      "--name",
      container,
      "--publish",
      "127.0.0.1::3000",
      "--env",
      "NODE_ENV=production",
      "--env",
      "PORT=3000",
      "--env",
      "HOSTNAME=0.0.0.0",
      "--env",
      "AUTH_SECRET=frontpage-docker-smoke-secret",
      "--env",
      "AUTH_URL=http://127.0.0.1",
      "--env",
      `VERSION=${version}`,
      "--env",
      "METRICS_DIR=/metrics",
      "--env",
      "PUBLIC_METRICS_DIR=/metrics-public",
      "--env",
      "OWNER_METRICS_DIR=/metrics-owner",
      "--env",
      "FRONTPAGE_OBSERVABILITY_V2=1",
      "--volume",
      `${v1Dir}:/metrics:ro`,
      "--volume",
      `${publicV2Dir}:/metrics-public:ro`,
      "--volume",
      `${ownerV2Dir}:/metrics-owner:ro`,
      "--group-add",
      metricsGroupId,
      image,
    ]);

    const mapping = await poll("Docker port mapping", () => docker(["port", container, "3000/tcp"]));
    const port = mapping.split(":").at(-1);
    const baseUrl = `http://127.0.0.1:${port}`;

    await poll("application health", async () => {
      const { response, text } = await getText(`${baseUrl}/api/health`);
      return response.status === 200 && text.includes('"status":"healthy"');
    });

    const containerEnvironment = docker([
      "inspect",
      "--format",
      "{{range .Config.Env}}{{println .}}{{end}}",
      container,
    ]);
    if (!containerEnvironment.split("\n").includes(`VERSION=${version}`)) {
      throw new Error(`Container VERSION did not match ${version}`);
    }

    for (const route of ["/", "/status"]) {
      const { response } = await getText(`${baseUrl}${route}`);
      if (response.status !== 200) throw new Error(`${route} returned HTTP ${response.status}`);
    }

    const statusPage = await getText(`${baseUrl}/status`);
    for (const privateMarker of [
      "cpu_percent",
      "ram_used_bytes",
      "disk_used_bytes",
      "uptime_seconds",
      "frontpage-internal",
      "frontpage-container",
      "Collector diagnostics",
      "Owner status",
    ]) {
      if (statusPage.text.includes(privateMarker)) {
        throw new Error(`Public status leaked private marker: ${privateMarker}`);
      }
    }

    const ownerApi = await getText(`${baseUrl}/api/owner/metrics?range=1h&view=host`);
    if (ownerApi.response.status !== 401) {
      throw new Error(`Anonymous owner metrics API returned ${ownerApi.response.status}, expected 401`);
    }

    const healthStatus = await poll("Docker healthcheck", () => {
      const value = docker(["inspect", "--format", "{{.State.Health.Status}}", container]);
      return value === "healthy" ? value : false;
    });
    if (healthStatus !== "healthy") throw new Error("Container healthcheck did not become healthy");

    docker([
      "exec",
      container,
      "node",
      "-e",
      "const fs=require('fs'); for(const file of ['/metrics/latest.json','/metrics-public/latest.v2.json','/metrics-owner/latest.v2.json'])fs.accessSync(file,fs.constants.R_OK); if(fs.existsSync('/metrics-private')||fs.existsSync('/metrics-owner/metrics-v2.sqlite3'))process.exit(3); for(const dir of ['/metrics','/metrics-public','/metrics-owner']){try{fs.writeFileSync(dir+'/write-test','x');process.exit(2)}catch{}}",
    ]);

    console.log(`Docker runtime smoke passed for ${image} (${version})`);
  } finally {
    try {
      docker(["rm", "--force", container], { stdio: "ignore" });
    } catch {
      // The container may not have started.
    }
    fs.rmSync(metricsDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
