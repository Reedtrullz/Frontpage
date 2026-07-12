import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { publicModel } = vi.hoisted(() => ({
  publicModel: {
    freshness: "fresh" as const,
    host: {
      state: "online" as const,
      diskPressure: "ok" as const,
      lastUpdatedAt: "2026-07-09T02:00:00Z",
      lastUpdatedLabel: "now",
      serviceSummary: { total: 0, up: 0, down: 0, unknown: 0 },
    },
    services: [],
    projectHealthBySlug: {},
    history: [
      {
        collectedAt: "2026-07-08T02:00:00Z",
        cpu: "low" as const,
        ram: "low" as const,
        disk: "ok" as const,
        gapBefore: false,
      },
      {
        collectedAt: "2026-07-08T14:00:00Z",
        cpu: "medium" as const,
        ram: "medium" as const,
        disk: "watch" as const,
        gapBefore: true,
      },
      {
        collectedAt: "2026-07-09T02:00:00Z",
        cpu: "high" as const,
        ram: "high" as const,
        disk: "critical" as const,
        gapBefore: false,
      },
    ],
    historyCoverage: {
      availability: "available" as const,
      windowStartAt: "2026-07-08T02:00:00Z",
      windowEndAt: "2026-07-09T02:00:00Z",
      sampleCount: 3,
      gapCount: 1,
    },
    serviceTrends: {},
    lastKnownServiceCount: 0,
  },
}));

vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/authz", () => ({ isOwnerUser: () => false }));
vi.mock("@/lib/metrics/reader", () => ({
  getMetricsDir: () => undefined,
  readMetricsFromDir: () => ({}) as never,
}));
vi.mock("@/lib/metrics/status-page", () => ({
  createStatusPageModel: () => ({
    public: publicModel,
    overall: {
      kind: "operational",
      label: "Operational",
      description: "All configured public service checks report up.",
    },
    owner: null,
    ownerAttention: null,
  }),
}));

import StatusPage from "./page";

describe("StatusPage history wiring", () => {
  it("passes normalized timestamps and coverage to every public pressure strip", async () => {
    const markup = renderToStaticMarkup(await StatusPage());

    expect(markup).toContain("24h ago");
    expect(markup).toContain("12h ago");
    expect(markup).toContain(">now<");
    for (const [label, value] of [["CPU pressure", "Medium"], ["RAM pressure", "Medium"], ["Disk pressure", "Watch"]]) {
      expect(markup).toContain(`${label}: ${value} from July 8, 2026 at 14:00 UTC. Coverage missing before this sample`);
    }
    expect(markup.match(/1 gap in coverage/g)).toHaveLength(3);
  });
});
