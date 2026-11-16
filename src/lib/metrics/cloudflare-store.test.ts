import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { initializeCloudflareV1 } from "./cloudflare-v1-upload";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareMetricsTooLargeError, readCloudflareMetric, type SqlStore, readCloudflareProjectionV2 } from "./cloudflare-store";

const context = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => context }));
// Emulates workerd: ERR_BUFFER_TOO_LARGE is only exposed on the info:true path; the rest is real zlib.
vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  return {
    ...actual,
    gunzipSync: ((data: Parameters<typeof actual.gunzipSync>[0], options?: { info?: boolean }) => {
      try {
        return actual.gunzipSync(data, options as never);
      } catch (error) {
        if (!options?.info && (error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
          throw new RangeError("Memory limit would be exceeded");
        }
        throw error;
      }
    }) as typeof actual.gunzipSync,
  };
});

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
  const root = "/cloudflare/metrics-v2/owner";
  const read = (cap: number, budget?: { remainingBytes: number }) => readCloudflareProjectionV2(root, "host/1h.v2.json", cap, budget);
  const text = (bytes: number) => "x".repeat(bytes - 2); // the JSON string adds two quotes

  it("classifies one byte over the member and manifest caps as too large", () => {
    configureStore(text(4 * 1024 * 1024 + 1));
    expect(() => read(4 * 1024 * 1024)).toThrow(CloudflareMetricsTooLargeError);
    configureStore(text(512 * 1024 + 1));
    expect(() => read(512 * 1024)).toThrow(CloudflareMetricsTooLargeError);
  });

  it("accepts output exactly at the cap", () => {
    configureStore(text(512 * 1024));
    expect(read(512 * 1024)).toHaveLength(512 * 1024 - 2);
  });

  it("rejects ten 3.5 MB members once the shared 32 MiB budget is exhausted", () => {
    configureStore(text(3_500_000));
    const budget = { remainingBytes: 32 * 1024 * 1024 };
    for (let index = 0; index < 9; index += 1) read(4 * 1024 * 1024, budget);
    expect(() => read(4 * 1024 * 1024, budget)).toThrow(CloudflareMetricsTooLargeError);
  });

  it("does not classify corrupt or truncated gzip as too large", () => {
    const good = gzipSync(JSON.stringify("ok"));
    for (const data of [Buffer.from("not gzip"), good.subarray(0, good.length - 6)]) {
      context.env = { FRONTPAGE_SQL: { exec: (query: string) => ({ toArray: () => (query.includes("SELECT enabled") ? [{ enabled: 1 }] : [{ data }]) }) } };
      process.env.FRONTPAGE_CLOUDFLARE = "1";
      let thrown: unknown;
      try { read(1024); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(CloudflareMetricsTooLargeError);
      expect((thrown as NodeJS.ErrnoException).code).toMatch(/^Z_/);
    }
  });

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
