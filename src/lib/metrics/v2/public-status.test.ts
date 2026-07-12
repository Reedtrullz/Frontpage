import { describe, expect, it } from "vitest";
import { parseMaintenanceWindows } from "@/lib/content/schema";
import { parseIncidentListV2, parsePublicLatestV2 } from "./schema";
import { createPublicStatusV2 } from "./public-status";

const now = new Date("2026-07-12T19:00:00Z");
const latest = parsePublicLatestV2({
  schema_version: 2,
  generated_at: "2026-07-12T18:59:45Z",
  collected_at: "2026-07-12T18:59:45Z",
  freshness: "fresh",
  overall_state: "operational",
  resources: [{ resource: "cpu", label: "CPU", state: "healthy", coverage_percent: 100 }],
  services: [
    { id: "frontpage-public", label: "Frontpage", status: "up", checked_at: "2026-07-12T18:59:45Z", latency_ms: 20, availability_percent: 100, coverage_percent: 100 },
    { id: "nytt-public", label: "Nytt", status: "down", checked_at: "2026-07-12T18:59:45Z", latency_ms: null, availability_percent: 99, coverage_percent: 100 },
  ],
});
const incidents = parseIncidentListV2({
  schema_version: 2,
  generated_at: "2026-07-12T18:59:45Z",
  incidents: [
    {
      id: "public-recovered",
      rule_id: "public-service-failure",
      title: "Brief disruption recovered",
      severity: "warning",
      state: "recovered",
      visibility: "public",
      resource: "network",
      opened_at: "2026-07-12T17:00:00Z",
      updated_at: "2026-07-12T17:05:00Z",
      resolved_at: "2026-07-12T17:05:00Z",
      coverage_percent: 100,
      capability_state: "available",
      summary: "A public check recovered after a brief disruption.",
    },
  ],
});

describe("public observability status", () => {
  it("validates ranges, known services, unique ids, and overlapping service windows", () => {
    const valid = {
      id: "planned-frontpage",
      title: "Planned maintenance",
      description: "A bounded public maintenance window.",
      affectedServiceIds: ["frontpage-public"],
      startsAt: "2026-07-12T18:30:00Z",
      endsAt: "2026-07-12T19:30:00Z",
      status: "active",
    };
    expect(parseMaintenanceWindows([valid], new Set(["frontpage-public"]))).toHaveLength(1);
    expect(() => parseMaintenanceWindows([{ ...valid, endsAt: valid.startsAt }], new Set(["frontpage-public"]))).toThrow(/after/i);
    expect(() => parseMaintenanceWindows([{ ...valid, affectedServiceIds: ["unknown-public"] }], new Set(["frontpage-public"]))).toThrow(/unknown/i);
    expect(() => parseMaintenanceWindows([valid, { ...valid }], new Set(["frontpage-public"]))).toThrow(/duplicate/i);
    expect(() =>
      parseMaintenanceWindows(
        [valid, { ...valid, id: "overlap", startsAt: "2026-07-12T19:00:00Z", endsAt: "2026-07-12T20:00:00Z" }],
        new Set(["frontpage-public"]),
      ),
    ).toThrow(/overlap/i);
  });

  it("gives unexpected failures precedence over expected maintenance", () => {
    const maintenance = parseMaintenanceWindows(
      [
        {
          id: "planned-frontpage",
          title: "Planned maintenance",
          description: "A bounded public maintenance window.",
          affectedServiceIds: ["frontpage-public"],
          startsAt: "2026-07-12T18:30:00Z",
          endsAt: "2026-07-12T19:30:00Z",
          status: "active",
        },
      ],
      new Set(["frontpage-public", "nytt-public"]),
    );
    const model = createPublicStatusV2({ latest, incidents, maintenance, now });
    expect(model.services.find((service) => service.id === "frontpage-public")?.status).toBe("maintenance");
    expect(model.services.find((service) => service.id === "nytt-public")?.status).toBe("down");
    expect(model.overallState).toBe("disruption");
  });

  it("shows maintenance when all failures are expected and retains recovered incidents", () => {
    const maintenance = parseMaintenanceWindows(
      [
        {
          id: "planned-nytt",
          title: "Planned maintenance",
          description: "A bounded public maintenance window.",
          affectedServiceIds: ["nytt-public"],
          startsAt: "2026-07-12T18:30:00Z",
          endsAt: "2026-07-12T19:30:00Z",
          status: "active",
        },
      ],
      new Set(["frontpage-public", "nytt-public"]),
    );
    const model = createPublicStatusV2({ latest, incidents, maintenance, now });
    expect(model.overallState).toBe("maintenance");
    expect(model.recentIncidents[0]?.state).toBe("recovered");
  });

  it("never claims current state from stale telemetry", () => {
    const model = createPublicStatusV2({
      latest: { ...latest, freshness: "stale" },
      incidents,
      maintenance: [],
      now,
    });
    expect(model.overallState).toBe("unknown");
    expect(model.label).toBe("Status delayed");
  });

  it("rejects owner evidence before creating a public model", () => {
    expect(() =>
      parseIncidentListV2({
        ...incidents,
        incidents: [
          {
            ...incidents.incidents[0],
            visibility: "owner",
            workload_id: "frontpage-app",
            evidence: { trigger_value: 1, threshold_value: 1, peak_value: 1, points: [] },
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      createPublicStatusV2({
        latest,
        incidents: parseIncidentListV2({
          ...incidents,
          incidents: [{ ...incidents.incidents[0], visibility: "owner" }],
        }),
        maintenance: [],
        now,
      }),
    ).toThrow(/owner/i);
  });
});
