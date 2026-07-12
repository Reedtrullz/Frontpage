import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectionReadError,
  getOwnerMetricsRootV2,
  getPublicMetricsRootV2,
  readOwnerIncidentsV2,
  readOwnerLatestV2,
  readPublicIncidentsV2,
  readPublicLatestV2,
  readSeriesV2,
} from "./reader";
import { parseOwnerMetricsQuery } from "./queries";

const fixtureRoot = path.resolve("ops/tests/fixtures/observability-v2");
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-v2-reader-"));
  temporaryRoots.push(root);
  return root;
}

function copyFixture(name: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(fixtureRoot, name), destination);
}

function seriesPayload(
  timestamps: string[],
  values: Array<number | null>,
  overrides: Record<string, unknown> = {},
) {
  return {
    schema_version: 2,
    generated_at: timestamps.at(-1),
    range: "24h",
    resolution_seconds: 60,
    view: "host",
    resource: null,
    timestamps,
    series: [{ id: "cpu-total", label: "CPU total", unit: "percent", values }],
    coverage_percent: 100,
    truncated: false,
    ...overrides,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  delete process.env.PUBLIC_METRICS_DIR;
  delete process.env.OWNER_METRICS_DIR;
});

describe("observability v2 roots and query parsing", () => {
  it("keeps public and owner roots independent", () => {
    process.env.PUBLIC_METRICS_DIR = "/metrics-public";
    process.env.OWNER_METRICS_DIR = "/metrics-owner";
    expect(getPublicMetricsRootV2()).toBe("/metrics-public");
    expect(getOwnerMetricsRootV2()).toBe("/metrics-owner");

    delete process.env.PUBLIC_METRICS_DIR;
    expect(getPublicMetricsRootV2()).toBeUndefined();
    expect(getOwnerMetricsRootV2()).toBe("/metrics-owner");
  });

  it("accepts closed query enums and requires resource for workloads", () => {
    expect(
      parseOwnerMetricsQuery(new URL("http://localhost/api/owner/metrics?range=1h&view=host")),
    ).toEqual({ range: "1h", view: "host", resource: null });
    expect(
      parseOwnerMetricsQuery(
        new URL("http://localhost/api/owner/metrics?range=7d&view=workloads&resource=ram"),
      ),
    ).toEqual({ range: "7d", view: "workloads", resource: "ram" });

    for (const query of [
      "range=2h&view=host",
      "range=1h&view=processes",
      "range=1h&view=workloads",
      "range=1h&view=host&resource=swap",
      "range=1h&view=host&extra=true",
      "range=1h&range=7d&view=host",
    ]) {
      expect(() => parseOwnerMetricsQuery(new URL(`http://localhost/?${query}`))).toThrow();
    }
  });
});

