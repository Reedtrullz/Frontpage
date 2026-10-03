import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { initializeCloudflareV1 } from "./cloudflare-v1-upload";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareMetricsTooLargeError, readCloudflareMetric, type SqlStore, readCloudflareProjectionV2 } from "./cloudflare-store";

const context = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => context }));

function configureStore(payload: unknown) {
  const data = gzipSync(Buffer.from(JSON.stringify(payload)));
  context.env = {
    FRONTPAGE_SQL: {
      exec(query: string) {
        if (query.includes("SELECT enabled")) return { toArray: () => [{ enabled: 1 }] };
        if (query.includes("SELECT f.data")) return { toArray: () => [{ data }] };
        throw new Error("Unexpected query");
      },
    },
  };
  process.env.FRONTPAGE_CLOUDFLARE = "1";
}

afterEach(() => {
  context.env = {};
  delete process.env.FRONTPAGE_CLOUDFLARE;
});

describe("Cloudflare projection decoded byte budget", () => {
  it("charges decoded bytes against the shared query budget", () => {
    const payload = { value: "bounded decoded data" };
    const decodedLength = Buffer.byteLength(JSON.stringify(payload));
    const budget = { remainingBytes: decodedLength + 3 };
    configureStore(payload);

    expect(
      readCloudflareProjectionV2("/cloudflare/metrics-v2/owner", "host/1h.v2.json", 1024, budget),
    ).toEqual(payload);
    expect(budget.remainingBytes).toBe(3);
  });

  it("stops decompression at the remaining aggregate budget", () => {
    configureStore({ value: "x".repeat(4096) });
    const budget = { remainingBytes: 128 };

    expect(() =>
      readCloudflareProjectionV2("/cloudflare/metrics-v2/owner", "host/1h.v2.json", 8192, budget),
    ).toThrow(CloudflareMetricsTooLargeError);
    expect(budget.remainingBytes).toBe(128);
  });
});

it('reports mismatched legacy pairs unavailable and reads a coherent pair',()=>{
 const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite'),db=new DatabaseSync(':memory:');
 const sql:SqlStore={exec:(query,...bindings)=>{const rows=db.prepare(query).all(...bindings);return{toArray:()=>rows};}};
 initializeCloudflareV1(sql);context.env={FRONTPAGE_SQL:sql};vi.stubEnv('FRONTPAGE_CLOUDFLARE','1');
 const snapshot=(collected_at:string)=>({schema_version:1,collected_at,host:{cpu_percent:1,ram_used_bytes:1,ram_total_bytes:2,disk_used_bytes:1,disk_total_bytes:2,load_1m:1,load_5m:1,load_15m:1,uptime_seconds:1},services:[],containers:[]});
 const latest=snapshot('2026-10-03T13:01:00Z'),older=snapshot('2026-10-03T13:00:00Z');
 try{
  sql.exec('INSERT INTO metrics_snapshot(name,data) VALUES(?,?)','latest.json',gzipSync(JSON.stringify(latest)));
  sql.exec('INSERT INTO metrics_snapshot(name,data) VALUES(?,?)','history.json',gzipSync(JSON.stringify({schema_version:1,samples:[older]})));
  expect(()=>readCloudflareMetric('latest.json')).toThrow('disagree');expect(()=>readCloudflareMetric('history.json')).toThrow('disagree');
  sql.exec('UPDATE metrics_snapshot SET data=? WHERE name=?',gzipSync(JSON.stringify({schema_version:1,samples:[older,latest]})),'history.json');
  expect(readCloudflareMetric('latest.json')).toEqual(latest);expect(readCloudflareMetric('history.json')).toEqual({schema_version:1,samples:[older,latest]});
 }finally{vi.unstubAllEnvs();db.close();}
});
