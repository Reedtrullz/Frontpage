import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encode } from 'next-auth/jwt';
import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { startRuntime, base, version, secret, collectRuntimeIdentity, assertIdentityComplete, fixtureRecord } from './runtime.mjs';
import { fullWindowFixture } from './full-window-fixtures.mjs';
// Authored fixture identities for the native case, emitted as a diagnostic so they survive scratch cleanup.
const fixtureIds = [];
let fixtureCase = 'upload';
const cookie = async sub => `authjs.session-token=${await encode({token:{sub, name:'Fixture user'}, secret, salt:'authjs.session-token'})}`;
const jsonHeaders = async sub => ({cookie: await cookie(sub), origin:base, 'content-type':'application/json'});
const fixture = name => JSON.parse(readFileSync(new URL(`../../ops/tests/fixtures/observability-v2/${name}`, import.meta.url), 'utf8'));
const privateNoStore = response => assert.equal(response.headers.get('cache-control'), 'private, no-store');

function assertHistoryMatchesFixture(history, fixtureHistory, requestBounds) {
  const resolutionMs = history.resolution_seconds * 1000;
  const timestamps = history.timestamps.map(Date.parse);
  assert.ok(resolutionMs > 0);
  assert.ok(timestamps.length > 0);
  assert.ok(timestamps.every(Number.isFinite));
  assert.ok(timestamps.every(timestamp => timestamp % resolutionMs === 0));

  const firstPossibleSlot = Math.floor(requestBounds.startedAt / resolutionMs) * resolutionMs;
  const lastPossibleSlot = Math.floor(requestBounds.finishedAt / resolutionMs) * resolutionMs;
  const lastReturnedSlot = timestamps.at(-1);
  assert.ok(
    lastReturnedSlot >= firstPossibleSlot && lastReturnedSlot <= lastPossibleSlot,
    `last closed slot ${new Date(lastReturnedSlot).toISOString()} must fall within request clock bounds`,
  );
  assert.ok(timestamps.every((timestamp, index) =>
    timestamp === lastReturnedSlot - (timestamps.length - 1 - index) * resolutionMs));

  const fixtureIndexByTimestamp = new Map(
    fixtureHistory.timestamps.map((timestamp, index) => [Date.parse(timestamp), index]),
  );
  const fixtureSeriesById = new Map(fixtureHistory.series.map(series => [series.id, series]));
  assert.equal(history.series.length, fixtureHistory.series.length);
  let measuredValues = 0;
  let possibleValues = 0;
  for (const series of history.series) {
    const fixtureSeries = fixtureSeriesById.get(series.id);
    assert.ok(fixtureSeries, `fixture series ${series.id} must exist`);
    const expectedValues = timestamps.map(timestamp => {
      const fixtureIndex = fixtureIndexByTimestamp.get(timestamp);
      return fixtureIndex === undefined ? null : fixtureSeries.values[fixtureIndex] ?? null;
    });
    assert.deepEqual(series.values, expectedValues, `${series.id} must map by returned timestamp`);
    measuredValues += expectedValues.filter(value => value !== null).length;
    possibleValues += expectedValues.length;
  }
  assert.equal(history.coverage_percent, possibleValues ? (measuredValues / possibleValues) * 100 : 0);
}

test('maps owner history by returned timestamps when a request crosses a closed-slot boundary', () => {
  const resolutionMs = 15_000;
  const boundary = Date.parse('2026-10-03T15:00:00.000Z');
  const fixtureHistory = {
    timestamps: [-60_000, -45_000, -30_000, -15_000].map(offset => new Date(boundary + offset).toISOString()),
    series: [{id:'cpu-total', values:[22.1, 24.4, null, 31.2]}],
  };
  const timestamps = Array.from({length:240}, (_, index) =>
    new Date(boundary - (239 - index) * resolutionMs).toISOString(),
  );
  const values = Array(240).fill(null);
  values.splice(-5, 5, 22.1, 24.4, null, 31.2, null);
  const history = {
    resolution_seconds: 15,
    timestamps,
    series: [{id:'cpu-total', values}],
    coverage_percent: (3 / 240) * 100,
  };

  assertHistoryMatchesFixture(history, fixtureHistory, {
    startedAt: boundary - 1,
    finishedAt: boundary + 1,
  });
  assert.deepEqual(history.series[0].values.slice(-4), [24.4, null, 31.2, null]);
  assert.equal(history.coverage_percent, (3 / 240) * 100);
});

function v2FixtureSnapshot() {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const ownerSentinel = 'OWNER_V2_RUNTIME_SENTINEL_8f2d1a';
  const publicLatest = fixture('public-latest.json');
  publicLatest.generated_at = generatedAt;
  publicLatest.collected_at = generatedAt;
  for (const service of publicLatest.services) service.checked_at = generatedAt;

  const ownerLatest = fixture('owner-latest.json');
  ownerLatest.generated_at = generatedAt;
  ownerLatest.collected_at = generatedAt;
  for (const total of ownerLatest.host.totals) {
    total.updated_at = generatedAt;
    total.freshness = 'fresh';
  }
  ownerLatest.host.capabilities[0].detail = ownerSentinel;
  const incidentOpened = new Date(now - 10 * 60_000).toISOString();
  const incidentUpdated = new Date(now - 5 * 60_000).toISOString();
  for (const incident of ownerLatest.incidents) {
    incident.opened_at = incidentOpened;
    incident.updated_at = incidentUpdated;
    if (incident.state === 'recovered') incident.resolved_at = incidentUpdated;
    for (const [index, point] of (incident.evidence?.points ?? []).entries()) {
      point.recorded_at = new Date(now - (10 - index * 5) * 60_000).toISOString();
    }
  }

  const series = fixture('host-series-1h.json');
  series.generated_at = generatedAt;
  const lastClosedSlot = Math.floor(now / 15_000) * 15_000;
  series.timestamps = series.timestamps.map((_, index, timestamps) =>
    new Date(lastClosedSlot - (timestamps.length - 1 - index) * 15_000).toISOString(),
  );
  const emptyIncidents = { schema_version: 2, generated_at: generatedAt, incidents: [] };
  return {
    ownerSentinel,
    generatedAt,
    payloads: {
      'public/latest.v2.json': publicLatest,
      'public/incidents.v2.json': emptyIncidents,
      'owner/latest.v2.json': ownerLatest,
      'owner/incidents.v2.json': {
        schema_version: 2,
        generated_at: generatedAt,
        incidents: ownerLatest.incidents,
      },
      'owner/host/1h.v2.json': series,
      'owner/manifest.v2.json': {
        schema_version: 2,
        files: ['latest.v2.json', 'incidents.v2.json', 'host/1h.v2.json'],
      },
    },
  };
}

