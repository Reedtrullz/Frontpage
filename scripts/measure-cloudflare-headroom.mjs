#!/usr/bin/env node
import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, constants as fsConstants } from "node:fs";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const FULL_SHA = /^[a-f0-9]{40}$/;
const MAX_REQUESTS = 2_000;
const MIN_REQUESTS_FOR_ALL_STAGES = 181;
const MAX_STAGE_SECONDS = 60;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const WRITER_COST = 3;
const CYCLE_COST = 60;
const PUBLIC_ROUTES = ["/", "/projects", "/status", "/api/health"];
const OWNER_ROUTES = ["/api/owner/metrics?range=1h&view=host", "/api/owner/incidents"];

export function validateBenchmarkTarget({ baseUrl, expectedSha, maxRequests, approval }) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Base URL must be a valid HTTPS origin.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Benchmark target must be a clean HTTPS origin.");
  }
  if (!FULL_SHA.test(expectedSha)) throw new Error("Expected version must be a full lowercase commit SHA.");
  if (parsed.hostname === "reidar.tech" || parsed.hostname.endsWith(".reidar.tech") || parsed.hostname === "frontpage.reidjoss.workers.dev") {
    throw new Error("Benchmark refuses a production origin.");
  }
  if (approval.FRONTPAGE_BENCHMARK_ISOLATED_APPROVED !== "1") throw new Error("An isolated approval is required via FRONTPAGE_BENCHMARK_ISOLATED_APPROVED=1.");
  if (approval.FRONTPAGE_BENCHMARK_COORDINATED !== "1") throw new Error("An explicitly coordinated run is required via FRONTPAGE_BENCHMARK_COORDINATED=1.");
  if (approval.FRONTPAGE_BENCHMARK_ALLOWED_ORIGIN !== parsed.origin) throw new Error("Target must exactly match FRONTPAGE_BENCHMARK_ALLOWED_ORIGIN.");
  const budgetReference = approval.FRONTPAGE_BENCHMARK_BUDGET_REFERENCE?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9 .:#/_-]{0,119}$/.test(budgetReference)) throw new Error("A short, non-secret provider budget evidence reference is required.");
  const configuredBudget = Number(approval.FRONTPAGE_BENCHMARK_MAX_REQUESTS);
  if (!Number.isInteger(maxRequests) || maxRequests > MAX_REQUESTS) throw new Error("Benchmark has a hard 2000-request ceiling including preflight and collector requests.");
  if (maxRequests < MIN_REQUESTS_FOR_ALL_STAGES) throw new Error("Request cap must be at least 181 so all three bounded concurrency stages can include a collector generation.");
  if (!Number.isInteger(configuredBudget) || configuredBudget < MIN_REQUESTS_FOR_ALL_STAGES || configuredBudget > MAX_REQUESTS || maxRequests > configuredBudget) {
    throw new Error("Requested load exceeds the configured current request budget.");
  }
  return { origin: parsed.origin, configuredBudget, budgetReference };
}

