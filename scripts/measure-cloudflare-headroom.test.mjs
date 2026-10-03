import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createSyntheticGeneration } from "./measure-cloudflare-headroom.mjs";
import { validateBenchmarkTarget, loadProtectedSecret, validateProviderEvidence, validateIsolationEvidence } from "./measure-cloudflare-headroom.mjs";

const sha = "a".repeat(40);
const approval = {
  FRONTPAGE_BENCHMARK_ISOLATED_APPROVED: "1",
  FRONTPAGE_BENCHMARK_ALLOWED_ORIGIN: "https://candidate.example.test",
  FRONTPAGE_BENCHMARK_BUDGET_REFERENCE: "quota screenshot captured 2026-10-03T15:00:00Z",
  FRONTPAGE_BENCHMARK_MAX_REQUESTS: "1800",
  FRONTPAGE_BENCHMARK_COORDINATED: "1",
};
const providerEvidence = {
  observedAt: new Date().toISOString(),
  source: "Cloudflare dashboard Workers Analytics",
  workerCpuMs: 12.5,
  durableObjectCpuMs: 8.25,
  quota: { name: "Workers requests", used: 1234, limit: 100000, unit: "requests/month", authorizedRequestBudget: 300 },
};
const isolationEvidence = {
  observedAt: new Date().toISOString(),
  source: "Wrangler preview bindings inventory",
  origin: "https://candidate.example.test",
  candidateWorker: "frontpage-do-preview",
  candidateDurableObjectNamespace: "frontpage-do-preview-primary",
  productionDurableObjectNamespace: "frontpage-production-primary",
  candidateCollectorSecretBinding: "COLLECTOR_UPLOAD_SECRET",
  productionWorker: "frontpage",
  productionResourcesExcluded: true,
  distinctDurableObjectFromProduction: true,
  isolatedCollectorSecret: true,
  syntheticOwnerSession: true,
};

function protectedFiles(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "frontpage-headroom-test-"));
  const ownerCookiePath = path.join(directory, "owner-cookie");
  const collectorTokenPath = path.join(directory, "collector-token");
  writeFileSync(ownerCookiePath, "session=OWNER_SECRET_SENTINEL\n", { mode: 0o600 });
  writeFileSync(collectorTokenPath, "COLLECTOR_SECRET_SENTINEL\n", { mode: 0o600 });
  chmodSync(ownerCookiePath, 0o600);
  chmodSync(collectorTokenPath, 0o600);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { ownerCookiePath, collectorTokenPath };
}

const commonTarget = (paths) => ({
  baseUrl: "https://candidate.example.test",
  expectedSha: sha,
  maxRequests: 181,
  stageSeconds: 60,
  ownerCookieFile: paths.ownerCookiePath,
  collectorTokenFile: paths.collectorTokenPath,
  providerEvidence,
  isolationEvidence,
  coordinationReference: "parent-checkpoint-2026-10-03",
  approval,
});

test("benchmark requires verified isolation, current budget, and explicit coordination", () => {
  assert.equal(validateBenchmarkTarget({
    baseUrl: "https://candidate.example.test", expectedSha: sha, maxRequests: 181, approval,
  }).origin, "https://candidate.example.test");
  assert.throws(() => validateBenchmarkTarget({ baseUrl: "https://candidate.example.test", expectedSha: sha, maxRequests: 10, approval: {} }), /isolated approval/);
  assert.throws(() => validateBenchmarkTarget({
    baseUrl: "https://candidate.example.test", expectedSha: sha, maxRequests: 10,
    approval: { ...approval, FRONTPAGE_BENCHMARK_COORDINATED: "0" },
  }), /coordinated/);
});

test("benchmark refuses production origins even when they are allowlisted", () => {
  for (const baseUrl of ["https://reidar.tech", "https://preview.reidar.tech", "https://frontpage.reidjoss.workers.dev"]) {
    assert.throws(() => validateBenchmarkTarget({
      baseUrl, expectedSha: sha, maxRequests: 100,
      approval: { ...approval, FRONTPAGE_BENCHMARK_ALLOWED_ORIGIN: baseUrl },
    }), /production origin/);
  }
});

