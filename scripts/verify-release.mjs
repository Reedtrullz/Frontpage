#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[a-f0-9]{40}$/;
const MAX_RESPONSE_BYTES = 512 * 1024;
const PUBLIC_ROUTE_MARKERS = {
  "/": "reidar.tech / Project OS",
  "/projects": "Published projects",
  "/status": "System status",
};
const PRIVATE_MARKERS = [
  "cpu_percent",
  "ram_used_bytes",
  "disk_used_bytes",
  "uptime_seconds",
  "frontpage-internal",
  "frontpage-container",
  "Collector diagnostics",
  "Owner status",
];

export class ReleaseVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseVerificationError";
  }
}

function validateOptions({ baseUrl, expectedSha, retries, timeoutMs }) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ReleaseVerificationError("Base URL must be a valid HTTPS origin.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new ReleaseVerificationError("Base URL must be a clean HTTPS origin with no credentials, path, query, or fragment.");
  }
  if (!FULL_SHA.test(expectedSha)) {
    throw new ReleaseVerificationError("Expected version must be a full 40-character lowercase commit SHA.");
  }
  if (!Number.isInteger(retries) || retries < 1 || retries > 5) {
    throw new ReleaseVerificationError("Retries must be between 1 and 5.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new ReleaseVerificationError("Request timeout must be between 100 and 30000 milliseconds.");
  }
  return parsed.origin;
}