export function loadProtectedSecret(filePath) {
  if (typeof filePath !== "string" || !filePath) throw new Error("Protected credential file path is required.");
  let descriptor;
  try {
    const linkStat = lstatSync(filePath);
    if (!linkStat.isFile() || linkStat.isSymbolicLink()) throw new Error("Credential input must be a regular protected file.");
    descriptor = openSync(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const fileStat = fstatSync(descriptor);
    const permissions = fileStat.mode & 0o777;
    if (!fileStat.isFile() || (permissions !== 0o400 && permissions !== 0o600)) {
      throw new Error("Credential input must have owner-only permissions (0400 or 0600).");
    }
    if (fileStat.size < 1 || fileStat.size > 16 * 1024) throw new Error("Credential input must be between 1 byte and 16 KiB.");
    const value = readFileSync(descriptor, "utf8").trim();
    if (!value || /[\r\n\0]/.test(value)) throw new Error("Credential input contains an invalid value.");
    return value;
  } catch (error) {
    if (error instanceof Error && /Credential input/.test(error.message)) throw error;
    throw new Error("Could not read protected credential input.");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function validateProviderEvidence(input, nowMs = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Provider CPU observability and current quota evidence are required.");
  if (typeof input.observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.observedAt)) {
    throw new Error("Provider evidence must use an explicit UTC observation timestamp.");
  }
  const observedMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedMs) || observedMs > nowMs + 30_000 || nowMs - observedMs > 15 * 60_000) {
    throw new Error("Provider CPU and quota evidence is missing a current timestamp or is stale.");
  }
  if (typeof input.source !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 .:#/_-]{2,119}$/.test(input.source.trim())) {
    throw new Error("Provider CPU observability source must be identified without secrets.");
  }
  if (!Number.isFinite(input.workerCpuMs) || input.workerCpuMs < 0 || !Number.isFinite(input.durableObjectCpuMs) || input.durableObjectCpuMs < 0) {
    throw new Error("Provider CPU observability requires measured Worker and Durable Object CPU milliseconds.");
  }
  const quota = input.quota;
  if (!quota || typeof quota.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 .:_/-]{1,79}$/.test(quota.name)
      || !Number.isFinite(quota.used) || quota.used < 0 || !Number.isFinite(quota.limit) || quota.limit < 1 || quota.used > quota.limit
      || !Number.isInteger(quota.authorizedRequestBudget) || quota.authorizedRequestBudget < 1 || quota.authorizedRequestBudget > quota.limit - quota.used
      || typeof quota.unit !== "string" || !/^requests?(?:\/(?:day|month|30d))?$/i.test(quota.unit)) {
    throw new Error("Provider evidence must include current account quota usage, limit, unit, and an approved run budget within the observed remaining quota.");
  }
  return {
    observedAt: new Date(observedMs).toISOString(),
    source: input.source.trim(),
    workerCpuMs: input.workerCpuMs,
    durableObjectCpuMs: input.durableObjectCpuMs,
    quota: { name: quota.name, used: quota.used, limit: quota.limit, unit: quota.unit, authorizedRequestBudget: quota.authorizedRequestBudget },
  };
}

export function validateIsolationEvidence(input, origin, nowMs = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Fresh preview isolation evidence is required before any network request.");
  if (typeof input.observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.observedAt)) {
    throw new Error("Preview isolation evidence must use an explicit UTC observation timestamp.");
  }
  const observedMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedMs) || observedMs > nowMs + 30_000 || nowMs - observedMs > 15 * 60_000) {
    throw new Error("Preview binding isolation evidence is missing a current timestamp or is stale.");
  }
  if (input.origin !== origin) throw new Error("Preview isolation evidence origin must exactly match the benchmark target.");
  if (!new Set(["frontpage-do-preview", "frontpage-migration-preview"]).has(input.candidateWorker)) {
    throw new Error("Only the verified Frontpage preview Workers may be benchmark candidates.");
  }
  const identityPattern = /^[A-Za-z0-9][A-Za-z0-9 .:_/-]{2,127}$/;
  if (typeof input.candidateDurableObjectNamespace !== "string" || !identityPattern.test(input.candidateDurableObjectNamespace)
      || typeof input.productionDurableObjectNamespace !== "string" || !identityPattern.test(input.productionDurableObjectNamespace)
      || input.candidateDurableObjectNamespace === input.productionDurableObjectNamespace) {
    throw new Error("Preview evidence must name a candidate Durable Object namespace distinct from production.");
  }
  if (typeof input.candidateCollectorSecretBinding !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.candidateCollectorSecretBinding)) {
    throw new Error("Preview evidence must identify the isolated collector secret binding by name only.");
  }
  if (input.productionWorker !== "frontpage" || input.productionResourcesExcluded !== true
      || input.distinctDurableObjectFromProduction !== true || input.isolatedCollectorSecret !== true
      || input.syntheticOwnerSession !== true) {
    throw new Error("Preview evidence must prove production Worker/DO exclusion and isolated collector and owner credentials.");
  }
  if (typeof input.source !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 .:#/_-]{2,119}$/.test(input.source.trim())) {
    throw new Error("Preview isolation evidence source must be identified without secrets.");
  }
  return {
    observedAt: new Date(observedMs).toISOString(),
    source: input.source.trim(),
    origin,
    candidateWorker: input.candidateWorker,
    productionWorker: input.productionWorker,
    candidateDurableObjectNamespace: input.candidateDurableObjectNamespace,
    productionDurableObjectNamespace: input.productionDurableObjectNamespace,
    candidateCollectorSecretBinding: input.candidateCollectorSecretBinding,
    productionResourcesExcluded: true,
    distinctDurableObjectFromProduction: true,
    isolatedCollectorSecret: true,
    syntheticOwnerSession: true,
  };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