test("request ceiling includes preflight and each complete collector triple", () => {
  assert.throws(() => validateBenchmarkTarget({ baseUrl: "https://candidate.example.test", expectedSha: sha, maxRequests: 1900, approval }), /current request budget/);
  assert.throws(() => validateBenchmarkTarget({ baseUrl: "https://candidate.example.test", expectedSha: sha, maxRequests: 2001, approval: { ...approval, FRONTPAGE_BENCHMARK_MAX_REQUESTS: "3000" } }), /2000-request ceiling/);
});

test("protected secret inputs reject permissive files and are read without exposing values", (t) => {
  const paths = protectedFiles(t);
  assert.equal(loadProtectedSecret(paths.ownerCookiePath), "session=OWNER_SECRET_SENTINEL");
  chmodSync(paths.ownerCookiePath, 0o644);
  assert.throws(() => loadProtectedSecret(paths.ownerCookiePath), /owner-only permissions/);
});

test("provider CPU and current quota must come from recent explicit observability evidence", () => {
  assert.deepEqual(validateProviderEvidence(providerEvidence), providerEvidence);
  assert.throws(() => validateProviderEvidence({ ...providerEvidence, durableObjectCpuMs: undefined }), /CPU observability/);
  assert.throws(() => validateProviderEvidence({ ...providerEvidence, quota: undefined }), /current account quota/);
  assert.throws(() => validateProviderEvidence({ ...providerEvidence, observedAt: "2020-01-01T00:00:00Z" }), /stale/);
  assert.throws(() => validateProviderEvidence({ ...providerEvidence, quota: { ...providerEvidence.quota, authorizedRequestBudget: 99000 } }), /remaining quota/);
});

test("live traffic requires fresh origin-matched preview binding and credential isolation evidence", () => {
  assert.equal(validateIsolationEvidence(isolationEvidence, "https://candidate.example.test").candidateWorker, "frontpage-do-preview");
  assert.throws(() => validateIsolationEvidence(undefined, "https://candidate.example.test"), /Fresh preview isolation evidence/);
  assert.throws(() => validateIsolationEvidence({ ...isolationEvidence, origin: "https://other.example.test" }, "https://candidate.example.test"), /exactly match/);
  assert.throws(() => validateIsolationEvidence({ ...isolationEvidence, candidateWorker: "frontpage" }, "https://candidate.example.test"), /Only the verified Frontpage preview/);
  assert.throws(() => validateIsolationEvidence({ ...isolationEvidence, productionDurableObjectNamespace: isolationEvidence.candidateDurableObjectNamespace }, "https://candidate.example.test"), /distinct from production/);
  assert.throws(() => validateIsolationEvidence({ ...isolationEvidence, distinctDurableObjectFromProduction: false }, "https://candidate.example.test"), /production Worker\/DO exclusion/);
});

test("measurement refuses missing isolation or insufficient quota before fetch", async (t) => {
  const { measureHeadroom } = await import("./measure-cloudflare-headroom.mjs");
  const paths = protectedFiles(t);
  let networkCalls = 0;
  const fetchImpl = async () => { networkCalls += 1; throw new Error("network should remain unused"); };
  await assert.rejects(measureHeadroom({
    ...commonTarget(paths), isolationEvidence: undefined, fetchImpl,
  }), /Fresh preview isolation evidence/);
  await assert.rejects(measureHeadroom({
    ...commonTarget(paths),
    providerEvidence: { ...providerEvidence, quota: { ...providerEvidence.quota, authorizedRequestBudget: 180 } },
    fetchImpl,
  }), /provider evidence run budget/);
  assert.equal(networkCalls, 0);
});

