import { spawn } from 'node:child_process';
import {randomUUID} from 'node:crypto';
import { mkdir, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
export const base = 'http://127.0.0.1:8788';
export const version = 'c'.repeat(40);
export const secret = 'frontpage-local-runtime-only-secret';
const root = process.cwd();
const scratch = path.join(root, '.superpowers/sdd/2026-10-03-all-open-issues/cloudflare-'+randomUUID());
export async function startRuntime({ missingBinding = false } = {}) {
  await mkdir(scratch, { recursive: true });
  const upstream = { name: 'frontpage-test-upstream', main: path.join(root, 'tests/cloudflare/upstream.mjs'), compatibility_date: '2026-09-28' };
  const config = {
    name: 'frontpage-runtime-test', main: path.join(root, '.open-next/do-entry.mjs'), compatibility_date: '2026-09-28', compatibility_flags: ['nodejs_compat'],
    assets: { directory: path.join(root, '.open-next/assets'), binding: 'ASSETS' },
    durable_objects: { bindings: missingBinding ? [] : [{ name: 'FRONTPAGE', class_name: 'FrontpageDO' }] },
    migrations: [{tag: 'v1', new_sqlite_classes: ['FrontpageDO']}],
    services: [{binding: 'PROPOSALS_ORIGIN_SERVICE', service: 'frontpage-test-upstream'}],
    vars: { AUTH_SECRET: secret, AUTH_URL: base, OWNER_GITHUB_ID: 'runtime-owner', VERSION: version, PROPOSALS_ORIGIN: 'https://proposals-origin.reidar.tech', PROPOSALS_ORIGIN_TOKEN: 'local-proxy-token', COLLECTOR_UPLOAD_SECRET: 'local-collector-token' },
  };
  await writeFile(path.join(scratch, 'main.json'), JSON.stringify(config));
  await writeFile(path.join(scratch, 'upstream.json'), JSON.stringify(upstream));
  const output = await open(path.join(scratch, 'runtime.log'), 'a');
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', path.join(scratch,'main.json'), '--config', path.join(scratch,'upstream.json'), '--port', '8788', '--persist-to', path.join(scratch,'state')], { cwd: root, stdio: ['ignore', output.fd, output.fd], env: {...process.env, WRANGLER_SEND_METRICS: 'false'} });
  const stop = async () => { child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null) child.kill('SIGKILL'); await output.close(); };
  try {
    for(let attempt=0;attempt<150;attempt++) {
      if(child.exitCode !== null) throw new Error('Wrangler exited; inspect local runtime.log');
      try { const response = await fetch(base+'/api/health', {signal: AbortSignal.timeout(1500)}); if(response.status === (missingBinding ? 500 : 200)) return {stop}; } catch {}
      await delay(200);
    }
    throw new Error('Wrangler readiness deadline exceeded; inspect local runtime.log');
  } catch(error) { await stop(); throw error; }
}
