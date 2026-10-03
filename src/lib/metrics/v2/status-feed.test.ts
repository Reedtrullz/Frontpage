import { describe, expect, it } from "vitest";
import type { PublicStatusV2Model } from "./public-status";
import { createPublicStatusFeed } from "./status-feed";

function model(overrides: Partial<PublicStatusV2Model> = {}): PublicStatusV2Model {
  return {
    freshness: "fresh",
    collectedAt: "2026-10-03T11:59:00Z",
    overallState: "operational",
    label: "Operational",
    services: [],
    recentIncidents: [],
    maintenance: [],
    ...overrides,
  };
}

describe("public status JSON Feed", () => {
  it("uses stable event identities, real incident update times and deduplicates IDs", () => {
    const incident = {
      id: "public-network-down",
      title: "Network recovered",
      summary: "A public check recovered.",
      state: "recovered" as const,
      severity: "warning" as const,
      openedAt: "2026-10-03T11:30:00Z",
      updatedAt: "2026-10-03T11:45:00Z",
      resolvedAt: "2026-10-03T11:45:00Z",
    };
    const first = createPublicStatusFeed(model({ recentIncidents: [incident] }));
    const changed = createPublicStatusFeed(model({ recentIncidents: [{ ...incident, summary: "Updated summary" }] }));
    expect(first.items[0]?.id).toBe("urn:reidar.tech:status:incident:public-network-down");
    expect(first.items[0]?.id).toBe(changed.items[0]?.id);
    expect(first.items[0]?.date_published).toBe(incident.openedAt);
    expect(first.items[0]?.date_modified).toBe(incident.updatedAt);
    expect(createPublicStatusFeed(model({ recentIncidents: [incident, incident] })).items).toHaveLength(1);
    expect(first._frontpage).toMatchObject({ collected_at: "2026-10-03T11:59:00Z" });
  });

  it("publishes canonical maintenance with a stable start time and no invented update time", () => {
    const feed = createPublicStatusFeed(model({
      maintenance: [{
        id: "planned-frontpage",
        title: "Planned maintenance",
        description: "A short public service maintenance window.",
        affectedServiceIds: ["frontpage-public"],
        startsAt: "2026-10-04T01:00:00Z",
        endsAt: "2026-10-04T02:00:00Z",
        status: "planned",
      }],
    }));
    expect(feed.items[0]).toMatchObject({
      id: "urn:reidar.tech:status:maintenance:planned-frontpage",
      date_published: "2026-10-04T01:00:00Z",
      tags: ["maintenance", "planned"],
    });
    expect(feed.items[0]).not.toHaveProperty("date_modified");
  });

  it("caps the feed at 256 public summaries", () => {
    const incidents = Array.from({ length: 300 }, (_, index) => ({
      id: `public-event-${String(index).padStart(3, "0")}`,
      title: `Event ${index}`,
      summary: "Public summary.",
      state: "recovered" as const,
      severity: "warning" as const,
      openedAt: "2026-10-01T00:00:00Z",
      updatedAt: new Date(Date.parse("2026-10-01T00:00:00Z") + index * 1000).toISOString(),
      resolvedAt: "2026-10-01T00:00:00Z",
    }));
    const feed = createPublicStatusFeed(model({ recentIncidents: incidents }));
    expect(feed.items).toHaveLength(256);
    expect(feed._frontpage.event_count).toBe(256);
  });

  it("marks actual zero-event feeds available and separates unavailable feeds", () => {
    const empty = createPublicStatusFeed(model());
    expect(empty.items).toEqual([]);
    expect(empty._frontpage).toMatchObject({ availability: "available", event_count: 0, freshness: "fresh" });
    const unavailable = createPublicStatusFeed(model(), { availability: "unavailable", checkedAt: "2026-10-03T12:00:00Z" });
    expect(unavailable.items).toEqual([]);
    expect(unavailable._frontpage.availability).toBe("unavailable");
  });
});
