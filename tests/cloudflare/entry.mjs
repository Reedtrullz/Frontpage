const miningPayload = JSON.stringify({
  stats: {
    hashrate: "1200",
    hashrateAvg: { "1h": "1100", "6h": "1000", "24h": "900" },
    acceptedShares: "12",
    rejectedShares: "2",
    paid: "3.5",
    unlocked: "4",
    locked: "1",
    lastShare: String(Date.now() - 120_000),
  },
  workers: [{
    name: "runtime-public-worker",
    minerAgent: "RUNTIME_PRIVATE_PROVIDER_SENTINEL",
    loginTime: String(Date.now() - 3_600_000),
  }],
});

const fixtureFetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (
    url.origin !== "https://pearl.luckypool.io" ||
    url.pathname !== "/api/stats_address" ||
    request.method !== "GET"
  ) {
    throw new Error(`Cloudflare runtime test blocked outbound fetch to ${url.origin}${url.pathname}`);
  }
  return new Response(miningPayload, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
globalThis.fetch = fixtureFetch;
if (globalThis.fetch !== fixtureFetch) {
  throw new Error("Cloudflare runtime test could not install its fail-closed fetch fixture.");
}

const runtime = await import("../../.open-next/do-entry.mjs");
export const FrontpageDO = runtime.FrontpageDO;
export default runtime.default;
