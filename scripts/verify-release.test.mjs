import test from "node:test";
import assert from "node:assert/strict";
import { verifyRelease } from "./verify-release.mjs";

const sha = "a".repeat(40);

function response(status, body, contentType = "application/json") {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

function healthyFetch({ healthSha = sha, ownerStatus = 401, ownerBody = "Unauthorized", failPath } = {}) {
  const paths = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    paths.push(`${parsed.pathname}${parsed.search}`);
    assert.equal(options.redirect, "manual");
    if (parsed.pathname === "/api/health") {
      return response(200, JSON.stringify({ status: "healthy", version: healthSha }));
    }
    if (parsed.pathname.startsWith("/api/owner/")) {
      return response(ownerStatus, ownerBody);
    }
    if (parsed.pathname === "/") return response(200, "<html><body>reidar.tech / Project OS</body></html>", "text/html; charset=utf-8");
    if (parsed.pathname === "/projects") return response(200, "<html><body><h1>Published projects</h1></body></html>", "text/html; charset=utf-8");
    if (parsed.pathname === "/status") return response(200, "<html><body><h1>System status</h1></body></html>", "text/html; charset=utf-8");
    if (parsed.pathname === "/proposals") {
      return response(200, "<html>proposal origin</html>", "text/html");
    }
    if (["/api/proposals", "/api/agents"].includes(parsed.pathname)) {
      return response(200, "{}", "application/json");
    }
    return response(failPath === parsed.pathname ? 503 : 404, "unavailable");
  };
  return { fetchImpl, paths };
}

test("release verifier checks the exact SHA, public routes, anonymous owner denial, and forwarding", async () => {
  const { fetchImpl, paths } = healthyFetch();
  const result = await verifyRelease({
    baseUrl: "https://release.example.test",
    expectedSha: sha,
    fetchImpl,
    sleepImpl: async () => {},
  });

  assert.equal(result.expectedSha, sha);
  assert.deepEqual(paths, [
    "/api/health", "/", "/projects", "/status",
    "/api/owner/metrics?range=1h&view=host",
    "/proposals", "/api/proposals", "/api/agents",
  ]);
});

test("a healthy response for a different SHA fails release verification", async () => {
  const { fetchImpl } = healthyFetch({ healthSha: "b".repeat(40) });
  await assert.rejects(
    verifyRelease({ baseUrl: "https://release.example.test", expectedSha: sha, fetchImpl, sleepImpl: async () => {} }),
    /exact expected version/,
  );
});

test("owner response containing private metrics fails even when access is denied", async () => {
  const { fetchImpl } = healthyFetch({ ownerStatus: 401, ownerBody: "Unauthorized cpu_percent=42" });
  await assert.rejects(
    verifyRelease({ baseUrl: "https://release.example.test", expectedSha: sha, fetchImpl, sleepImpl: async () => {} }),
    /private data marker/,
  );
});

test("release verification retries transient route failures within the configured bound", async () => {
  const { fetchImpl: healthy, paths } = healthyFetch();
  let attempts = 0;
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname === "/projects" && attempts++ < 2) return response(503, "unavailable");
    return healthy(url, options);
  };
  await verifyRelease({ baseUrl: "https://release.example.test", expectedSha: sha, fetchImpl, sleepImpl: async () => {} });
  assert.equal(attempts, 3);
  assert.ok(paths.includes("/projects"));
});

test("release verifier rejects non-HTTPS origins and non-full identities", async () => {
  await assert.rejects(verifyRelease({ baseUrl: "http://release.example.test", expectedSha: sha }), /HTTPS/);
  await assert.rejects(verifyRelease({ baseUrl: "https://release.example.test", expectedSha: "dev" }), /full 40-character/);
});


test("a required forwarding route failure blocks release acceptance", async () => {
  const { fetchImpl: healthy } = healthyFetch();
  let attempts = 0;
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname === "/api/agents") {
      attempts += 1;
      return response(503, "unavailable");
    }
    return healthy(url, options);
  };
  await assert.rejects(
    verifyRelease({ baseUrl: "https://release.example.test", expectedSha: sha, fetchImpl, sleepImpl: async () => {} }),
    /\/api\/agents forwarding did not return HTTP 2xx/,
  );
  assert.equal(attempts, 3);
});


test("a route returning generic HTML without its page content fails release acceptance", async () => {
  const { fetchImpl: healthy } = healthyFetch();
  const fetchImpl = async (url, options) => new URL(url).pathname === "/projects"
    ? response(200, "<html><body>generic error</body></html>", "text/html")
    : healthy(url, options);
  await assert.rejects(
    verifyRelease({ baseUrl: "https://release.example.test", expectedSha: sha, fetchImpl, sleepImpl: async () => {} }),
    /expected public page marker/,
  );
});
