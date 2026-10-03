import app from './worker.js';
import {handleOwnerMaintenance} from '../src/lib/content/owner-maintenance';
import { initializeCloudflareV2, uploadCloudflareV2 } from '../src/lib/metrics/v2/cloudflare-upload';
import { timingSafeEqual } from 'node:crypto';
import { initializeCloudflareV1, uploadCloudflareV1 } from '../src/lib/metrics/cloudflare-v1-upload';

const names = new Set(['latest.json', 'history.json', 'v1/commit']);

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
    initializeCloudflareV2(this.state.storage.sql);
    initializeCloudflareV1(this.state.storage.sql);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__operator/owner-state') return handleOwnerMaintenance(request, this.env, this.state.storage);
    if (url.pathname.startsWith('/__collector/')) {
      const name = url.pathname.slice('/__collector/'.length);
      if (request.method !== 'PUT' || (!names.has(name) && !name.startsWith('v2/'))) return new Response('Not found', { status: 404 });
      if (!authorized(request, this.env.COLLECTOR_UPLOAD_SECRET)) {
        await request.body?.cancel();
        return new Response('Unauthorized', { status: 401 });
      }
      if (name.startsWith('v2/')) return uploadCloudflareV2(request, this.state.storage, this.env.VERSION);
      return uploadCloudflareV1(request, this.state.storage, name);
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
    if (url.pathname.startsWith('/__operator/')) {
      if (url.pathname !== '/__operator/owner-state' || !env.OWNER_OPERATOR_HOST || url.hostname !== env.OWNER_OPERATOR_HOST) return new Response('Not found', {status:404,headers:{'Cache-Control':'private, no-store'}});
    }
    if (url.pathname.startsWith('/__collector/') && request.method !== 'PUT') {
      return new Response('Not found', { status: 404 });
    }
    if (/^\/(?:proposals|api\/proposals|api\/agents)(?:\/|$)/.test(url.pathname)) {
      if (!env.PROPOSALS_ORIGIN) return new Response('Proposals origin unavailable', { status: 503 });
      const target = new URL(url.pathname + url.search, env.PROPOSALS_ORIGIN);
      if (target.protocol !== 'https:' || target.host === url.host) {
        return new Response('Proposals origin misconfigured', { status: 503 });
      }
      if (target.hostname === 'proposals-origin.reidar.tech' && !env.PROPOSALS_ORIGIN_TOKEN) {
        return new Response('Proposals origin token unavailable', { status: 503 });
      }
      const upstream = new Request(target, request);
      if (target.hostname === 'proposals-origin.reidar.tech') upstream.headers.set('X-Frontpage-Origin-Token', env.PROPOSALS_ORIGIN_TOKEN);
      return env.PROPOSALS_ORIGIN_SERVICE ? env.PROPOSALS_ORIGIN_SERVICE.fetch(upstream) : fetch(upstream);
    }
    return env.FRONTPAGE.get(env.FRONTPAGE.idFromName('primary')).fetch(request);
  },
};

export default worker;