describe("observability v2 latest readers", () => {
  it("reads strict public, owner, and incident projections", () => {
    const publicRoot = temporaryRoot();
    const ownerRoot = temporaryRoot();
    copyFixture("public-latest.json", path.join(publicRoot, "latest.v2.json"));
    copyFixture("owner-latest.json", path.join(ownerRoot, "latest.v2.json"));
    copyFixture("incidents.json", path.join(ownerRoot, "incidents.v2.json"));

    const now = new Date("2026-07-12T19:00:00Z");
    expect(readPublicLatestV2(publicRoot, now).data?.schema_version).toBe(2);
    expect(readOwnerLatestV2(ownerRoot, now).data?.workloads).toHaveLength(2);
    expect(readOwnerIncidentsV2(ownerRoot, now).data?.incidents).toHaveLength(1);
  });

  it("returns explicit unavailable results for missing roots and files", () => {
    expect(readPublicLatestV2(undefined).availability).toBe("unavailable");
    expect(readOwnerLatestV2(temporaryRoot()).availability).toBe("unavailable");
  });

  it("fails closed for malformed, owner-shaped, and future public files", () => {
    const malformedRoot = temporaryRoot();
    fs.writeFileSync(path.join(malformedRoot, "latest.v2.json"), "{");
    expect(readPublicLatestV2(malformedRoot).availability).toBe("invalid");

    const ownerRoot = temporaryRoot();
    copyFixture("owner-latest.json", path.join(ownerRoot, "latest.v2.json"));
    expect(readPublicLatestV2(ownerRoot).availability).toBe("invalid");

    const futureRoot = temporaryRoot();
    const payload = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, "public-latest.json"), "utf8"),
    );
    payload.generated_at = "2026-07-12T20:00:00Z";
    payload.collected_at = "2026-07-12T20:00:00Z";
    fs.writeFileSync(path.join(futureRoot, "latest.v2.json"), JSON.stringify(payload));
    expect(readPublicLatestV2(futureRoot, new Date("2026-07-12T19:00:00Z")).availability).toBe(
      "invalid",
    );
  });

  it("relabels stale and unavailable latest samples from collection age", () => {
    const root = temporaryRoot();
    copyFixture("public-latest.json", path.join(root, "latest.v2.json"));
    expect(readPublicLatestV2(root, new Date("2026-07-12T19:00:30Z")).data?.freshness).toBe(
      "fresh",
    );
    expect(readPublicLatestV2(root, new Date("2026-07-12T19:00:30Z")).availability).toBe(
      "available",
    );
    expect(readPublicLatestV2(root, new Date("2026-07-12T19:00:31Z")).data?.freshness).toBe(
      "stale",
    );
    expect(readPublicLatestV2(root, new Date("2026-07-12T19:01:46Z")).data?.freshness).toBe(
      "unavailable",
    );

    const ownerRoot = temporaryRoot();
    copyFixture("owner-latest.json", path.join(ownerRoot, "latest.v2.json"));
    const currentPayload = JSON.parse(
      fs.readFileSync(path.join(ownerRoot, "latest.v2.json"), "utf8"),
    );
    currentPayload.host.totals.find(
      (total: { resource: string }) => total.resource === "network",
    ).freshness = "unavailable";
    fs.writeFileSync(
      path.join(ownerRoot, "latest.v2.json"),
      JSON.stringify(currentPayload),
    );
    const currentOwner = readOwnerLatestV2(
      ownerRoot,
      new Date("2026-07-12T19:00:30Z"),
    );
    expect(
      currentOwner.data?.host.totals.find((total) => total.resource === "network")
        ?.freshness,
    ).toBe("unavailable");
    const owner = readOwnerLatestV2(ownerRoot, new Date("2026-07-12T19:00:31Z"));
    expect(owner.data?.freshness).toBe("stale");
    expect(owner.data?.host.totals.every((total) => total.freshness === "stale")).toBe(true);
  });

  it("rejects symlinked projections and future incident evidence", () => {
    const symlinkRoot = temporaryRoot();
    const outsideRoot = temporaryRoot();
    copyFixture("public-latest.json", path.join(outsideRoot, "latest.v2.json"));
    fs.symlinkSync(path.join(outsideRoot, "latest.v2.json"), path.join(symlinkRoot, "latest.v2.json"));
    expect(readPublicLatestV2(symlinkRoot).availability).toBe("invalid");

    const incidentRoot = temporaryRoot();
    const payload = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "incidents.json"), "utf8"));
    payload.incidents[0].visibility = "owner";
    payload.incidents[0].evidence = {
      trigger_value: 1,
      threshold_value: 1,
      peak_value: 1,
      points: [{ recorded_at: "2026-07-12T18:05:00Z", value: 1 }],
    };
    payload.incidents[0].evidence.points[0].recorded_at = "2099-01-01T00:00:00Z";
    fs.writeFileSync(path.join(incidentRoot, "incidents.v2.json"), JSON.stringify(payload));
    expect(readOwnerIncidentsV2(incidentRoot, new Date("2026-07-12T19:00:00Z")).availability).toBe(
      "invalid",
    );

    const ownerRoot = temporaryRoot();
    const ownerPayload = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, "owner-latest.json"), "utf8"),
    );
    ownerPayload.incidents[0].updated_at = "2099-01-01T00:00:00Z";
    fs.writeFileSync(path.join(ownerRoot, "latest.v2.json"), JSON.stringify(ownerPayload));
    expect(readOwnerLatestV2(ownerRoot, new Date("2026-07-12T19:00:00Z")).availability).toBe(
      "invalid",
    );
  });

  it("rejects owner incidents from the public projection root", () => {
    const root = temporaryRoot();
    const payload = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "incidents.json"), "utf8"));
    payload.incidents[0].visibility = "owner";
    fs.writeFileSync(path.join(root, "incidents.v2.json"), JSON.stringify(payload));
    expect(readPublicIncidentsV2(root, new Date("2026-07-12T19:00:00Z")).availability).toBe(
      "invalid",
    );
  });
});

