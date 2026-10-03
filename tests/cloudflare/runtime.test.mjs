import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encode } from 'next-auth/jwt';
import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { startRuntime, base, version, secret } from './runtime.mjs';
const cookie = async sub => `authjs.session-token=${await encode({token:{sub, name:'Fixture user'}, secret, salt:'authjs.session-token'})}`;
const jsonHeaders = async sub => ({cookie: await cookie(sub), origin:base, 'content-type':'application/json'});
test('built Worker exercises SQL owner state, isolation, collector and proxy, including restart', {timeout:180000}, async () => {
  let runtime = await startRuntime();
  try {
    assert.equal((await (await fetch(base+'/api/health')).json()).version, version);
    for(const route of ['/api/owner/metrics?range=1h&view=host', '/api/owner/incidents']) {
      assert.equal((await fetch(base+route)).status,401, route);
      const nonOwner=await fetch(base+route,{headers:{cookie:await cookie('not-owner')}});
      assert.equal(nonOwner.status,403,route);
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
  } finally {await runtime.stop();}
});
test('missing Worker binding fails closed', {timeout:60000},async()=>{const runtime=await startRuntime({missingBinding:true});try{assert.equal((await fetch(base+'/api/health')).status,500);}finally{await runtime.stop();}});
