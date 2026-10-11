#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { readBoundedBody, ReleaseVerificationError } from "./verify-release.mjs";

const FULL_SHA = /^[a-f0-9]{40}$/;
const observed = (value, valid) => value === undefined ? "missing" : valid(value) ? value : "invalid";

export async function verifyWorkerCommit({ expectedSha, fetchImpl = fetch, sleep = delay, log = record => console.log(JSON.stringify(record)) }) {
  if (typeof expectedSha !== "string" || !FULL_SHA.test(expectedSha)) throw new Error("Expected identity must be a full commit SHA");
  for (let attempt = 1; attempt <= 90; attempt++) {
    const started = performance.now(), controller = new AbortController();
    let phase = "transport", httpStatus = null, status = "missing", sha = "missing", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 5000);
    try {
      const response = await fetchImpl("https://frontpage.reidjoss.workers.dev/api/health", { redirect: "manual", signal: controller.signal });
      httpStatus = response.status;
      if (httpStatus !== 200) phase = "http-status";
      else {
        phase = "body";
        const body = await readBoundedBody(response);
        phase = "invalid-json";
        const health = JSON.parse(body);
        status = observed(health?.status, value => ["healthy", "unhealthy"].includes(value));
        sha = observed(health?.version, value => typeof value === "string" && FULL_SHA.test(value));
        phase = status === "healthy" && sha === expectedSha ? "accepted" : "identity-mismatch";
      }
    } catch (error) {
      if (timedOut) phase = "request-timeout";
      else if (error instanceof ReleaseVerificationError) phase = "response-too-large";
      else if (phase === "body") phase = "body-read-failed";
      else if (phase !== "invalid-json") phase = "transport";
    } finally {
      clearTimeout(timer); controller.abort();
    }
    log({ attempt, elapsed_ms: Math.round(performance.now() - started), http_status: httpStatus, observed_status: status, observed_sha: sha, phase });
    if (phase === "accepted") return { expectedSha, attempts: attempt };
    await sleep(2000);
  }
  throw new Error("Worker did not report healthy exact identity after 90 bounded attempts");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--expected-sha") throw new Error("Invalid probe arguments");
    await verifyWorkerCommit({ expectedSha: process.argv[3] });
  } catch {
    console.error("Worker commit verification failed"); process.exitCode = 1;
  }
}
