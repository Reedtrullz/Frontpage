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
  const container = `frontpage-smoke-${process.pid}-${Date.now()}`;
  writeMetrics(metricsDir);
  assertMode(metricsDir, 0o750);
  assertMode(path.join(metricsDir, "latest.json"), 0o640);
  assertMode(path.join(metricsDir, "history.json"), 0o640);
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
      "--volume",
      `${metricsDir}:/metrics:ro`,
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
      "const fs=require('fs'); fs.accessSync('/metrics/latest.json', fs.constants.R_OK); try { fs.writeFileSync('/metrics/write-test', 'x'); process.exit(2); } catch { process.exit(0); }",
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