async function readBoundedBody(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new ReleaseVerificationError("Response exceeded the bounded release-smoke response size.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ReleaseVerificationError("Response exceeded the bounded release-smoke response size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function assertNoPrivateMarkers(body, route) {
  const marker = PRIVATE_MARKERS.find((value) => body.includes(value));
  if (marker) throw new ReleaseVerificationError(`${route} response contained a private data marker.`);
}

function parseJson(body, route) {
  try {
    return JSON.parse(body);
  } catch {
    throw new ReleaseVerificationError(`${route} did not return valid JSON.`);
  }
}

export async function verifyRelease({
  baseUrl,
  expectedSha,
  fetchImpl = fetch,
  retries = 3,
  timeoutMs = 5_000,
  delayMs = 250,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const origin = validateOptions({ baseUrl, expectedSha, retries, timeoutMs });
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5_000) {
    throw new ReleaseVerificationError("Retry delay must be between 0 and 5000 milliseconds.");
  }
  const checked = [];

  async function request(route, { redirectPrefix, maxRedirects = 0 } = {}) {
    let currentUrl = new URL(route, origin);
    const visited = new Set([currentUrl.href]);
    let redirects = 0;

    while (true) {
      let lastFailure;
      let result;
      for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
          const response = await fetchImpl(currentUrl, {
            method: "GET",
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
            headers: { accept: route.startsWith("/api/") ? "application/json" : "text/html,application/json" },
          });
          const body = await readBoundedBody(response);
          if (response.status >= 500 && attempt + 1 < retries) {
            lastFailure = `HTTP ${response.status}`;
            await sleepImpl(delayMs * (attempt + 1));
            continue;
          }
          result = { response, body };
          break;
        } catch (error) {
          if (error instanceof ReleaseVerificationError) throw error;
          lastFailure = error?.name === "TimeoutError" || error?.name === "AbortError" ? "request timed out" : "request failed";
          if (attempt + 1 < retries) await sleepImpl(delayMs * (attempt + 1));
        }
      }
      if (!result) throw new ReleaseVerificationError(`${route} failed after ${retries} bounded attempts (${lastFailure ?? "unknown failure"}).`);

      const { response } = result;
      if (![301, 302, 303, 307, 308].includes(response.status)) return result;
      if (!redirectPrefix || redirects >= maxRedirects) {
        throw new ReleaseVerificationError(`${route} forwarding exceeded its allowed redirect contract.`);
      }
      const location = response.headers.get("location");
      if (!location) throw new ReleaseVerificationError(`${route} forwarding redirect omitted Location.`);
      let destination;
      try {
        destination = new URL(location, currentUrl);
      } catch {
        throw new ReleaseVerificationError(`${route} forwarding redirect had an invalid destination.`);
      }
      const withinPrefix = destination.pathname === redirectPrefix || destination.pathname.startsWith(`${redirectPrefix}/`);
      if (destination.origin !== origin || destination.username || destination.password || !withinPrefix) {
        throw new ReleaseVerificationError(`${route} forwarding redirect left its same-origin path prefix.`);
      }
      if (visited.has(destination.href)) throw new ReleaseVerificationError(`${route} forwarding redirect loop detected.`);
      visited.add(destination.href);
      currentUrl = destination;
      redirects += 1;
    }
  }

  async function check(route, validate) {
    const { response, body } = await request(route);
    validate(response, body);
    checked.push(route.split("?")[0]);
  }

  await check("/api/health", (response, body) => {
    if (response.status !== 200) throw new ReleaseVerificationError("/api/health did not return HTTP 200.");
    const health = parseJson(body, "/api/health");
    if (health.status !== "healthy") throw new ReleaseVerificationError("/api/health did not report healthy status.");
    if (health.version !== expectedSha) throw new ReleaseVerificationError("/api/health did not report the exact expected version.");
  });

  for (const route of ["/", "/projects", "/status"]) {
    await check(route, (response, body) => {
      if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
        throw new ReleaseVerificationError(`${route} did not return an HTML page with HTTP 200.`);
      }
      if (!body.trim() || !body.includes(PUBLIC_ROUTE_MARKERS[route])) {
        throw new ReleaseVerificationError(`${route} did not render its expected public page marker.`);
      }
      assertNoPrivateMarkers(body, route);
    });
  }

  await check("/api/owner/metrics?range=1h&view=host", (response, body) => {
    if (response.status !== 401 && response.status !== 403) {
      throw new ReleaseVerificationError("Anonymous owner metrics request was not denied with HTTP 401 or 403.");
    }
    assertNoPrivateMarkers(body, "/api/owner/metrics");
  });

  {
    const route = "/proposals";
    const { response, body } = await request(route, { redirectPrefix: "/proposals", maxRedirects: 3 });
    const isHtml = response.headers.get("content-type")?.toLowerCase().includes("text/html");
    const hasProjectsTitle = /<title(?:\s[^>]*)?>\s*Projects\s*<\/title>/i.test(body);
    if (response.status !== 200 || !isHtml || !body.trim() || !hasProjectsTitle) {
      throw new ReleaseVerificationError("/proposals forwarding did not reach non-empty Projects HTML.");
    }
    checked.push(route);
  }

  for (const route of ["/api/proposals", "/api/agents"]) {
    await check(route, (response, body) => {
      if (route === "/api/agents" && response.status === 405) {
        const allow = response.headers.get("allow")?.trim();
        if (allow !== "POST" || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
          throw new ReleaseVerificationError("/api/agents GET method response must be JSON 405 with exactly Allow: POST.");
        }
        const methodResponse = parseJson(body, route);
        if (!methodResponse || typeof methodResponse !== "object" || Array.isArray(methodResponse)
            || Object.keys(methodResponse).length !== 1 || methodResponse.detail !== "Method Not Allowed") {
          throw new ReleaseVerificationError("/api/agents GET method response did not match the POST-only JSON method contract.");
        }
        return;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new ReleaseVerificationError(`${route} forwarding did not return HTTP 2xx.`);
      }
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        throw new ReleaseVerificationError(`${route} forwarding did not return JSON.`);
      }
      parseJson(body, route);
    });
  }

  return { origin, expectedSha, checked };
}

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!["--base-url", "--expected-sha", "--retries", "--timeout-ms"].includes(name) || !args[index + 1]) {
      throw new ReleaseVerificationError("Usage: node scripts/verify-release.mjs --base-url <https-url> --expected-sha <full-sha> [--retries <1-5>] [--timeout-ms <100-30000>].");
    }
    result[name] = args[++index];
  }
  if (!result["--base-url"] || !result["--expected-sha"]) {
    throw new ReleaseVerificationError("Usage: node scripts/verify-release.mjs --base-url <https-url> --expected-sha <full-sha> [--retries <1-5>] [--timeout-ms <100-30000>].");
  }
  return {
    baseUrl: result["--base-url"],
    expectedSha: result["--expected-sha"],
    retries: result["--retries"] === undefined ? 3 : Number(result["--retries"]),
    timeoutMs: result["--timeout-ms"] === undefined ? 5_000 : Number(result["--timeout-ms"]),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyRelease(parseArguments(process.argv.slice(2)));
    console.log(`Release smoke passed: ${result.origin} reports ${result.expectedSha}; ${result.checked.length} routes checked.`);
  } catch (error) {
    console.error(`Release smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