describe("observability v2 series reader", () => {
  it("merges daily chunks in timestamp order and de-duplicates overlap", () => {
    const root = temporaryRoot();
    const files = [
      "host/minute/2026-07-11.v2.json",
      "host/minute/2026-07-12.v2.json",
    ];
    fs.mkdirSync(path.join(root, "host/minute"), { recursive: true });
    fs.writeFileSync(
      path.join(root, files[0]),
      JSON.stringify(
        seriesPayload(
          ["2026-07-11T23:59:00Z", "2026-07-12T00:00:00Z"],
          [10, 20],
        ),
      ),
    );
    fs.writeFileSync(
      path.join(root, files[1]),
      JSON.stringify(
        seriesPayload(
          ["2026-07-12T00:00:00Z", "2026-07-12T00:01:00Z"],
          [21, 30],
        ),
      ),
    );
    fs.writeFileSync(
      path.join(root, "manifest.v2.json"),
      JSON.stringify({ schema_version: 2, files: [...files].reverse() }),
    );

    const result = readSeriesV2(root, { range: "24h", view: "host", resource: null });
    expect(result.timestamps).toEqual([
      "2026-07-11T23:59:00Z",
      "2026-07-12T00:00:00Z",
      "2026-07-12T00:01:00Z",
    ]);
    expect(result.series[0]?.values).toEqual([10, 21, 30]);
    expect(result.range).toBe("24h");
  });

  it("trims samples outside the requested time window even below the point cap", () => {
    const root = temporaryRoot();
    const file = "host/minute/2026-07-12.v2.json";
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(
      path.join(root, file),
      JSON.stringify(
        seriesPayload(
          ["2026-07-10T00:00:00Z", "2026-07-12T00:00:00Z"],
          [1, 2],
        ),
      ),
    );
    fs.writeFileSync(
      path.join(root, "manifest.v2.json"),
      JSON.stringify({ schema_version: 2, files: [file] }),
    );

    expect(
      readSeriesV2(root, { range: "24h", view: "host", resource: null }).timestamps,
    ).toEqual(["2026-07-12T00:00:00Z"]);
  });

  it("enforces the exact requested bucket cap", () => {
    const root = temporaryRoot();
    const file = "host/minute/2026-07-12.v2.json";
    const timestamps = Array.from({ length: 1440 }, (_, index) =>
      new Date(Date.UTC(2026, 6, 12, 0, index)).toISOString().replace(".000Z", "Z"),
    );
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(seriesPayload(timestamps, timestamps.map((_, i) => i))));
    fs.writeFileSync(path.join(root, "manifest.v2.json"), JSON.stringify({ schema_version: 2, files: [file] }));

    expect(
      readSeriesV2(
        root,
        { range: "24h", view: "host", resource: null },
        new Date("2026-07-13T00:00:00Z"),
      ).timestamps,
    ).toHaveLength(1440);
  });

  it("rejects traversal, non-manifest files, and future series timestamps", () => {
    const root = temporaryRoot();
    fs.writeFileSync(
      path.join(root, "manifest.v2.json"),
      JSON.stringify({ schema_version: 2, files: ["../private.sqlite3"] }),
    );
    expect(() => readSeriesV2(root, { range: "1h", view: "host", resource: null })).toThrow(
      ProjectionReadError,
    );

    fs.writeFileSync(
      path.join(root, "manifest.v2.json"),
      JSON.stringify({ schema_version: 2, files: ["host/other.v2.json"] }),
    );
    expect(() => readSeriesV2(root, { range: "1h", view: "host", resource: null })).toThrow(
      /allowlisted/i,
    );

    const file = "host/1h.v2.json";
    fs.mkdirSync(path.join(root, "host"), { recursive: true });
    const future = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "host-series-1h.json"), "utf8"));
    future.generated_at = "2099-01-01T00:00:00Z";
    future.timestamps = ["2099-01-01T00:00:00Z"];
    future.series[0].values = [1];
    fs.writeFileSync(path.join(root, file), JSON.stringify(future));
    fs.writeFileSync(path.join(root, "manifest.v2.json"), JSON.stringify({ schema_version: 2, files: [file] }));
    expect(() => readSeriesV2(root, { range: "1h", view: "host", resource: null })).toThrow(
      /future/i,
    );
  });

  it("selects workload history only from the requested resource subtree", () => {
    const root = temporaryRoot();
    const file = "workloads/ram/1h.v2.json";
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    const payload = seriesPayload(
      ["2026-07-12T18:59:45Z"],
      [1024],
      {
        generated_at: "2026-07-12T18:59:45Z",
        range: "1h",
        resolution_seconds: 15,
        view: "workloads",
        resource: "ram",
      },
    );
    fs.writeFileSync(path.join(root, file), JSON.stringify(payload));
    fs.writeFileSync(
      path.join(root, "manifest.v2.json"),
      JSON.stringify({ schema_version: 2, files: [file] }),
    );
    expect(
      readSeriesV2(
        root,
        { range: "1h", view: "workloads", resource: "ram" },
        new Date("2026-07-12T19:00:00Z"),
      ).resource,
    ).toBe("ram");
    expect(() =>
      readSeriesV2(root, { range: "1h", view: "workloads", resource: "cpu" }),
    ).toThrow(/unavailable/i);
  });
});
