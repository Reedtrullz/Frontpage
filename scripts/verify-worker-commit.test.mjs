import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { parseDocument } from "yaml";

const moduleUrl = new URL("./verify-worker-commit.mjs", import.meta.url);
const sha = "a".repeat(40), stale = "b".repeat(40);
async function verifier() {
  assert.ok(fs.existsSync(moduleUrl), "safe Worker probe is missing");
  return (await import(moduleUrl)).verifyWorkerCommit;
}
function fixture(fetchImpl) {
  const records = [], delays = [];
  return { records, delays, options: { expectedSha: sha, fetchImpl, log: record => records.push(record), sleep: async ms => { delays.push(ms); } } };
}
const health = (version = sha, status = "healthy", http = 200) => new Response(JSON.stringify({ status, version }), { status: http });

test("the production Worker probe precedes independent intended-domain acceptance", () => {
  const workflow = parseDocument(fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")).toJS();
  const steps = workflow.jobs["deploy-cloudflare"].steps;
  const index = steps.findIndex(step => step.name === "Verify Worker commit");
  assert.equal(steps[index].run, 'node scripts/verify-worker-commit.mjs --expected-sha "$GITHUB_SHA"');
  assert.equal(steps[index + 1].run, 'node scripts/verify-release.mjs --base-url https://reidar.tech --expected-sha "$GITHUB_SHA"');
});

test("only healthy exact identity accepts, with safe HTTP, timing and identity evidence", async () => {
  const verify = await verifier();
  const f = fixture(async (url, options) => {
    assert.equal(url, "https://frontpage.reidjoss.workers.dev/api/health");
    assert.equal(options.redirect, "manual");
    assert.equal(options.signal.aborted, false);
    return health();
  });
  assert.equal((await verify(f.options)).attempts, 1);
  assert.equal(f.delays.length, 0);
  assert.equal(f.records[0].phase, "accepted");
  assert.equal(f.records[0].http_status, 200);
  assert.equal(f.records[0].observed_status, "healthy");
  assert.equal(f.records[0].observed_sha, sha);
  assert.ok(f.records[0].elapsed_ms >= 0);
});

test("stale identity and unavailable HTTP can recover only to the exact intended revision", async () => {
  const verify = await verifier();
  const responses = [health(stale), health(sha, "healthy", 503), health()];
  const f = fixture(async () => responses.shift());
  assert.equal((await verify(f.options)).attempts, 3);
  assert.deepEqual(f.delays, [2000, 2000]);
  assert.deepEqual(f.records.map(r => r.phase), ["identity-mismatch", "http-status", "accepted"]);
  assert.equal(f.records[0].observed_sha, stale);
});

test("stale, unhealthy, invalid, oversized, redirected and unavailable responses exhaust the current finite policy", async t => {
  const verify = await verifier();
  for (const [name, fetchImpl, phase] of [
    ["stale", async () => health(stale), "identity-mismatch"],
    ["unhealthy", async () => health(sha, "unhealthy"), "identity-mismatch"],
    ["malformed", async () => new Response("not JSON"), "invalid-json"],
    ["oversized", async () => new Response("{}", { headers: { "content-length": String(512 * 1024 + 1) } }), "response-too-large"],
    ["redirected", async () => new Response(null, { status: 302, headers: { location: "https://private.example" } }), "http-status"],
    ["unavailable", async () => { throw new Error("private credential or transport details"); }, "transport"],
  ]) await t.test(name, async () => {
    const f = fixture(fetchImpl);
    await assert.rejects(verify(f.options), /84 bounded attempts/);
    assert.equal(f.records.length, 84);
    assert.equal(f.records.at(-1).attempt, 84);
    assert.ok(f.records.every(r => r.phase === phase));
    assert.deepEqual(f.delays, [...Array(30).fill(2000), ...Array(54).fill(10000)]);
    assert.equal(f.delays.reduce((a, b) => a + b, 0), 600_000);
    assert.doesNotMatch(JSON.stringify(f.records), /private\.example|credential|transport details|not JSON/);
  });
});

test("arbitrary status, identity, private fields and headers are redacted from bounded records", async () => {
  const verify = await verifier();
  const f = fixture(async () => new Response(JSON.stringify({ status: "private-status", version: "private-token".repeat(1000), cpu_percent: 75, secret: "private-body" }), { headers: { "set-cookie": "private-cookie" } }));
  await assert.rejects(verify(f.options), /84 bounded attempts/);
  assert.equal(f.records[0].observed_status, "invalid");
  assert.equal(f.records[0].observed_sha, "invalid");
  assert.ok(f.records.every(r => JSON.stringify(r).length < 400));
  assert.doesNotMatch(JSON.stringify(f.records), /private-|cpu_percent|cookie|secret/);
});

test("undeclared streamed overflow cancels the body and cannot pass identity", async () => {
  const verify = await verifier();
  let cancelled = 0;
  const f = fixture(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 1)); },
    cancel() { cancelled++; },
  })));
  await assert.rejects(verify(f.options), /84 bounded attempts/);
  assert.equal(cancelled, 84);
  assert.ok(f.records.every(r => r.phase === "response-too-large"));
});

test("body stream failures retain their phase without exposing the underlying error", async () => {
  const verify = await verifier();
  const f = fixture(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("private-body-error")); } })));
  await assert.rejects(verify(f.options), /84 bounded attempts/);
  assert.ok(f.records.every(r => r.phase === "body-read-failed"));
  assert.doesNotMatch(JSON.stringify(f.records), /private-body-error/);
});

for (const phase of ["headers", "body"]) test(`five-second whole-request cancellation includes stalled ${phase}`, { timeout: 20_000 }, async t => {
  const verify = await verifier();
  const server = createServer((_request, response) => {
    if (phase === "body") { response.writeHead(200); response.write('{"status":'); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  let first = true, ownedSignal;
  const f = fixture(async (_url, options) => {
    if (!first) throw new Error("unavailable");
    first = false; ownedSignal = options.signal;
    return fetch(`http://127.0.0.1:${server.address().port}/api/health`, options);
  });
  const started = performance.now();
  await assert.rejects(verify(f.options), /84 bounded attempts/);
  assert.equal(ownedSignal.aborted, true);
  assert.equal(f.records[0].phase, "request-timeout");
  assert.ok(performance.now() - started >= 4500);
  assert.ok(performance.now() - started < 15000);
});

test("invalid expected identity fails before any request or log", async () => {
  const verify = await verifier();
  const f = fixture(async () => { assert.fail("invalid identity must not dispatch"); });
  await assert.rejects(verify({ ...f.options, expectedSha: "private-token" }), /full commit SHA/);
  assert.deepEqual(f.records, []);
});