test("mixed workload uploads coherent v1 generations amid public and owner traffic", async (t) => {
  const { measureHeadroom } = await import("./measure-cloudflare-headroom.mjs");
  const paths = protectedFiles(t);
  const requests = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    requests.push({ path: parsed.pathname, options });
    if (parsed.pathname === "/api/health") {
      if (options.method === "PUT") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ status: "healthy", version: sha }), { status: 200 });
    }
    if (parsed.pathname.startsWith("/__collector/")) {
      assert.equal(options.headers.authorization, "Bearer COLLECTOR_SECRET_SENTINEL");
      return new Response(null, { status: 204 });
    }
    if (parsed.pathname.startsWith("/api/owner/")) {
      assert.equal(options.headers.cookie, "session=OWNER_SECRET_SENTINEL");
    }
    return new Response("ok", { status: 200 });
  };
  const report = await measureHeadroom({ ...commonTarget(paths), fetchImpl });
  const payload = JSON.stringify(report);
  assert.equal(report.requests, 181);
  assert.equal(report.preflightRequests, 1);
  assert.equal(report.requestCounts.public, 144);
  assert.equal(report.requestCounts.owner, 27);
  assert.equal(report.requestCounts.collector, 9);
  assert.equal(report.writeOutcomes.completed, 3);
  assert.ok(report.writes[0].timestamp < report.writes[1].timestamp && report.writes[1].timestamp < report.writes[2].timestamp);
  assert.equal(report.writeOutcomes.partialFailures, 0);
  assert.equal(report.providerCpu.workerCpuMs, 12.5);
  assert.equal(report.providerCpu.durableObjectCpuMs, 8.25);
  assert.equal(report.providerQuota.used, 1234);
  assert.equal(report.providerQuota.authorizedRequestBudget, 300);
  assert.deepEqual(report.concurrencyStages.map((stage) => stage.concurrency), [1, 2, 4]);
  const latestIndex = requests.findIndex((request) => request.path === "/__collector/latest.json");
  const historyIndex = requests.findIndex((request) => request.path === "/__collector/history.json");
  assert.ok(latestIndex > 1);
  assert.ok(historyIndex > latestIndex);
  assert.ok(requests.slice(historyIndex + 1).some((request) => request.path === "/" || request.path === "/projects" || request.path === "/status" || request.path.startsWith("/api/owner/")));
  assert.match(report.writes[0].generationSha256, /^[a-f0-9]{64}$/);
  const latestBody = JSON.parse(gunzipSync(requests[latestIndex].options.body).toString("utf8"));
  const historyBody = JSON.parse(gunzipSync(requests[historyIndex].options.body).toString("utf8"));
  assert.equal(latestBody.collected_at, historyBody.samples[0].collected_at);
  assert.equal(latestBody.collected_at, report.writes[0].timestamp);
  assert.doesNotMatch(payload, /OWNER_SECRET_SENTINEL|COLLECTOR_SECRET_SENTINEL|authorization|cookie/i);
});

test("partial uploads and write starvation are explicit and never serialize secrets", async (t) => {
  const { measureHeadroom } = await import("./measure-cloudflare-headroom.mjs");
  const paths = protectedFiles(t);
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/health" && options.method !== "PUT") return new Response(JSON.stringify({ status: "healthy", version: sha }), { status: 200 });
    if (parsed.pathname === "/__collector/history.json") return new Response("", { status: 503 });
    return new Response(parsed.pathname === "/__collector/latest.json" ? null : "ok", { status: parsed.pathname === "/__collector/latest.json" ? 204 : 200 });
  };
  const failed = await measureHeadroom({ ...commonTarget(paths), fetchImpl });
  assert.equal(failed.writeOutcomes.partialFailures, 3);
  assert.equal(failed.writeOutcomes.failed, 3);
  assert.equal(failed.writeOutcomes.completed, 0);
  assert.equal(failed.writeOutcomes.failures[0].phase, "history");
  assert.equal(failed.writes[0].failureCode, "http_503");
  assert.match(failed.acceptance, /^failed:/);
  assert.doesNotMatch(JSON.stringify(failed), /OWNER_SECRET_SENTINEL|COLLECTOR_SECRET_SENTINEL/);

  let delayed = 0;
  const starved = await measureHeadroom({
    ...commonTarget(paths), maxRequests: 181, stageSeconds: 1,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/health" && options.method !== "PUT") return new Response(JSON.stringify({ status: "healthy", version: sha }), { status: 200 });
      if (!parsed.pathname.startsWith("/__collector/")) {
        delayed += 1;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1_100);
          options.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        throw new DOMException("aborted", "AbortError");
      }
      return new Response(null, { status: 204 });
    },
  });
  assert.ok(delayed > 0);
  assert.ok(starved.writeOutcomes.starved > 0 || starved.writeOutcomes.deadlineFailures > 0);
});

