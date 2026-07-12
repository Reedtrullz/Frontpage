import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicStatusV2Model } from "@/lib/metrics/v2/public-status";
import { PublicIncidentHistory } from "./PublicIncidentHistory";

const model: PublicStatusV2Model = {
  freshness: "fresh",
  collectedAt: "2026-07-12T19:00:00Z",
  overallState: "maintenance",
  label: "Maintenance",
  services: [],
  recentIncidents: [
    {
      id: "public-recovered",
      title: "Brief disruption recovered",
      summary: "A public check recovered after a brief disruption.",
      state: "recovered",
      severity: "warning",
      openedAt: "2026-07-12T17:00:00Z",
      updatedAt: "2026-07-12T17:05:00Z",
      resolvedAt: "2026-07-12T17:05:00Z",
    },
  ],
  maintenance: [
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
};

describe("PublicIncidentHistory", () => {
  it("renders an unframed public-safe event timeline", () => {
    const markup = renderToStaticMarkup(<PublicIncidentHistory model={model} />);
    expect(markup).toContain("Recent events");
    expect(markup).toContain("Brief disruption recovered");
    expect(markup).toContain("Planned maintenance");
    expect(markup).toContain("Recovered");
    for (const marker of ["workload", "evidence", "trigger_value", "frontpage-app", "PID"]) {
      expect(markup).not.toContain(marker);
    }
  });
});
