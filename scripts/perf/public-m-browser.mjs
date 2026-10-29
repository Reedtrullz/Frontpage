import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

export const sha = value => createHash('sha256').update(value).digest('hex');
export const PRIVATE = /cpu_percent|ram_used_bytes|disk_used_bytes|uptime_seconds|frontpage-internal|frontpage-container|Collector diagnostics|Owner status|frontpage-app|system\/untracked|trigger_value/;
export const CLOCK = 1793203200000;
const base = 'http://127.0.0.1:3100';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function encoded(route) {
  return new Promise((resolve, reject) => {
    const request = http.get(base + route, { headers: { 'Accept-Encoding': 'gzip' }, timeout: 10000 }, response => {
      let bytes = 0; const chunks = [];
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 1048576) request.destroy(new Error('response bound')); else chunks.push(chunk); });
      response.on('end', () => resolve({ status: response.statusCode, encoding: response.headers['content-encoding'] ?? 'identity', bytes, sha256: sha(Buffer.concat(chunks)) }));
    });
    request.on('error', reject); request.on('timeout', () => request.destroy(new Error('response deadline')));
  });
}

export async function run(config, request) {
  assert.ok(['happy', 'failure'].includes(request.scenario));
  const work = process.env.TMPDIR, source = config.sources[request.phase].cwd;
  for (const name of ['legacy', 'public', 'owner']) {
    const target = path.join(work, name);
    if (request.scenario === 'failure' && name !== 'owner') fs.mkdirSync(target);
    else fs.cpSync(config.fixtures[request.phase][name], target, { recursive: true });
  }
  const log = fs.openSync(path.join(work, 'server.log'), 'w');
  const server = spawn(process.execPath, ['--require', config.clock, path.join(source, '.next/standalone/server.js')], {
    cwd: source, stdio: ['ignore', log, log], env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: '3100',
      AUTH_SECRET: 'frontpage-public-m-fixture-only', AUTH_URL: base, FRONTPAGE_E2E_OWNER: '0',
      METRICS_DIR: path.join(work, 'legacy'), PUBLIC_METRICS_DIR: path.join(work, 'public'),
      OWNER_METRICS_DIR: path.join(work, 'owner'), DATA_DIR: path.join(work, 'data'), FRONTPAGE_OBSERVABILITY_V2: '1', NEXT_TELEMETRY_DISABLED: '1' }
  });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100 && server.exitCode === null; i++) {
      ready = await new Promise(resolve => { const socket = net.connect(3100, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
      if (ready) break; await sleep(100);
    }
    assert.ok(ready, 'production server failed to start');
    browser = await chromium.launch({ headless: true, args: [`--disk-cache-dir=${path.join(work, 'cache')}`] });
    const context = await browser.newContext({ viewport: request.shape.viewport, serviceWorkers: 'block' });
    await context.addInitScript(({ clock }) => { const Original = Date; globalThis.Date = class extends Original { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }; }, { clock: CLOCK });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.name));
    const visit = async () => {
      const outputs = [], metrics = [];
      for (const route of ['/', '/status']) {
        const started = performance.now(), response = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 15000 });
        assert.equal(response.status(), 200);
        const navigationMs = performance.now() - started, body = (await response.body()).toString();
        const main = page.locator('main'); await main.waitFor({ state: 'visible' });
        const content = await main.evaluate(element => ({ text: element.innerText, links: [...element.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')]), headings: [...element.querySelectorAll('h1,h2,h3')].map(h => [h.tagName, h.textContent]) }));
        assert.ok(!PRIVATE.test(body) && !PRIVATE.test(JSON.stringify(content)), 'private telemetry in public output');
        assert.ok(content.text.length > 0 && content.headings.length > 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'horizontal overflow');
        const wire = await encoded(route); assert.equal(wire.status, 200);
        outputs.push({ route, content, status: response.status() }); metrics.push({ navigationMs, wire, decodedBodySha256: sha(body) });
      }
      assert.deepEqual(errors, [], 'public runtime errors');
      return { outputs, metrics };
    };
    const prior = request.shape.temperature === 'warm' ? await visit() : null;
    const observed = await visit();
    if (prior) assert.deepEqual(prior.outputs, observed.outputs, 'untimed/timed warm output parity');
    const owner = await context.request.get(base + '/api/owner/metrics', { timeout: 10000 });
    assert.ok([401, 403].includes(owner.status()), 'signed-out owner boundary');
    if (request.scenario === 'failure') {
      assert.match(observed.outputs[1].content.text, /unavailable|no.*data|not.*available|unknown/i);
      for (const [name, key] of [['legacy', 'legacy'], ['public', 'public']]) {
        fs.rmSync(path.join(work, name), { recursive: true }); fs.cpSync(config.fixtures[request.phase][key], path.join(work, name), { recursive: true });
      }
    }
    const happy = request.scenario === 'happy' ? observed : await visit();
    return { ...request, status: 'complete', semanticDigest: sha(JSON.stringify(happy.outputs)),
      capabilities: ['public-production-browser-v1', 'signed-out-redaction', 'actual-encoded-http'],
      outputHash: sha(JSON.stringify(observed.outputs)), output: observed,
      metrics: { navigationMs: { unit: 'ms', scope: 'nested', values: observed.metrics.map(m => m.navigationMs) },
        encodedBytes: { unit: 'bytes', scope: 'nested', values: observed.metrics.map(m => m.wire.bytes) } } };
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), sleep(2000)]);
    if (server.exitCode === null) { server.kill('SIGKILL'); await new Promise(resolve => server.once('exit', resolve)); }
    fs.closeSync(log);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  try { console.log(JSON.stringify(await run(config, JSON.parse(process.env.MEASURE_REQUEST)))); }
  catch (error) { console.error(JSON.stringify({ status: 'ERROR', type: error.name, message: error.message.slice(0, 500) })); process.exitCode = 1; }
}