function syntheticAcceptedGate() {
  const now = Date.now();
  const windowEndedAt = new Date(now - 60_000).toISOString();
  const windowStartedAt = new Date(Date.parse(windowEndedAt) - 48 * 3_600_000).toISOString();
  return {
    schema_version: 3,
    approved: true,
    generated_at: new Date(now).toISOString(),
    evidence_started_at: windowStartedAt,
    window_started_at: windowStartedAt,
    window_ended_at: windowEndedAt,
    duration_hours: 48,
    paired_minutes: 2881,
    missed_minutes: 0,
    incomplete_v1_host_minutes: 0,
    incomplete_v2_host_minutes: 0,
    maximum_gap_seconds: 60,
    evidence_age_seconds: 60,
    p99_relative_divergence_percent: { cpu: 0.1, ram: 0.1, disk: 0.1 },
    public_service_comparisons: 17286,
    public_service_mismatch_percent: 0,
    evidence_epoch: {
      schema_version: 1,
      started_at: windowStartedAt,
      commit_sha: version,
      reason: 'collector_or_comparator_change',
    },
    thresholds: {
      minimum_duration_hours: 48,
      maximum_gap_seconds: 120,
      maximum_evidence_age_seconds: 120,
      maximum_p99_relative_divergence_percent: 2,
      public_service_mismatch_percent: 0,
    },
  };
}

