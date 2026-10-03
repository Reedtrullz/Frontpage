import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rootMock, latestMock, incidentsMock, maintenanceMock } = vi.hoisted(() => ({
  rootMock: vi.fn(),
  latestMock: vi.fn(),
  incidentsMock: vi.fn(),
  maintenanceMock: vi.fn(),
}));

vi.mock("@/lib/metrics/v2/reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/metrics/v2/reader")>()),
  getPublicMetricsRootV2: rootMock,
  readPublicLatestV2: latestMock,
  readPublicIncidentsV2: incidentsMock,
}));
vi.mock("@/lib/content", () => ({ getCanonicalMaintenance: maintenanceMock }));

import { GET } from "./route";

const fixtureRoot = path.resolve("ops/tests/fixtures/observability-v2");
const latest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "public-latest.json"), "utf8"));
const incidentsFixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "incidents.json"), "utf8"));

describe("public status feed route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rootMock.mockReturnValue("/metrics-public");
    latestMock.mockReturnValue({ availability: "available", data: latest, diagnostics: [] });
    incidentsMock.mockReturnValue({ availability: "available", data: incidentsFixture, diagnostics: [] });
    maintenanceMock.mockReturnValue([]);
  });

  it("returns an anonymous feed with plain-text summaries and no owner/evidence/host fields", async () => {
    const incident = {
      ...incidentsFixture.incidents[0],
      title: `Recovered <b>public</b> \"quoted\" incident`,
      workload_id: "private-workload-id-never-publish",
      evidence: { trigger_value: 987654321, private_marker: "private-evidence-never-publish", points: [] },
    };
    incidentsMock.mockReturnValue({
      availability: "available",
      data: { ...incidentsFixture, incidents: [incident] },
      diagnostics: [],
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/feed+json");
    const bodyText = await response.text();
    expect(bodyText).toContain("\\\"quoted\\\"");
    expect(bodyText).toContain("\\u003cb\\u003e");
    expect(bodyText).not.toContain("<b>");
    const feed = JSON.parse(bodyText);
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed._frontpage).toMatchObject({ availability: "available", freshness: "fresh" });
    expect(feed._frontpage.incident_generated_at).toBe(incidentsFixture.generated_at);
    expect(feed.items[0]).toMatchObject({
      id: `urn:reidar.tech:status:incident:${incident.id}`,
      title: incident.title,
      date_published: incident.opened_at,
      date_modified: incident.updated_at,
    });
    expect(feed.items[0]).not.toHaveProperty("content_html");
    expect(bodyText).not.toContain("private-workload-id-never-publish");
    expect(bodyText).not.toContain("private-evidence-never-publish");
    expect(bodyText).not.toContain("987654321");
    expect(bodyText).not.toContain("host");
  });

  it("returns an actual available zero-event feed distinctly from unavailable sources", async () => {
    incidentsMock.mockReturnValue({ availability: "available", data: { schema_version: 2, generated_at: "2026-10-03T11:59:00Z", incidents: [] }, diagnostics: [] });
    const emptyResponse = await GET();
    expect(emptyResponse.status).toBe(200);
    expect((await emptyResponse.json())._frontpage).toMatchObject({ availability: "available", event_count: 0 });

    latestMock.mockReturnValue({ availability: "unavailable", data: null, diagnostics: ["missing"] });
    const missingResponse = await GET();
    expect(missingResponse.status).toBe(503);
    expect((await missingResponse.json())._frontpage).toMatchObject({ availability: "unavailable", freshness: "unavailable" });
  });

  it("fails closed when the public projection contains an owner incident", async () => {
    incidentsMock.mockReturnValue({
      availability: "invalid",
      data: null,
      diagnostics: ["owner incident"],
    });
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).items).toEqual([]);
  });

  it("returns a feed-shaped unavailable response when the public runtime source throws", async () => {
    rootMock.mockImplementation(() => { throw new Error("private binding detail"); });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bodyText = await response.text();
    expect(bodyText).not.toContain("private binding detail");
    expect(JSON.parse(bodyText)._frontpage).toMatchObject({ availability: "unavailable", overall_state: "unknown" });
  });
});