async function readAndDiscard(response) {
  if (!response.body) return;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error("response_too_large");
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("response_too_large");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function readBoundedText(response, limit = 32 * 1024) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new Error("response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("response_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function boundedSnapshot(timestamp) {
  return {
    schema_version: 1,
    collected_at: timestamp,
    host: {
      cpu_percent: 12.5,
      ram_used_bytes: 536_870_912,
      ram_total_bytes: 2_147_483_648,
      disk_used_bytes: 8_589_934_592,
      disk_total_bytes: 21_474_836_480,
      load_1m: 0.1,
      load_5m: 0.2,
      load_15m: 0.3,
      uptime_seconds: 1_234_567,
    },
    services: [],
    containers: [],
  };
}

function validateV1Pair(latest, history) {
  const keys = (value) => Object.keys(value).sort().join(",");
  const expectedSnapshotKeys = "collected_at,containers,host,schema_version,services";
  const expectedHostKeys = "cpu_percent,disk_total_bytes,disk_used_bytes,load_15m,load_1m,load_5m,ram_total_bytes,ram_used_bytes,uptime_seconds";
  const timestamp = latest?.collected_at;
  if (!latest || keys(latest) !== expectedSnapshotKeys || latest.schema_version !== 1
      || typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)
      || !latest.host || keys(latest.host) !== expectedHostKeys
      || !Number.isFinite(latest.host.cpu_percent) || latest.host.cpu_percent < 0 || latest.host.cpu_percent > 100
      || !Number.isInteger(latest.host.ram_used_bytes) || latest.host.ram_used_bytes < 0
      || !Number.isInteger(latest.host.ram_total_bytes) || latest.host.ram_total_bytes < 1
      || !Number.isInteger(latest.host.disk_used_bytes) || latest.host.disk_used_bytes < 0
      || !Number.isInteger(latest.host.disk_total_bytes) || latest.host.disk_total_bytes < 1
      || !["load_1m", "load_5m", "load_15m"].every((key) => Number.isFinite(latest.host[key]) && latest.host[key] >= 0)
      || !Number.isInteger(latest.host.uptime_seconds) || latest.host.uptime_seconds < 0
      || !Array.isArray(latest.services) || latest.services.length !== 0
      || !Array.isArray(latest.containers) || latest.containers.length !== 0
      || !history || keys(history) !== "samples,schema_version" || history.schema_version !== 1
      || !Array.isArray(history.samples) || history.samples.length !== 1
      || JSON.stringify(history.samples[0]) !== JSON.stringify(latest)) {
    throw new Error("Synthetic v1 generation failed local schema and pair validation.");
  }
  return true;
}

export function createSyntheticGeneration(timestamp) {
  if (typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error("Synthetic generation timestamp must be a valid millisecond UTC instant.");
  }
  const latest = boundedSnapshot(timestamp);
  const history = { schema_version: 1, samples: [latest] };
  validateV1Pair(latest, history);
  const latestBytes = Buffer.from(JSON.stringify(latest));
  const historyBytes = Buffer.from(JSON.stringify(history));
  const generationSha256 = createHash("sha256").update(latestBytes).update(Buffer.from([0])).update(historyBytes).digest("hex");
  return {
    timestamp,
    generationSha256,
    latestGzip: gzipSync(latestBytes, { mtime: 0 }),
    historyGzip: gzipSync(historyBytes, { mtime: 0 }),
  };
}

function makeCycle() {
  const tasks = [];
  for (let index = 0; index < 48; index += 1) tasks.push({ kind: "public" });
  for (let index = 0; index < 9; index += 1) tasks.push({ kind: "owner" });
  tasks.splice(29, 0, { kind: "writer", cost: WRITER_COST });
  return tasks;
}

function stageCycles(requestCap) {
  const available = Math.floor((requestCap - 1) / CYCLE_COST);
  const stages = [[], [], []];
  const cycle = makeCycle();
  for (let index = 0; index < available; index += 1) stages[index % 3].push(...cycle.map((task) => ({ ...task })));
  return stages;
}

function timingReport(values) {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99) };
}

