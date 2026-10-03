#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[a-f0-9]{40}$/;
const MAX_REQUESTS = 2_000;
const MAX_STAGE_SECONDS = 60;
const OWNER_ROUTES = ["/api/owner/metrics?range=1h&view=host", "/api/owner/incidents"];
const PUBLIC_ROUTES = ["/", "/projects", "/status", "/api/health"];

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
  if (approval.FRONTPAGE_BENCHMARK_ALLOWED_ORIGIN !== parsed.origin) throw new Error("Target must exactly match FRONTPAGE_BENCHMARK_ALLOWED_ORIGIN.");
  if (!/^[A-Za-z0-9][A-Za-z0-9 .:#/_-]{0,119}$/.test(approval.FRONTPAGE_BENCHMARK_BUDGET_REFERENCE?.trim() ?? "")) throw new Error("A short, non-secret provider budget evidence reference is required.");
  const configuredBudget = Number(approval.FRONTPAGE_BENCHMARK_MAX_REQUESTS);
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > MAX_REQUESTS) {
    throw new Error("Benchmark has a hard 2000-request ceiling.");
  }
  if (!Number.isInteger(configuredBudget) || configuredBudget < 1 || configuredBudget > MAX_REQUESTS || maxRequests > configuredBudget) {
    throw new Error("Requested load exceeds the configured request budget.");
  }
  if (!approval.FRONTPAGE_BENCHMARK_OWNER_COOKIE?.trim()) throw new Error("A synthetic candidate owner session is required for owner-read measurements.");
  return { origin: parsed.origin, configuredBudget, budgetReference: approval.FRONTPAGE_BENCHMARK_BUDGET_REFERENCE.trim() };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

async function readAndDiscard(response, limit = 2 * 1024 * 1024) {
  if (!response.body) return;
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("response exceeded 2 MiB");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function measureHeadroom({
  baseUrl,
  expectedSha,
  maxRequests,
  stageSeconds = MAX_STAGE_SECONDS,
  approval = process.env,
  fetchImpl = fetch,
}) {
  const target = validateBenchmarkTarget({ baseUrl, expectedSha, maxRequests, approval });
  if (!Number.isInteger(stageSeconds) || stageSeconds < 1 || stageSeconds > MAX_STAGE_SECONDS) {
    throw new Error("Each concurrency stage is limited to 1–60 seconds.");
  }
  const initial = await fetchImpl(new URL("/api/health", target.origin), { signal: AbortSignal.timeout(5_000), redirect: "manual" });
  const health = await initial.json().catch(() => null);
  if (initial.status !== 200 || health?.status !== "healthy" || health?.version !== expectedSha) {
    throw new Error("Candidate /api/health did not report the exact expected SHA.");
  }

  const startedAt = new Date().toISOString();
  const durations = [];
  const outcomes = { public: { success: 0, errors: 0 }, owner: { success: 0, errors: 0 } };
  let requestCount = 0;
  const stageReports = [];
  for (const concurrency of [1, 2, 4]) {
    const stageStart = Date.now();
    const deadline = stageStart + stageSeconds * 1_000;
    const stageFirst = requestCount;
    let nextIndex = 0;
    async function worker() {
      while (Date.now() < deadline && requestCount < maxRequests) {
        const sequence = nextIndex++;
        if (requestCount >= maxRequests) return;
        requestCount += 1;
        const isOwner = sequence % 5 === 4;
        const route = isOwner ? OWNER_ROUTES[sequence % OWNER_ROUTES.length] : PUBLIC_ROUTES[sequence % PUBLIC_ROUTES.length];
        const category = isOwner ? "owner" : "public";
        const before = performance.now();
        try {
          const response = await fetchImpl(new URL(route, target.origin), {
            method: "GET",
            redirect: "manual",
            signal: AbortSignal.timeout(5_000),
            headers: isOwner ? { cookie: approval.FRONTPAGE_BENCHMARK_OWNER_COOKIE } : {},
          });
          await readAndDiscard(response);
          durations.push(performance.now() - before);
          if (response.status >= 200 && response.status < 300) outcomes[category].success += 1;
          else outcomes[category].errors += 1;
        } catch {
          durations.push(performance.now() - before);
          outcomes[category].errors += 1;
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    stageReports.push({ concurrency, durationSeconds: (Date.now() - stageStart) / 1_000, requests: requestCount - stageFirst });
    if (requestCount >= maxRequests) break;
  }

  return {
    schemaVersion: 1,
    startedAt,
    origin: target.origin,
    expectedSha,
    mix: { publicReadsPercent: 80, authenticatedOwnerReadsPercent: 20, writesPercent: 0 },
    maxRequests,
    requests: requestCount,
    concurrencyStages: stageReports,
    outcomes,
    latencyMs: { p50: percentile(durations, 0.50), p95: percentile(durations, 0.95), p99: percentile(durations, 0.99) },
    providerCpu: null,
    providerBudgetEvidence: target.budgetReference,
    providerCpuAndQuotaAssessment: "pending operator evidence",
    acceptance: "incomplete: read-only harness does not measure collector/write starvation or provider CPU/quota",
  };
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const baseUrl = argument(args, "--base-url");
  const expectedSha = argument(args, "--expected-sha");
  const maxRequests = Number(argument(args, "--max-requests"));
  const stageSeconds = Number(argument(args, "--stage-seconds") ?? MAX_STAGE_SECONDS);
  if (args.length < 6 || !baseUrl || !expectedSha || !Number.isInteger(maxRequests)) {
    console.error("Usage: node scripts/measure-cloudflare-headroom.mjs --base-url <isolated-origin> --expected-sha <full-sha> --max-requests <1-2000> [--stage-seconds <1-60>]");
    process.exitCode = 2;
  } else {
    try {
      const report = await measureHeadroom({ baseUrl, expectedSha, maxRequests, stageSeconds });
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      console.error(`Benchmark refused or failed: ${error instanceof Error ? error.message : "unknown error"}`);
      process.exitCode = 1;
    }
  }
}
