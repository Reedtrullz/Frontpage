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
      return new Response(null, { status: 302, headers: { location: "/proposals/projects" } });
    }
    if (parsed.pathname === "/proposals/projects") {
      return response(200, "<html><head><title>Projects</title></head><body><h1>Projects</h1></body></html>", "text/html");
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
    "/proposals", "/proposals/projects", "/api/proposals", "/api/agents",
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

test("proposals accepts its bounded same-origin redirect to the Projects HTML page", async () => {
  const { fetchImpl: healthy } = healthyFetch();
  const proposalsPaths = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/proposals")) {
      proposalsPaths.push(parsed.pathname);
      assert.equal(options.method, "GET");
      if (parsed.pathname === "/proposals") {
        return new Response(null, { status: 302, headers: { location: "/proposals/projects" } });
      }
      return response(200, "<!doctype html><html><head><title>Projects</title></head><body><h1>Projects</h1></body></html>", "text/html; charset=utf-8");
    }
    return healthy(url, options);
  };
  const result = await verifyRelease({ baseUrl: "https://release.example.test", expectedSha: sha, fetchImpl, sleepImpl: async () => {} });
  assert.deepEqual(proposalsPaths, ["/proposals", "/proposals/projects"]);
  assert.ok(result.checked.includes("/proposals"));
});

test("proposals rejects cross-origin, off-prefix, looping, and overlong redirects", async (t) => {
  const cases = [
    { name: "missing Location", missingLocation: true },
    { name: "cross-origin", next: "https://outside.example.test/proposals/projects" },
    { name: "off-prefix", next: "/projects" },
    { name: "prefix lookalike", next: "/proposals-elsewhere" },
    { name: "loop", next: "/proposals" },
    { name: "more than three redirects", chain: ["/proposals/1", "/proposals/2", "/proposals/3", "/proposals/4"] },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { fetchImpl: healthy } = healthyFetch();
      const fetchImpl = async (url, options) => {
        const parsed = new URL(url);
        if (parsed.pathname.startsWith("/proposals")) {
          assert.equal(options.method, "GET");
          let next = scenario.next;
          if (scenario.chain) {
            const index = parsed.pathname === "/proposals" ? -1 : scenario.chain.indexOf(parsed.pathname);
            next = scenario.chain[index + 1] ?? "/proposals/5";
          }
          return new Response(null, { status: 302, headers: scenario.missingLocation ? {} : { location: next } });
        }
        return healthy(url, options);
      };
      await assert.rejects(
        verifyRelease({ baseUrl: "https://release.example.test", expectedSha: sha, fetchImpl, sleepImpl: async () => {} }),
        /proposals forwarding/,
      );
    });
  }
});

test("proposals requires the expected Projects HTML destination", async () => {
  const { fetchImpl: healthy } = healthyFetch();
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/proposals") return new Response(null, { status: 302, headers: { location: "/proposals/projects" } });
    if (parsed.pathname === "/proposals/projects") return response(200, "<html><title>Generic</title></html>", "text/html");
    return healthy(url, options);
  };
  await assert.rejects(
    verifyRelease({ baseUrl: "https://release.example.test", expectedSha: sha, fetchImpl, sleepImpl: async () => {} }),
    /Projects HTML/,
  );
});

test("agents read-only GET accepts only the exact POST-only JSON 405 or a valid JSON 2xx", async (t) => {
  const validResponses = [
    response(200, JSON.stringify({ agents: [] })),
    new Response(JSON.stringify({ detail: "Method Not Allowed" }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } }),
    new Response(JSON.stringify({ detail: "Method Not Allowed" }), { status: 405, headers: { "content-type": "Application/JSON; charset=utf-8", allow: "POST" } }),
  ];
  for (const [index, agentsResponse] of validResponses.entries()) {
    await t.test(index === 0 ? "JSON success" : "POST-only method contract", async () => {
      const { fetchImpl: healthy } = healthyFetch();
      const fetchImpl = async (url, options) => {
        if (new URL(url).pathname === "/api/agents") assert.equal(options.method, "GET");
        return new URL(url).pathname === "/api/agents" ? agentsResponse : healthy(url, options);
      };
      await verifyRelease({ baseUrl: "https://release.example.test", expectedSha: sha, fetchImpl, sleepImpl: async () => {} });
    });
  }

  const invalidResponses = [
    new Response(JSON.stringify({ detail: "Method Not Allowed" }), { status: 405, headers: { "content-type": "application/jsonp", allow: "POST" } }),
    response(403, JSON.stringify({ detail: "Forbidden" })),
    new Response(JSON.stringify({ detail: "Method Not Allowed" }), { status: 405, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ detail: "Method Not Allowed" }), { status: 405, headers: { "content-type": "application/json", allow: "GET, POST" } }),
    new Response(JSON.stringify({ detail: "Not allowed" }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } }),
    new Response("Method Not Allowed", { status: 405, headers: { allow: "POST", "content-type": "text/plain" } }),
    new Response(JSON.stringify({ detail: "Method Not Allowed", extra: true }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } }),
  ];
  for (const [index, agentsResponse] of invalidResponses.entries()) {
    await t.test(`invalid method contract ${index + 1}`, async () => {
      const { fetchImpl: healthy } = healthyFetch();
      const fetchImpl = async (url, options) => new URL(url).pathname === "/api/agents" ? agentsResponse : healthy(url, options);
      await assert.rejects(
        verifyRelease({ baseUrl: "https://release.example.test", expectedSha: sha, fetchImpl, sleepImpl: async () => {} }),
        /\/api\/agents/,
      );
    });
  }
});

test("release routes reject media-type lookalikes despite valid body content", async (t) => {
  for (const [route, contentType] of [["/", "text/htmlish"], ["/proposals/projects", "text/htmlish"], ["/api/proposals", "application/jsonp"]]) {
    await t.test(route, async () => {
      const { fetchImpl: healthy } = healthyFetch();
      await assert.rejects(verifyRelease({
        baseUrl: "https://release.example.test", expectedSha: sha, sleepImpl: async () => {},
        fetchImpl: async (url, options) => {
          const result = await healthy(url, options);
          if (new URL(url).pathname === route) result.headers.set("content-type", contentType);
          return result;
        },
      }));
    });
  }
});
