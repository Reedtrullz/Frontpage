import app from './worker.js';
import { timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const names = new Set(['latest.json', 'history.json']);
const caps = { 'latest.json': 512 * 1024, 'history.json': 4 * 1024 * 1024 };

function authorized(request, secret) {
  if (!secret || !request.headers.get('authorization')?.startsWith('Bearer ')) return false;
  const received = Buffer.from(request.headers.get('authorization').slice(7));
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export class FrontpageDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.state.storage.sql.exec('CREATE TABLE IF NOT EXISTS metrics_snapshot (name TEXT PRIMARY KEY, data BLOB NOT NULL)');
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__collector/')) {
      const name = url.pathname.slice('/__collector/'.length);
      if (request.method !== 'PUT' || !names.has(name)) return new Response('Not found', { status: 404 });
      if (!authorized(request, this.env.COLLECTOR_UPLOAD_SECRET)) {
        await request.body?.cancel();
        return new Response('Unauthorized', { status: 401 });
      }
      const compressed = new Uint8Array(await request.arrayBuffer());
      if (!compressed.length || compressed.length > 1024 * 1024) return new Response('Payload too large', { status: 413 });
      let payload;
      try {
        payload = gunzipSync(compressed, { maxOutputLength: caps[name] });
        JSON.parse(payload.toString('utf8'));
      } catch {
        return new Response('Invalid snapshot', { status: 400 });
      }
      this.state.storage.sql.exec(
        'INSERT INTO metrics_snapshot (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data',
        name, compressed,
      );
      return new Response(null, { status: 204 });
    }
    return app.fetch(request, {
      ...this.env,
      FRONTPAGE_CLOUDFLARE: '1',
      FRONTPAGE_SQL: this.state.storage.sql,
      METRICS_DIR: '/metrics',
    }, this.state);
  }
}

const worker = {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__collector/') && request.method !== 'PUT') {
      return new Response('Not found', { status: 404 });
    }
    if (/^\/(?:proposals|api\/proposals|api\/agents)(?:\/|$)/.test(url.pathname)) {
      if (!env.PROPOSALS_ORIGIN) return new Response('Proposals origin unavailable', { status: 503 });
      const target = new URL(url.pathname + url.search, env.PROPOSALS_ORIGIN);
      if (target.protocol !== 'https:' || target.host === url.host) {
        return new Response('Proposals origin misconfigured', { status: 503 });
      }
      return fetch(new Request(target, request));
    }
    return env.FRONTPAGE.get(env.FRONTPAGE.idFromName('primary')).fetch(request);
  },
};

export default worker;