async function uploadV2Snapshot(payloads) {
  const files = {};
  for (const [name, payload] of Object.entries(payloads)) {
    const bytes = Buffer.from(JSON.stringify(payload));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const compressed = gzipSync(bytes);
    fixtureIds.push(fixtureRecord(fixtureCase, name, bytes, compressed));
    files[name] = hash;
    const response = await fetch(`${base}/__collector/v2/${hash}`, {
      method: 'PUT',
      headers: { authorization: 'Bearer local-collector-token' },
      body: compressed,
    });
    assert.equal(response.status, 204, `upload ${name}`);
  }
  const manifest = { schema_version: 2, files };
  const prepared = await fetch(`${base}/__collector/v2/prepare`, {
    method: 'PUT',
    headers: { authorization: 'Bearer local-collector-token', 'content-type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  assert.equal(prepared.status, 200);
  assert.deepEqual((await prepared.json()).missing, []);
  const committed = await fetch(`${base}/__collector/v2/commit`, {
    method: 'PUT',
    headers: { authorization: 'Bearer local-collector-token', 'content-type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  assert.equal(committed.status, 204);
  const activated = await fetch(`${base}/__collector/v2/activate`, {
    method: 'PUT',
    headers: { authorization: 'Bearer local-collector-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version, gate: syntheticAcceptedGate() }),
  });
  assert.equal(activated.status, 204);
}

test('built Worker exercises SQL owner state, isolation, collector and proxy, including restart', {timeout:180000}, async () => {
  let runtime = await startRuntime();
  try {
    assert.equal((await (await fetch(base+'/api/health')).json()).version, version);
    for(const route of ['/api/owner/latest', '/api/owner/metrics?range=1h&view=host', '/api/owner/incidents']) {
      const anonymous=await fetch(base+route);
      assert.equal(anonymous.status,401, route);
      privateNoStore(anonymous);
      const nonOwner=await fetch(base+route,{headers:{cookie:await cookie('not-owner')}});
      assert.equal(nonOwner.status,403,route);
      privateNoStore(nonOwner);
    }
    assert.equal((await fetch(base+'/__operator/owner-state')).status,404);
    const canonical = await (await fetch(base+'/api/data')).json();
    const projects = structuredClone(canonical.projects);
    projects[0].shortDescription = 'PRIVATE SQL RUNTIME DRAFT SENTINEL';
    let result = await fetch(base+'/api/data/projects',{method:'PUT',headers:await jsonHeaders('runtime-owner'),body:JSON.stringify({content:projects,expectedRevision:null})});
    const saved = await result.json(); assert.equal(result.status,200,JSON.stringify(saved));
    result = await fetch(base+'/api/data/projects',{method:'PUT',headers:await jsonHeaders('runtime-owner'),body:JSON.stringify({content:projects,expectedRevision:null})}); assert.equal(result.status,409);
    result = await fetch(base+'/api/data/projects',{method:'PUT',headers:{...await jsonHeaders('runtime-owner'),origin:'https://untrusted.example'},body:JSON.stringify({content:projects,expectedRevision:saved.revision})}); assert.equal(result.status,403);
    const admin=await (await fetch(base+'/admin/projects',{headers:{cookie:await cookie('runtime-owner')}})).text();
    assert.match(admin,/PRIVATE SQL RUNTIME DRAFT SENTINEL/);
    for(const route of ['/', '/projects', '/api/data']) assert.doesNotMatch(await (await fetch(base+route)).text(),/PRIVATE SQL RUNTIME DRAFT SENTINEL/);
    assert.equal((await fetch(base+'/__collector/latest.json',{method:'PUT',body:'unparsed'})).status,401);
    assert.equal((await fetch(base+'/__collector/v2/commit',{method:'PUT',body:'{}'})).status,401);
    assert.equal((await fetch(base+'/__collector/latest.json',{method:'PUT',headers:{authorization:'Bearer local-collector-token'},body:gzipSync('{}')})).status,400);
    const latest={schema_version:1,collected_at:new Date().toISOString(),host:{cpu_percent:1,ram_used_bytes:1,ram_total_bytes:2,disk_used_bytes:1,disk_total_bytes:2,load_1m:1,load_5m:1,load_15m:1,uptime_seconds:1},services:[],containers:[]};
    const latestRaw=JSON.stringify(latest),historyRaw=JSON.stringify({schema_version:1,samples:[latest]}),generation=createHash('sha256').update(latestRaw).update('\0').update(historyRaw).digest('hex');
    assert.equal((await fetch(base+'/__collector/latest.json',{method:'PUT',headers:{authorization:'Bearer local-collector-token'},body:gzipSync(latestRaw.padEnd(512*1024,' '))})).status,204);
    assert.equal((await fetch(base+'/__collector/latest.json',{method:'PUT',headers:{authorization:'Bearer local-collector-token'},body:gzipSync(Buffer.alloc(512*1024+1))})).status,413);
    assert.equal((await fetch(base+'/__collector/latest.json',{method:'PUT',headers:{authorization:'Bearer local-collector-token'},body:'corrupt-gzip'})).status,400);
    assert.equal((await fetch(base+'/__collector/v1/capabilities')).status,401);
    const capability=await fetch(base+'/__collector/v1/capabilities',{headers:{authorization:'Bearer local-collector-token'}});assert.equal(capability.status,200);assert.deepEqual(await capability.json(),{schema_version:1,atomic_generations:true});
    const uploadHeaders={authorization:'Bearer local-collector-token','X-Frontpage-Generation':generation};
    assert.equal((await fetch(base+'/__collector/latest.json',{method:'PUT',headers:uploadHeaders,body:gzipSync(latestRaw)})).status,204);
    assert.equal((await fetch(base+'/__collector/v1/commit',{method:'PUT',headers:uploadHeaders})).status,400);
    assert.equal((await fetch(base+'/__collector/history.json',{method:'PUT',headers:uploadHeaders,body:gzipSync(historyRaw)})).status,204);
    for(let repeat=0;repeat<2;repeat++)assert.equal((await fetch(base+'/__collector/v1/commit',{method:'PUT',headers:uploadHeaders})).status,204);
    const decodedBomb=await fetch(base+'/__collector/v2/'+ 'f'.repeat(64),{method:'PUT',headers:{authorization:'Bearer local-collector-token'},body:gzipSync(Buffer.alloc(4*1024*1024+1))});assert.equal(decodedBomb.status,400);
    const oversizedStream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(512*1024));controller.enqueue(new Uint8Array(512*1024));controller.enqueue(new Uint8Array(1));controller.close();}});
    const streamedOversize=await fetch(base+'/__collector/v2/'+ 'e'.repeat(64),{method:'PUT',headers:{authorization:'Bearer local-collector-token'},body:oversizedStream,duplex:'half'});assert.equal(streamedOversize.status,413);
    const v2=v2FixtureSnapshot();
    await uploadV2Snapshot(v2.payloads);
    const ownerHeaders={cookie:await cookie('runtime-owner')};
    const ownerLatest=await fetch(base+'/api/owner/latest',{headers:ownerHeaders});assert.equal(ownerLatest.status,200);privateNoStore(ownerLatest);
    assert.match(await ownerLatest.text(),new RegExp(v2.ownerSentinel));
    const latestEtag=ownerLatest.headers.get('etag');assert.match(latestEtag,/^"[a-f0-9]{64}"$/);
    const latest304=await fetch(base+'/api/owner/latest',{headers:{...ownerHeaders,'if-none-match':latestEtag}});assert.equal(latest304.status,304);privateNoStore(latest304);assert.equal(await latest304.text(),'');
    const historyRequestStartedAt=Date.now();
    const history=await fetch(base+'/api/owner/metrics?range=1h&view=host',{headers:ownerHeaders});
    const historyResponseReceivedAt=Date.now();assert.equal(history.status,200);privateNoStore(history);
    const historyBody=await history.json();
    assert.equal(historyBody.range,'1h');assert.equal(historyBody.resolution_seconds,15);assert.equal(historyBody.timestamps.length,240);
    const historyFixture=v2.payloads['owner/host/1h.v2.json'];
    assertHistoryMatchesFixture(historyBody,historyFixture,{startedAt:historyRequestStartedAt,finishedAt:historyResponseReceivedAt});
    const feedResponse=await fetch(base+'/status/feed.json');assert.equal(feedResponse.status,200);
    const feedText=await feedResponse.text();const feed=JSON.parse(feedText);
    assert.equal(feed._frontpage.availability,'available');assert.equal(feed._frontpage.collected_at,v2.generatedAt);
    assert.equal(feed._frontpage.incident_generated_at,v2.generatedAt);
    assert.ok(Date.parse(feed._frontpage.checked_at)>=Date.parse(feed._frontpage.collected_at));
    assert.doesNotMatch(feedText,/OWNER_V2_RUNTIME_SENTINEL|RUNTIME_PRIVATE_PROVIDER_SENTINEL|frontpage-app|system\.slice/);
    const publicStatus=await fetch(base+'/status');assert.equal(publicStatus.status,200);
    const publicHtml=await publicStatus.text();
    assert.doesNotMatch(publicHtml,/OWNER_V2_RUNTIME_SENTINEL|RUNTIME_PRIVATE_PROVIDER_SENTINEL|private-agent-build|frontpage-app/);
    const ownerStatus=await fetch(base+'/status',{headers:ownerHeaders});assert.equal(ownerStatus.status,200);
    const ownerHtml=await ownerStatus.text();assert.match(ownerHtml,/Telemetry source timestamps/);assert.match(ownerHtml,/Latest:/);assert.match(ownerHtml,/Incidents:/);assert.match(ownerHtml,/History:/);assert.match(ownerHtml,/OWNER_V2_RUNTIME_SENTINEL/);
    assert.ok(ownerHtml.includes(v2.generatedAt.slice(0,16).replace('T',' ')));
    for(const route of ['/proposals/fixture?test=1','/api/proposals?test=1','/api/agents?test=1']) {
      const proxy=await fetch(base+route,{method:'POST',body:'proxy-fixture'}); assert.equal(proxy.status,200);
      const body=await proxy.json();assert.equal(body.path,route.split('?')[0]);assert.equal(body.query,'?test=1');assert.equal(body.method,'POST');assert.equal(body.body,'proxy-fixture');assert.equal(body.token,'local-proxy-token');
    }
    const browser=await chromium.launch();
    try{
      const context=await browser.newContext();await context.addCookies([{name:'authjs.session-token',value:(await cookie('runtime-owner')).split('=').slice(1).join('='),url:base,httpOnly:true,sameSite:'Lax'}]);
      const first=await context.newPage(),second=await context.newPage();await Promise.all([first.goto(base+'/admin/personal'),second.goto(base+'/admin/personal')]);
      const original=await first.getByLabel('Bio').inputValue();await first.getByLabel('Bio').fill(original+' Runtime tab one');await second.getByLabel('Bio').fill(original+' Runtime tab two');
      await first.getByRole('button',{name:'Save draft',exact:true}).click();await expect(first.getByText('Personal draft saved locally. It is not published.')).toBeVisible();
      await second.getByRole('button',{name:'Save draft',exact:true}).click();await expect(second.getByText(/The draft changed/)).toBeVisible();assert.equal(await second.getByLabel('Bio').inputValue(),original+' Runtime tab two');
      const review=await context.newPage();await review.goto(base+'/admin');await expect(review.getByRole('heading',{name:'Review and publish'})).toBeVisible();await review.locator('summary').filter({hasText:'shortDescription'}).first().click();await expect(review.locator('pre').filter({hasText:'PRIVATE SQL RUNTIME DRAFT SENTINEL'})).toBeVisible();await expect(review.getByRole('button',{name:'Publish to GitHub'})).toBeDisabled();
      await context.close();
    }finally{await browser.close();}
    await runtime.stop();runtime=await startRuntime();
    assert.match(await (await fetch(base+'/admin/projects',{headers:{cookie:await cookie('runtime-owner')}})).text(),/PRIVATE SQL RUNTIME DRAFT SENTINEL/);
    const restartedLatest=await fetch(base+'/api/owner/latest',{headers:ownerHeaders});assert.equal(restartedLatest.status,200);privateNoStore(restartedLatest);assert.match(await restartedLatest.text(),/OWNER_V2_RUNTIME_SENTINEL/);
    const restartedHistoryRequestStartedAt=Date.now();
    const restartedHistory=await fetch(base+'/api/owner/metrics?range=1h&view=host',{headers:ownerHeaders});
    const restartedHistoryResponseReceivedAt=Date.now();assert.equal(restartedHistory.status,200);privateNoStore(restartedHistory);
    const restartedHistoryBody=await restartedHistory.json();
    const latestFixtureTimestamp=historyFixture.timestamps.at(-1);
    const latestFixtureIndex=restartedHistoryBody.timestamps.indexOf(latestFixtureTimestamp);
    assert.ok(latestFixtureIndex>=0,`restarted history must retain fixture sample ${latestFixtureTimestamp}`);
    assert.equal(restartedHistoryBody.series[0].values[latestFixtureIndex],31.2);
    const restartedLastClosedSlot=Date.parse(restartedHistoryBody.timestamps.at(-1));
    assert.ok(restartedLastClosedSlot>=Math.floor(restartedHistoryRequestStartedAt/15_000)*15_000);
    assert.ok(restartedLastClosedSlot<=Math.floor(restartedHistoryResponseReceivedAt/15_000)*15_000);
  } finally {await runtime.stop();}
});
test('missing Worker binding fails closed', {timeout:60000},async()=>{const runtime=await startRuntime({missingBinding:true});try{assert.equal((await fetch(base+'/api/health')).status,500);}finally{await runtime.stop();}});

const MiB = 1024 * 1024;
const NATIVE_SENTINEL = 'OWNER_NATIVE_SIZE_SENTINEL';
const nativeSeed = (qaKey, body) => fetch(base + '/__qa/seed', {method:'POST', headers:{'x-qa-key':qaKey,'content-type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(30000)});
const ownerMetrics = (headers, range) => fetch(base + '/api/owner/metrics?range=' + range + '&view=host', {headers, signal:AbortSignal.timeout(30000)});
// Valid JSON followed by trailing spaces: decoded size is exact, the gzip stays a few KiB.
function paddedRow(name, payload, bytes) {
  const text = JSON.stringify(payload);
  const decoded = Buffer.from(text + ' '.repeat(bytes - Buffer.byteLength(text)));
  assert.equal(decoded.byteLength, bytes);
  const compressed = gzipSync(decoded);
  assert.ok(compressed.length < 64 * 1024, name + ' must stay tiny when compressed');
  fixtureIds.push(fixtureRecord(fixtureCase, name, decoded, compressed));
  return {name, data:compressed.toString('base64')};
}
async function seeded(qaKey, entries, run) {
  assert.equal((await nativeSeed(qaKey, {action:'backup'})).status, 200);
  try {
    assert.equal((await nativeSeed(qaKey, {action:'apply', entries})).status, 200);
    await run();
  } finally {
    assert.equal((await nativeSeed(qaKey, {action:'restore'})).status, 200, 'seed tables must be restored');
  }
}
async function assertTypedError(response, status, error) {
  const text = await response.text();
  assert.equal(response.status, status, text);
  privateNoStore(response);
  assert.deepEqual(JSON.parse(text), {error});
  assert.doesNotMatch(text, /Memory limit|RangeError|ERR_BUFFER|OWNER_NATIVE_SIZE_SENTINEL/);
}
const assertTooLarge = response => assertTypedError(response, 413, 'Projection exceeds its response cap.');
const assertUnavailable = response => assertTypedError(response, 503, 'Observability data is unavailable.');
async function assertPublicClean() {
  for (const route of ['/status', '/status/feed.json', '/api/data', '/']) {
    const response = await fetch(base + route, {signal:AbortSignal.timeout(30000)});
    assert.equal(response.status, 200, route);
    assert.doesNotMatch(await response.text(), /OWNER_NATIVE_SIZE_SENTINEL|Memory limit|RangeError/, route);
  }
}
function dailyChunk(date, index, generatedAt) {
  const start = Date.parse(date + 'T00:00:00.000Z');
  const timestamps = [0, 1, 2, 3].map(slot => new Date(start + slot * 900_000).toISOString());
  return {
    schema_version:2, generated_at:generatedAt, range:'30d', resolution_seconds:900, view:'host', resource:'cpu', timestamps,
    series:[{id:'host-total', label:'CPU total', unit:'percent', values:[0, 1, 2, 3].map(slot => 10 + index + slot / 10)}],
    coverage_percent:100, truncated:false,
  };
}

function ownerQuery(headers, range, view, resource) {
  const query = 'range=' + range + '&view=' + view + (resource ? '&resource=' + resource : '');
  return fetch(base + '/api/owner/metrics?' + query, { headers, signal: AbortSignal.timeout(30000) });
}

function seriesChunk({ view, resource, range, resolution, timestamps, series, generatedAt }) {
  return {
    schema_version: 2, generated_at: generatedAt, range, resolution_seconds: resolution, view,
    resource: view === 'workloads' ? resource : null, timestamps, series, coverage_percent: 100, truncated: false,
  };
}

function gzRow(caseName, name, payload) {
  const decoded = Buffer.from(JSON.stringify(payload));
  const compressed = gzipSync(decoded);
  fixtureIds.push(fixtureRecord(caseName, name, decoded, compressed));
  return { name, data: compressed.toString('base64') };
}

function manifestRow(caseName, files) {
  return gzRow(caseName, 'owner/manifest.v2.json', { schema_version: 2, files });
}

function mappedFixture(chunks, winners) {
  const byTimestamp = new Map();
  for (const chunk of chunks) {
    chunk.timestamps.forEach((timestamp, index) => {
      if (Object.hasOwn(winners, timestamp)) return;
      byTimestamp.set(timestamp, chunk.series.map(series => series.values[index] ?? null));
    });
  }
  for (const [timestamp, row] of Object.entries(winners)) byTimestamp.set(timestamp, row);
  const timestamps = [...byTimestamp.keys()].sort((left, right) => Date.parse(left) - Date.parse(right));
  return {
    timestamps,
    series: chunks[0].series.map((series, seriesIndex) => ({
      id: series.id, label: series.label, unit: series.unit,
      values: timestamps.map(timestamp => byTimestamp.get(timestamp)?.[seriesIndex] ?? null),
    })),
  };
}

function assertQuerySemantics(history, spec, fixtureHistory, bounds) {
  assertHistoryMatchesFixture(history, fixtureHistory, bounds);
  assert.equal(history.range, spec.range);
  assert.equal(history.view, spec.view);
  assert.equal(history.resource, spec.resource);
  assert.equal(history.resolution_seconds, spec.resolution);
  assert.equal(history.timestamps.length, spec.cap);
  const values = history.series.flatMap(series => series.values);
  assert.equal(values.includes(987.5), false);
  assert.equal(values.includes(111.1), false);
}

function seriesIdentity(view) {
  return view === 'workloads'
    ? [{ id: 'workload-a', label: 'Workload A', unit: 'bytes' }, { id: 'workload-b', label: 'Workload B', unit: 'bytes' }]
    : [{ id: 'host-total', label: 'CPU total', unit: 'percent' }, { id: 'host-load', label: 'Load', unit: 'percent' }];
}

function quarterMarks(date, seedNow) {
  const start = Date.parse(date + 'T00:00:00.000Z');
  const end = Math.min(start + 86_400_000 - 900_000, Math.floor(seedNow / 900_000) * 900_000);
  const timestamps = [];
  for (let at = start; at <= end; at += 900_000) timestamps.push(new Date(at).toISOString());
  return timestamps;
}

function datedQuery(caseName, range, view, resource) {
  const seedNow = Date.now();
  const generatedAt = new Date(seedNow - 60_000).toISOString();
  const day = 86_400_000;
  const today = Math.floor(seedNow / day) * day;
  const span = range === '24h' ? 1 : range === '7d' ? 7 : 30;
  const sentinelDays = range === '24h' ? 4 : range === '7d' ? 10 : 33;
  const dates = Array.from({ length: span + 1 }, (_, index) => new Date(today - (span - index) * day).toISOString().slice(0, 10));
  const sentinel = new Date(today - sentinelDays * day).toISOString().slice(0, 10);
  const resolution = range === '30d' ? 900 : 60;
  const cap = range === '24h' ? 1440 : range === '7d' ? 10080 : 2880;
  const baseName = view === 'workloads' ? 'workloads/' + resource : 'host';
  const tier = range === '30d' ? 'quarter-hour' : 'minute';
  const identity = seriesIdentity(view);
  const chunks = [];
  const rows = [];
  const winners = {};
  for (const [index, date] of dates.entries()) {
    const next = dates[index + 1];
    const timestamps = quarterMarks(date, seedNow);
    const boundary = next ? next + 'T00:00:00.000Z' : undefined;
    if (boundary && Date.parse(boundary) <= seedNow) {
      winners[boundary] = [222.2, 222.2];
      if (!timestamps.includes(boundary)) timestamps.push(boundary);
      timestamps.sort((left, right) => Date.parse(left) - Date.parse(right));
    }
    const series = identity.map((item, seriesIndex) => ({
      ...item,
      values: timestamps.map((timestamp, slot) => {
        if (boundary && timestamp === boundary) return 111.1;
        if (winners[timestamp]) return 222.2;
        if ((slot + 1) % 11 === 0) return null;
        return seriesIndex === 0 ? slot + 1 : (slot + 1) / 2;
      }),
    }));
    const payload = seriesChunk({ view, resource, range, resolution, timestamps, series, generatedAt });
    chunks.push(payload);
    rows.push(gzRow(caseName, 'owner/' + baseName + '/' + tier + '/' + date + '.v2.json', payload));
  }
  const sentinelPayload = seriesChunk({
    view, resource, range, resolution, timestamps: [sentinel + 'T00:00:00.000Z'], generatedAt,
    series: identity.map(item => ({ ...item, values: [987.5] })),
  });
  rows.push(gzRow(caseName, 'owner/' + baseName + '/' + tier + '/' + sentinel + '.v2.json', sentinelPayload));
  rows.unshift(manifestRow(caseName, [
    ...dates.map(date => baseName + '/' + tier + '/' + date + '.v2.json'),
    baseName + '/' + tier + '/' + sentinel + '.v2.json',
  ]));
  return {
    rows, fixture: mappedFixture(chunks, winners),
    spec: { range, view, resource: view === 'workloads' ? resource : null, resolution, cap },
  };
}

function hourWorkloads(caseName) {
  const seedNow = Date.now();
  const last = Math.floor(seedNow / 15_000) * 15_000 - 60_000;
  const timestamps = Array.from({ length: 240 }, (_, index) => new Date(last - (239 - index) * 15_000).toISOString());
  const identity = seriesIdentity('workloads');
  const payload = seriesChunk({
    view: 'workloads', resource: 'ram', range: '1h', resolution: 15, timestamps,
    generatedAt: new Date(seedNow - 60_000).toISOString(),
    series: identity.map((item, seriesIndex) => ({
      ...item,
      values: timestamps.map((_, slot) => ((slot + 1) % 11 === 0 ? null : seriesIndex === 0 ? slot + 1 : (slot + 1) / 2)),
    })),
  });
  return {
    rows: [manifestRow(caseName, ['workloads/ram/1h.v2.json']), gzRow(caseName, 'owner/workloads/ram/1h.v2.json', payload)],
    fixture: mappedFixture([payload], {}),
    spec: { range: '1h', view: 'workloads', resource: 'ram', resolution: 15, cap: 240 },
  };
}

async function stageV2Rows(caseName, payloads) {
  const files = {};
  for (const [name, payload] of Object.entries(payloads)) {
    const decoded = Buffer.from(JSON.stringify(payload));
    const hash = createHash('sha256').update(decoded).digest('hex');
    const compressed = gzipSync(decoded);
    fixtureIds.push(fixtureRecord(caseName, name, decoded, compressed));
    files[name] = hash;
    const response = await fetch(base + '/__collector/v2/' + hash, {
      method: 'PUT', headers: { authorization: 'Bearer local-collector-token' }, body: compressed, signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 204, 'upload ' + name);
  }
  return { schema_version: 2, files };
}

test('native decoded-size boundaries through the real Worker, Durable Object and owner metrics route', {timeout:150000}, async t => {
  fixtureIds.length = 0;
  fixtureCase = 'native-setup';
  const runtime = await startRuntime({native:true});
  const {qaKey} = runtime;
  const sub = (name, fn) => t.test(name, async st => { fixtureCase = name; return fn(st); });
  let report;
  try {
    // Bounded metadata probes run while the supervised runtime is up; incomplete identity fails the run after being recorded.
    const identity = await collectRuntimeIdentity();
    identity.files['tests/cloudflare/full-window-fixtures.mjs'] = createHash('sha256').update(readFileSync(new URL('./full-window-fixtures.mjs', import.meta.url))).digest('hex');
    identity.files['scripts/cloudflare-full-window-fixtures.test.mjs'] = createHash('sha256').update(readFileSync(new URL('../../scripts/cloudflare-full-window-fixtures.test.mjs', import.meta.url))).digest('hex');
    t.diagnostic(JSON.stringify(identity));
    assertIdentityComplete(identity);
    const v2 = v2FixtureSnapshot();
    const series1h = v2.payloads['owner/host/1h.v2.json'];
    series1h.series[0].label = 'CPU ' + NATIVE_SENTINEL;
    await uploadV2Snapshot(v2.payloads);
    const owner = {cookie: await cookie('runtime-owner')};

    await sub('local upstream binding is reachable and external fetch is denied', async () => {
      const proxy = await fetch(base + '/api/proposals?native-control=1', {method:'POST', body:'native-control', signal:AbortSignal.timeout(30000)});
      assert.equal(proxy.status, 200);
      assert.deepEqual(await proxy.json(), {path:'/api/proposals', query:'?native-control=1', method:'POST', body:'native-control', token:'local-proxy-token'});
      const egress = await fetch(base + '/__qa/egress', {method:'POST', headers:{'x-qa-key':qaKey}, signal:AbortSignal.timeout(30000)});
      assert.equal(egress.status, 200);
      assert.deepEqual(await egress.json(), {blocked:true, message:'Native regression blocked outbound fetch.'});
      // Scope: the JS fetch guard only; this is no proof of DNS or OS network denial.
    });

    await sub('QA routes are key-gated before the body is read', async () => {
      for (const headers of [{}, {'x-qa-key':'0'.repeat(64)}]) {
        for (const route of ['/__qa/seed', '/__qa/egress']) {
          const response = await fetch(base + route, {method:'POST', headers, body:'{not json', signal:AbortSignal.timeout(30000)});
          assert.equal(response.status, 404, route);
        }
      }
      assert.equal((await fetch(base + '/__qa/egress', {headers:{'x-qa-key':qaKey}, signal:AbortSignal.timeout(30000)})).status, 404);
    });

    await sub('baseline snapshot serves the owner history and keeps the sentinel out of public routes', async () => {
      const startedAt = Date.now();
      const response = await ownerMetrics(owner, '1h');
      const finishedAt = Date.now();
      assert.equal(response.status, 200);
      privateNoStore(response);
      const text = await response.text();
      assert.match(text, new RegExp(NATIVE_SENTINEL));
      assertHistoryMatchesFixture(JSON.parse(text), series1h, {startedAt, finishedAt});
      await assertPublicClean();
    });

    await sub('4 MiB member: exactly 4194304 decoded bytes is served, one more is 413', async () => {
      await seeded(qaKey, [paddedRow('owner/host/1h.v2.json', series1h, 4 * MiB)], async () => {
        const startedAt = Date.now();
        const response = await ownerMetrics(owner, '1h');
        const finishedAt = Date.now();
        assert.equal(response.status, 200);
        privateNoStore(response);
        assertHistoryMatchesFixture(await response.json(), series1h, {startedAt, finishedAt});
        await assertPublicClean();
      });
      await seeded(qaKey, [paddedRow('owner/host/1h.v2.json', series1h, 4 * MiB + 1)], async () => {
        await assertTooLarge(await ownerMetrics(owner, '1h'));
        for (const [headers, status, error] of [[{}, 401, 'Unauthorized'], [{cookie:await cookie('not-owner')}, 403, 'Forbidden']]) {
          const denied = await ownerMetrics(headers, '1h');
          assert.equal(denied.status, status);
          privateNoStore(denied);
          assert.deepEqual(await denied.json(), {error});
        }
        await assertPublicClean();
      });
    });

    await sub('512 KiB manifest: exactly 524288 decoded bytes is served, one more is 413', async () => {
      const manifest = v2.payloads['owner/manifest.v2.json'];
      await seeded(qaKey, [paddedRow('owner/manifest.v2.json', manifest, 512 * 1024)], async () => {
        const response = await ownerMetrics(owner, '1h');
        assert.equal(response.status, 200);
        privateNoStore(response);
        await assertPublicClean();
      });
      await seeded(qaKey, [paddedRow('owner/manifest.v2.json', manifest, 512 * 1024 + 1)], async () => {
        await assertTooLarge(await ownerMetrics(owner, '1h'));
        await assertPublicClean();
      });
    });

    await sub('32 MiB aggregate over nine daily 30d chunks: 33554432 is served, 33554433 is 413', async () => {
      const dayMs = 86_400_000;
      const today = Math.floor(Date.now() / dayMs) * dayMs;
      const dates = Array.from({length:9}, (_, index) => new Date(today - (9 - index) * dayMs).toISOString().slice(0, 10));
      const generatedAt = new Date(Date.now() - 60_000).toISOString();
      const chunks = dates.map((date, index) => dailyChunk(date, index, generatedAt));
      const manifestBytes = Buffer.from(JSON.stringify({schema_version:2, files:dates.map(date => 'host/quarter-hour/' + date + '.v2.json')})), manifestGzip = gzipSync(manifestBytes);
      fixtureIds.push(fixtureRecord(fixtureCase, 'owner/manifest.v2.json', manifestBytes, manifestGzip));
      const manifestRow = {name:'owner/manifest.v2.json', data:manifestGzip.toString('base64')};
      const rows = sizes => {
        assert.ok(sizes.every(size => size <= 4 * MiB));
        return [manifestRow, ...dates.map((date, index) => paddedRow('owner/host/quarter-hour/' + date + '.v2.json', chunks[index], sizes[index]))];
      };
      const valid = [...Array(7).fill(4 * MiB), 2 * MiB, 2 * MiB];
      const over = [...Array(7).fill(4 * MiB), 2 * MiB + 1, 2 * MiB];
      assert.equal(valid.reduce((sum, size) => sum + size, 0), 33554432);
      assert.equal(over.reduce((sum, size) => sum + size, 0), 33554433);
      await seeded(qaKey, rows(valid), async () => {
        const response = await ownerMetrics(owner, '30d');
        assert.equal(response.status, 200);
        privateNoStore(response);
        const body = await response.json();
        assert.equal(body.range, '30d');
        assert.equal(body.resolution_seconds, 900);
        const expected = new Map(chunks.flatMap(chunk => chunk.timestamps.map((timestamp, slot) => [Date.parse(timestamp), chunk.series[0].values[slot]])));
        assert.deepEqual(body.series[0].values, body.timestamps.map(timestamp => expected.get(Date.parse(timestamp)) ?? null));
        assert.equal(body.series[0].values.filter(value => value !== null).length, expected.size);
      });
      await seeded(qaKey, rows(over), async () => {
        await assertTooLarge(await ownerMetrics(owner, '30d'));
        await assertPublicClean();
      });
    });

    await sub('corrupt and truncated gzip rows are unavailable (503), distinct from 413', async () => {
      const valid = gzipSync(JSON.stringify(series1h));
      for (const data of [Buffer.from('not gzip'), valid.subarray(0, valid.length - 6)]) {
        fixtureIds.push(fixtureRecord(fixtureCase, 'owner/host/1h.v2.json', null, data));
        await seeded(qaKey, [{name:'owner/host/1h.v2.json', data:data.toString('base64')}], async () => {
          await assertUnavailable(await ownerMetrics(owner, '1h'));
          await assertPublicClean();
        });
      }
    });

    const rejectAltered = (history, built, bounds) => {
      const changed = structuredClone(history);
      changed.series[0].values[0] = typeof changed.series[0].values[0] === 'number' ? changed.series[0].values[0] + 1 : 1;
      const shifted = structuredClone(history);
      shifted.timestamps[0] = new Date(Date.parse(shifted.timestamps[0]) + built.spec.resolution * 1000).toISOString();
      const injected = structuredClone(history);
      injected.series[0].values[0] = 987.5;
      assert.throws(() => assertQuerySemantics(changed, built.spec, built.fixture, bounds));
      assert.throws(() => assertQuerySemantics(shifted, built.spec, built.fixture, bounds));
      assert.throws(() => assertQuerySemantics(injected, built.spec, built.fixture, bounds));
    };
    const queryCase = async (name, build) => {
      await sub(name, async () => {
        const built = build(name);
        await seeded(qaKey, built.rows, async () => {
          const startedAt = Date.now();
          const response = await ownerQuery(owner, built.spec.range, built.spec.view, built.spec.resource);
          const finishedAt = Date.now();
          assert.equal(response.status, 200);
          privateNoStore(response);
          const history = await response.json();
          const bounds = { startedAt, finishedAt };
          assertQuerySemantics(history, built.spec, built.fixture, bounds);
          if (name.endsWith('1h workloads ram')) rejectAltered(history, built, bounds);
          await assertPublicClean();
        });
      });
    };
    await queryCase('native partial parity query: 1h workloads ram', hourWorkloads);
    await queryCase('native partial parity query: 24h host', name => datedQuery(name, '24h', 'host', null));
    await queryCase('native partial parity query: 24h workloads ram', name => datedQuery(name, '24h', 'workloads', 'ram'));
    await queryCase('native partial parity query: 7d host', name => datedQuery(name, '7d', 'host', null));
    await queryCase('native partial parity query: 7d workloads ram', name => datedQuery(name, '7d', 'workloads', 'ram'));
    await queryCase('native partial parity query: 30d workloads ram', name => datedQuery(name, '30d', 'workloads', 'ram'));

    for (const range of ['1h', '24h', '7d', '30d']) {
      for (const view of ['host', 'workloads']) {
        await sub(`native full-window query: ${range} ${view}`, async () => {
          const built = fullWindowFixture(range, view, Date.now());
          const rows = Object.entries(built.payloads).map(([name, payload]) => gzRow(fixtureCase, name, payload));
          await seeded(qaKey, rows, async () => {
            const startedAt = Date.now();
            const response = await ownerQuery(owner, range, view, built.spec.resource);
            const finishedAt = Date.now();
            assert.equal(response.status, 200);
            privateNoStore(response);
            const history = await response.json();
            const bounds = { startedAt, finishedAt };
            const check = result => {
              assertQuerySemantics(result, built.spec, built.fixture, bounds);
              assert.equal(result.truncated, false);
              const metadata = items => items.map(({ id, label, unit }) => ({ id, label, unit }));
              assert.deepEqual(metadata(result.series), metadata(built.fixture.series));
            };
            check(history);
            rejectAltered(history, built, bounds);
            for (const field of ['label', 'unit']) {
              const changed = structuredClone(history);
              changed.series[0][field] = 'incorrect fixture metadata';
              assert.throws(() => check(changed));
            }
            const truncated = structuredClone(history);
            truncated.truncated = true;
            assert.throws(() => check(truncated));
            await assertPublicClean();
            t.diagnostic(JSON.stringify({ ns: 'frontpage-native-full-window/v1', range, view,
              slots: history.timestamps.length, series: history.series.length,
              chunks: rows.length - 1, outputBytes: Buffer.byteLength(JSON.stringify(history)),
              semanticSha256: createHash('sha256').update(JSON.stringify(history)).digest('hex'),
              seedLastSlot: built.fixture.timestamps.at(-1), requestBounds: bounds,
              metadata: true, values: true, nulls: true, coverage: true, truncated: false,
              alteredOutputControls: 6, publicRedaction: true }));
          });
        });
      }
    }

    const restoredBaseline = async () => {
      const startedAt = Date.now();
      const response = await ownerMetrics(owner, '1h');
      const finishedAt = Date.now();
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.match(text, new RegExp(NATIVE_SENTINEL));
      assertHistoryMatchesFixture(JSON.parse(text), series1h, { startedAt, finishedAt });
    };
    const faultCase = async (name, entries, run) => {
      await sub(name, async () => {
        await seeded(qaKey, entries(name), run);
      });
      await restoredBaseline();
    };
    const seedDate = new Date().toISOString().slice(0, 10);
    await faultCase('native partial parity fault: missing', name => [manifestRow(name, ['host/minute/' + seedDate + '.v2.json'])], async () => {
      await assertUnavailable(await ownerQuery(owner, '24h', 'host', null));
      await assertPublicClean();
    });
    await faultCase('native partial parity fault: json', name => {
      const decoded = Buffer.from('{not json');
      const compressed = gzipSync(decoded);
      fixtureIds.push(fixtureRecord(name, 'owner/host/1h.v2.json', decoded, compressed));
      return [{ name: 'owner/host/1h.v2.json', data: compressed.toString('base64') }];
    }, async () => {
      await assertUnavailable(await ownerQuery(owner, '1h', 'host', null));
      await assertPublicClean();
    });
    await faultCase('native partial parity fault: traversal', name => [manifestRow(name, ['../x.v2.json'])], async () => {
      await assertUnavailable(await ownerQuery(owner, '1h', 'host', null));
      await assertPublicClean();
    });
    await faultCase('native partial parity fault: duplicate', name => [manifestRow(name, ['host/1h.v2.json', 'host/1h.v2.json'])], async () => {
      await assertUnavailable(await ownerQuery(owner, '1h', 'host', null));
      await assertPublicClean();
    });
    await faultCase('native partial parity fault: date', name => [manifestRow(name, ['host/quarter-hour/2026-02-30.v2.json'])], async () => {
      await assertUnavailable(await ownerQuery(owner, '30d', 'host', null));
      await assertPublicClean();
    });
    await faultCase('native partial parity fault: future', name => [gzRow(name, 'owner/host/1h.v2.json', seriesChunk({
      view: 'host', resource: null, range: '1h', resolution: 15,
      timestamps: [new Date(Math.floor((Date.now() + 3_600_000) / 15_000) * 15_000).toISOString()],
      generatedAt: new Date(Date.now() - 60_000).toISOString(),
      series: [{ id: 'host-total', label: 'CPU total', unit: 'percent', values: [1] }],
    }))], async () => {
      await assertUnavailable(await ownerQuery(owner, '1h', 'host', null));
      await assertPublicClean();
    });
    await faultCase('native partial parity fault: out-of-window manifest', name => [manifestRow(name, ['host/minute/' + new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10) + '.v2.json'])], async () => {
      await assertUnavailable(await ownerQuery(owner, '24h', 'host', null));
      await assertPublicClean();
    });
    await faultCase('native partial parity fault: deactivate', name => [manifestRow(name, ['host/1h.v2.json'])], async () => {
      const response = await fetch(base + '/__collector/v2/deactivate', {
        method: 'PUT', headers: { authorization: 'Bearer local-collector-token' }, signal: AbortSignal.timeout(30000),
      });
      assert.equal(response.status, 204);
      await assertUnavailable(await ownerQuery(owner, '1h', 'host', null));
    });
    const staleCommit = 'native partial parity fault: stale-commit';
    await sub(staleCommit, async () => {
      const snap = v2FixtureSnapshot();
      const stale = new Date(Date.now() - 60_000).toISOString();
      snap.payloads['public/latest.v2.json'].collected_at = stale;
      snap.payloads['owner/latest.v2.json'].collected_at = stale;
      const manifest = await stageV2Rows(staleCommit, snap.payloads);
      const committed = await fetch(base + '/__collector/v2/commit', {
        method: 'PUT',
        headers: { authorization: 'Bearer local-collector-token', 'content-type': 'application/json' },
        body: JSON.stringify(manifest),
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(committed.status, 400);
      assert.equal(await committed.text(), 'Invalid or incomplete v2 snapshot or acceptance');
    });
    await restoredBaseline();
  } finally {
    t.diagnostic(JSON.stringify({ns:'frontpage-native-fixtures/v1', fixtures:fixtureIds}));
    report = await runtime.stop();
    t.diagnostic(JSON.stringify(report));
  }
  assert.deepEqual(report.breaches, []);
  assert.equal(report.cleanup.groupGone, true);
  assert.ok(report.peak.scratchBytes <= report.limits.scratchBytes);
  assert.ok(report.peak.stdoutBytes <= report.limits.perStreamBytes && report.peak.stderrBytes <= report.limits.perStreamBytes);
});
