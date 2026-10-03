import test from "node:test";
import assert from "node:assert/strict";
import { validateBenchmarkTarget } from "./measure-cloudflare-headroom.mjs";

const sha = "a".repeat(40);
const approval = {
  FRONTPAGE_BENCHMARK_ISOLATED_APPROVED: "1",
  FRONTPAGE_BENCHMARK_ALLOWED_ORIGIN: "https://candidate.example.test",
  FRONTPAGE_BENCHMARK_BUDGET_REFERENCE: "Cloudflare dashboard remaining quota checked 2026-10-03",
  FRONTPAGE_BENCHMARK_MAX_REQUESTS: "1800",
  FRONTPAGE_BENCHMARK_OWNER_COOKIE: "synthetic-session",
};

test("benchmark requires an explicitly approved isolated origin and request budget", () => {
  assert.deepEqual(validateBenchmarkTarget({
    baseUrl: "https://candidate.example.test",
    expectedSha: sha,
    maxRequests: 1600,
    approval,
  }).origin, "https://candidate.example.test");
  assert.throws(() => validateBenchmarkTarget({ baseUrl: "https://candidate.example.test", expectedSha: sha, maxRequests: 10, approval: {} }), /isolated approval/);
});

test("benchmark refuses production origins even when they are allowlisted", () => {
  assert.throws(() => validateBenchmarkTarget({
    baseUrl: "https://reidar.tech",
    expectedSha: sha,
    maxRequests: 100,
    approval: { ...approval, FRONTPAGE_BENCHMARK_ALLOWED_ORIGIN: "https://reidar.tech" },
  }), /production origin/);
  assert.throws(() => validateBenchmarkTarget({
    baseUrl: "https://frontpage.reidjoss.workers.dev",
    expectedSha: sha,
    maxRequests: 100,
    approval: { ...approval, FRONTPAGE_BENCHMARK_ALLOWED_ORIGIN: "https://frontpage.reidjoss.workers.dev" },
  }), /production origin/);
});

test("benchmark enforces the lower configured request budget and plan ceiling", () => {
  assert.throws(() => validateBenchmarkTarget({ baseUrl: "https://candidate.example.test", expectedSha: sha, maxRequests: 1900, approval }), /configured request budget/);
  assert.throws(() => validateBenchmarkTarget({ baseUrl: "https://candidate.example.test", expectedSha: sha, maxRequests: 2001, approval: { ...approval, FRONTPAGE_BENCHMARK_MAX_REQUESTS: "3000" } }), /2000-request ceiling/);
});

test("read-only measurement honors its request ceiling and labels provider evidence as pending", async () => {
  const { measureHeadroom } = await import("./measure-cloudflare-headroom.mjs");
  const paths = [];
  const fetchImpl = async (url, options) => {
    const route = `${new URL(url).pathname}${new URL(url).search}`;
    paths.push(route);
    if (route === "/api/health") return new Response(JSON.stringify({ status: "healthy", version: sha }), { status: 200 });
    if (options.headers.cookie) assert.equal(options.headers.cookie, "synthetic-session");
    return new Response("ok", { status: 200 });
  };
  const report = await measureHeadroom({
    baseUrl: "https://candidate.example.test",
    expectedSha: sha,
    maxRequests: 12,
    stageSeconds: 1,
    approval,
    fetchImpl,
  });
  assert.equal(report.requests, 12);
  assert.equal(report.outcomes.public.success + report.outcomes.owner.success, 12);
  assert.equal(report.providerCpu, null);
  assert.match(report.acceptance, /does not measure collector\/write starvation/);
  assert.equal(paths.filter((route) => route === "/api/health").length, 4);
});