test("each three-request collector generation shares one bounded deadline", async (t) => {
  const { measureHeadroom } = await import("./measure-cloudflare-headroom.mjs");
  const paths = protectedFiles(t);
  const calls = [];
  const report = await measureHeadroom({
    ...commonTarget(paths), stageSeconds: 1,
    fetchImpl: async (url, options) => {
      const route = new URL(url).pathname;
      calls.push(route);
      if (route === "/api/health") return new Response(JSON.stringify({ status: "healthy", version: sha }), { status: 200 });
      if (route === "/__collector/latest.json") {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1_100);
          options.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        throw new DOMException("aborted", "AbortError");
      }
      if (route === "/__collector/history.json") return new Response(null, { status: 204 });
      return new Response("ok", { status: 200 });
    },
  });
  assert.equal(report.writeOutcomes.deadlineFailures, 3);
  assert.deepEqual(report.writes.map((write) => write.failurePhase), ["latest", "latest", "latest"]);
  assert.equal(calls.filter((route) => route === "/__collector/history.json").length, 0);
  assert.ok(report.concurrencyStages.every((stage) => stage.durationSeconds <= 1.2));
});

test("multiple synthetic writers are serialized so v1 latest/history uploads cannot interleave", async (t) => {
  const { measureHeadroom } = await import("./measure-cloudflare-headroom.mjs");
  const paths = protectedFiles(t);
  const uploadSequence = [];
  let latestPending = false;
  let interleaved = false;
  const report = await measureHeadroom({
    ...commonTarget(paths), maxRequests: 361,
    approval: { ...approval, FRONTPAGE_BENCHMARK_MAX_REQUESTS: "400" },
    providerEvidence: { ...providerEvidence, quota: { ...providerEvidence.quota, authorizedRequestBudget: 400 } },
    fetchImpl: async (url, options) => {
      const route = new URL(url).pathname;
      if (route === "/api/health" && options.method !== "PUT") return new Response(JSON.stringify({ status: "healthy", version: sha }), { status: 200 });
      if (route === "/__collector/latest.json") {
        uploadSequence.push("latest");
        if (latestPending) interleaved = true;
        latestPending = true;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return new Response(null, { status: 204 });
      }
      if (route === "/__collector/history.json") {
        uploadSequence.push("history");
        if (!latestPending) interleaved = true;
        latestPending = false;
        return new Response(null, { status: 204 });
      }
      return new Response("ok", { status: 200 });
    },
  });
  assert.equal(report.writeOutcomes.completed, 6);
  assert.equal(interleaved, false);
  assert.deepEqual(uploadSequence, Array.from({ length: 6 }, () => ["latest", "history"]).flat());
  assert.deepEqual(report.concurrencyStages.map((stage) => stage.concurrency), [1, 2, 4]);
});

test("synthetic generation hashes exact latest NUL history bytes and keeps timestamps paired", () => {
  const timestamp = new Date().toISOString();
  const normalized = timestamp.replace(/Z$/, "Z");
  const generation = createSyntheticGeneration(normalized);
  const latest = JSON.parse(gunzipSync(generation.latestGzip).toString("utf8"));
  const history = JSON.parse(gunzipSync(generation.historyGzip).toString("utf8"));
  assert.equal(latest.collected_at, history.samples[0].collected_at);
  assert.equal(generation.timestamp, timestamp);
  const latestBytes = gunzipSync(generation.latestGzip);
  const historyBytes = gunzipSync(generation.historyGzip);
  assert.equal(generation.generationSha256, createHash("sha256").update(latestBytes).update(Buffer.from([0])).update(historyBytes).digest("hex"));
});