export async function measureHeadroom({
  baseUrl,
  expectedSha,
  maxRequests,
  stageSeconds = MAX_STAGE_SECONDS,
  ownerCookieFile,
  collectorTokenFile,
  providerEvidence,
  isolationEvidence,
  coordinationReference,
  approval = process.env,
  fetchImpl = fetch,
  now = Date.now,
}) {
  const target = validateBenchmarkTarget({ baseUrl, expectedSha, maxRequests, approval });
  if (!Number.isInteger(stageSeconds) || stageSeconds < 1 || stageSeconds > MAX_STAGE_SECONDS) {
    throw new Error("Each concurrency stage is limited to 1–60 seconds.");
  }
  if (typeof coordinationReference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 .:#/_-]{2,119}$/.test(coordinationReference.trim())) {
    throw new Error("A non-secret parent coordination reference is required.");
  }
  const evidence = validateProviderEvidence(providerEvidence, now());
  if (maxRequests > evidence.quota.authorizedRequestBudget) throw new Error("Requested load exceeds the provider evidence run budget.");
  const isolation = validateIsolationEvidence(isolationEvidence, target.origin, now());
  const ownerCookie = loadProtectedSecret(ownerCookieFile);
  const collectorToken = loadProtectedSecret(collectorTokenFile);
  const budgetStages = stageCycles(maxRequests);
  const requestDurations = { public: [], owner: [], collector: [] };
  const outcomes = {
    public: { success: 0, errors: 0 },
    owner: { success: 0, errors: 0 },
    collector: { success: 0, errors: 0 },
  };
  const requestCounts = { public: 0, owner: 0, collector: 0 };
  const failureCounts = { public: 0, owner: 0, collector: 0 };
  const failureSamples = [];
  const writes = [];
  const stageReports = [];
  const writeOutcomes = { scheduled: 0, attempted: 0, completed: 0, failed: 0, partialFailures: 0, deadlineFailures: 0, starved: 0, failures: [] };
  let requests = 0;
  let preflightPassed = false;
  let lastTimestamp = 0;
  let writerTail = Promise.resolve();

  async function send(route, { category, stageDeadline, taskDeadline, method = "GET", headers = {}, body, readJson = false } = {}) {
    if (requests >= maxRequests) return { ok: false, failure: "request_cap" };
    const deadline = Math.min(stageDeadline ?? Date.now() + 5_000, taskDeadline ?? Infinity);
    if (Date.now() >= deadline) return { ok: false, failure: "deadline" };
    const before = performance.now();
    requests += 1;
    if (category) requestCounts[category] += 1;
    const remainingMs = Math.max(1, Math.min(5_000, deadline - Date.now()));
    let response;
    try {
      response = await fetchImpl(new URL(route, target.origin), {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(remainingMs),
        headers,
        ...(body ? { body } : {}),
      });
      const responseText = readJson ? await readBoundedText(response) : (await readAndDiscard(response), null);
      const duration = performance.now() - before;
      if (category) requestDurations[category].push(duration);
      const ok = response.status >= 200 && response.status < 300;
      if (category) {
        if (ok) outcomes[category].success += 1;
        else {
          outcomes[category].errors += 1;
          failureCounts[category] += 1;
          if (failureSamples.length < 40) failureSamples.push({ phase: category, route, status: response.status });
        }
      }
      return { ok, status: response.status, duration, responseText, failure: ok ? null : "http_status" };
    } catch (error) {
      const duration = performance.now() - before;
      if (category) requestDurations[category].push(duration);
      if (category) {
        outcomes[category].errors += 1;
        failureCounts[category] += 1;
        if (failureSamples.length < 40) failureSamples.push({ phase: category, route, failure: error?.name === "TimeoutError" || error?.name === "AbortError" ? "deadline" : error?.message === "response_too_large" ? "response_too_large" : "network_error" });
      }
      return { ok: false, duration, failure: error?.name === "TimeoutError" || error?.name === "AbortError" ? "deadline" : error?.message === "response_too_large" ? "response_too_large" : "network_error" };
    }
  }

  const startedAt = new Date(now()).toISOString();
  const preflight = await send("/api/health", { readJson: true });
  let preflightIdentity = null;
  if (preflight.ok && preflight.responseText) {
    try {
      const value = JSON.parse(preflight.responseText);
      preflightIdentity = value?.version ?? null;
      preflightPassed = value?.status === "healthy" && value?.version === expectedSha;
    } catch {
      preflightPassed = false;
    }
  }

  const report = {
    schemaVersion: 2,
    startedAt,
    origin: target.origin,
    expectedSha,
    coordinationReference: coordinationReference.trim(),
    isolationEvidence: isolation,
    mixTargetPercent: { public: 80, authenticatedOwner: 15, collectorUploadIncludingPreflight: 5 },
    requests,
    requestCap: maxRequests,
    preflightRequests: requests,
    preflight: { healthy: preflightPassed, reportedVersion: preflightIdentity },
    stageSeconds,
    concurrencyStages: stageReports,
    requestCounts,
    actualMixPercent: null,
    outcomes,
    failures: { counts: failureCounts, samples: failureSamples },
    latencyMs: {
      public: timingReport(requestDurations.public),
      owner: timingReport(requestDurations.owner),
      collectorRequests: timingReport(requestDurations.collector),
      writeTransactions: timingReport(writes.filter((write) => Number.isFinite(write.durationMs)).map((write) => write.durationMs)),
    },
    writes,
    writeOutcomes,
    providerCpu: { observedAt: evidence.observedAt, source: evidence.source, workerCpuMs: evidence.workerCpuMs, durableObjectCpuMs: evidence.durableObjectCpuMs },
    providerQuota: evidence.quota,
    providerBudgetEvidence: target.budgetReference,
    acceptance: "pending operator review of mixed-workload results, provider evidence, and data integrity",
  };

  if (requests > maxRequests) throw new Error("Internal request budget accounting exceeded its cap.");
  if (!preflightPassed) {
    report.acceptance = "failed: candidate preflight did not prove the exact expected version";
    report.failures.samples.push({ phase: "preflight", route: "/api/health", failure: preflight.failure ?? "identity_mismatch" });
    return report;
  }

  const stageTasks = budgetStages.map((tasks, index) => ({ concurrency: [1, 2, 4][index], tasks }));
  for (const { concurrency, tasks } of stageTasks) {
    const stageStartedAt = Date.now();
    const stageDeadline = stageStartedAt + stageSeconds * 1_000;
    const initialRequestCount = requests;
    let nextTask = 0;
    let stageWriterScheduled = tasks.filter((task) => task.kind === "writer").length;
    let stageWriterStarted = 0;
    const stageFailureStart = { ...failureCounts };

    async function runRead(kind, index) {
      const isOwner = kind === "owner";
      const routes = isOwner ? OWNER_ROUTES : PUBLIC_ROUTES;
      const route = routes[index % routes.length];
      await send(route, {
        category: kind,
        stageDeadline,
        headers: isOwner ? { cookie: ownerCookie } : {},
      });
    }

    async function runWriter(queuedAtWall, queuedAtPerformance) {
      const writeStarted = queuedAtPerformance;
      const operationDeadline = Math.min(stageDeadline, queuedAtWall + 15_000);
      const generationTimestamp = Math.max(now(), lastTimestamp + 1_000);
      lastTimestamp = generationTimestamp;
      const generation = createSyntheticGeneration(new Date(generationTimestamp).toISOString());
      const headers = { authorization: `Bearer ${collectorToken}`, "content-type": "application/gzip" };
      const record = { generationSha256: generation.generationSha256, timestamp: generation.timestamp, queueDelayMs: performance.now() - queuedAtPerformance, durationMs: null, status: "pending", failurePhase: null, failureCode: null };
      let successfulUploads = 0;
      writeOutcomes.attempted += 1;
      for (const [phase, route, body] of [
        ["preflight", "/api/health", null],
        ["latest", "/__collector/latest.json", generation.latestGzip],
        ["history", "/__collector/history.json", generation.historyGzip],
      ]) {
        if (Date.now() >= operationDeadline) {
          record.failurePhase = phase;
          record.status = "deadline";
          record.failureCode = "deadline";
          writeOutcomes.deadlineFailures += 1;
          break;
        }
        const result = phase === "preflight"
          ? await send(route, { category: "collector", stageDeadline, taskDeadline: operationDeadline, readJson: true })
          : await send(route, { category: "collector", stageDeadline, taskDeadline: operationDeadline, method: "PUT", headers, body });
        if (!result.ok || (phase === "preflight" ? result.status !== 200 : result.status !== 204)) {
          record.failurePhase = phase;
          record.status = result.failure === "deadline" ? "deadline" : "failed";
          record.failureCode = result.failure === "http_status" ? `http_${result.status}` : result.failure ?? `unexpected_status_${result.status}`;
          if (record.status === "deadline") writeOutcomes.deadlineFailures += 1;
          break;
        }
        if (phase === "preflight") {
          try {
            const value = JSON.parse(result.responseText ?? "");
            if (value?.status !== "healthy" || value?.version !== expectedSha) {
              record.failurePhase = "preflight";
              record.status = "failed";
              record.failureCode = "identity_mismatch";
              break;
            }
          } catch {
            record.failurePhase = "preflight";
            record.status = "failed";
            record.failureCode = "invalid_health_json";
            break;
          }
        } else {
          successfulUploads += 1;
        }
      }
      record.durationMs = performance.now() - writeStarted;
      if (record.status === "pending") {
        record.status = "completed";
        writeOutcomes.completed += 1;
      } else {
        writeOutcomes.failed += 1;
        if (successfulUploads > 0) writeOutcomes.partialFailures += 1;
        const failure = { phase: record.failurePhase, status: record.status, code: record.failureCode };
        writeOutcomes.failures.push(failure);
        if (failureSamples.length < 40) failureSamples.push({ phase: "collector_write", route: record.failurePhase, failure: record.status });
      }
      writes.push(record);
    }

    async function worker() {
      while (Date.now() < stageDeadline) {
        const taskIndex = nextTask;
        nextTask += 1;
        const task = tasks[taskIndex];
        if (!task) return;
        if (task.kind === "writer") {
          stageWriterStarted += 1;
          const queuedAtWall = Date.now();
          const queuedAtPerformance = performance.now();
          const currentWriter = writerTail.then(() => runWriter(queuedAtWall, queuedAtPerformance));
          writerTail = currentWriter.catch(() => {});
          await currentWriter;
        } else {
          await runRead(task.kind, taskIndex);
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const stageStarved = Math.max(0, stageWriterScheduled - stageWriterStarted);
    writeOutcomes.starved += stageStarved;
    stageReports.push({
      concurrency,
      durationSeconds: (Date.now() - stageStartedAt) / 1_000,
      requests: requests - initialRequestCount,
      scheduledWrites: stageWriterScheduled,
      startedWrites: stageWriterStarted,
      starvedWrites: stageStarved,
      errors: Object.fromEntries(Object.keys(stageFailureStart).map((key) => [key, failureCounts[key] - stageFailureStart[key]])),
    });
  }

  if (requests > maxRequests) throw new Error("Internal request budget accounting exceeded its cap.");
  report.requests = requests;
  report.requestCounts = requestCounts;
  report.outcomes = outcomes;
  report.failures = { counts: failureCounts, samples: failureSamples };
  report.writeOutcomes = writeOutcomes;
  writeOutcomes.scheduled = stageReports.reduce((sum, stage) => sum + stage.scheduledWrites, 0);
  report.writes = writes;
  report.concurrencyStages = stageReports;
  const measured = requestCounts.public + requestCounts.owner + requestCounts.collector;
  report.actualMixPercent = measured === 0 ? null : {
    public: Number((requestCounts.public / measured * 100).toFixed(2)),
    authenticatedOwner: Number((requestCounts.owner / measured * 100).toFixed(2)),
    collectorUploadIncludingPreflight: Number((requestCounts.collector / measured * 100).toFixed(2)),
  };
  report.latencyMs = {
    public: timingReport(requestDurations.public),
    owner: timingReport(requestDurations.owner),
    collectorRequests: timingReport(requestDurations.collector),
    writeTransactions: timingReport(writes.filter((write) => Number.isFinite(write.durationMs)).map((write) => write.durationMs)),
  };
  if (writeOutcomes.failed || writeOutcomes.deadlineFailures || writeOutcomes.starved || failureCounts.public || failureCounts.owner || failureCounts.collector) {
    report.acceptance = "failed: workload errors, partial writes, or write starvation require investigation";
  }
  return report;
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : undefined;
}

function readEvidenceFile(filePath) {
  try {
    const info = lstatSync(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > 64 * 1024) throw new Error("invalid");
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("Evidence input must be a small regular JSON file.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const baseUrl = argument(args, "--base-url");
  const expectedSha = argument(args, "--expected-sha");
  const maxRequests = Number(argument(args, "--max-requests"));
  const stageSeconds = Number(argument(args, "--stage-seconds") ?? MAX_STAGE_SECONDS);
  const ownerCookieFile = argument(args, "--owner-cookie-file");
  const collectorTokenFile = argument(args, "--collector-token-file");
  const providerEvidenceFile = argument(args, "--provider-evidence-file");
  const isolationEvidenceFile = argument(args, "--isolation-evidence-file");
  const coordinationReference = argument(args, "--coordination-reference");
  if (args.length < 16 || !baseUrl || !expectedSha || !Number.isInteger(maxRequests) || !ownerCookieFile || !collectorTokenFile || !providerEvidenceFile || !isolationEvidenceFile || !coordinationReference) {
    console.error("Usage: node scripts/measure-cloudflare-headroom.mjs --base-url <isolated-origin> --expected-sha <full-sha> --max-requests <181-2000> --owner-cookie-file <0400-or-0600-file> --collector-token-file <0400-or-0600-file> --provider-evidence-file <current-observability.json> --isolation-evidence-file <verified-preview-bindings.json> --coordination-reference <parent-reference> [--stage-seconds <1-60>]");
    process.exitCode = 2;
  } else {
    try {
      const providerEvidence = readEvidenceFile(providerEvidenceFile);
      const isolationEvidence = readEvidenceFile(isolationEvidenceFile);
      const report = await measureHeadroom({ baseUrl, expectedSha, maxRequests, stageSeconds, ownerCookieFile, collectorTokenFile, providerEvidence, isolationEvidence, coordinationReference });
      console.log(JSON.stringify(report, null, 2));
      if (!report.preflight.healthy || report.acceptance.startsWith("failed:")) process.exitCode = 1;
    } catch (error) {
      console.error(`Benchmark refused or failed: ${error instanceof Error ? error.message : "unknown error"}`);
      process.exitCode = 1;
    }
  }
}
