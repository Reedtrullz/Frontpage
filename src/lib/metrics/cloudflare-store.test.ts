import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareMetricsTooLargeError, readCloudflareProjectionV2 } from "./cloudflare-store";

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
