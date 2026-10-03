import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  ownerMock,
  publicReadMock,
  publicIncidentsMock,
  ownerReadMock,
  seriesReadMock,
  publicRootMock,
  ownerRootMock,
  miningMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  ownerMock: vi.fn(),
  publicReadMock: vi.fn(),
  publicIncidentsMock: vi.fn(),
  ownerReadMock: vi.fn(),
  seriesReadMock: vi.fn(),
  publicRootMock: vi.fn(),
  ownerRootMock: vi.fn(),
  miningMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/authz", () => ({ isOwnerUser: ownerMock }));
vi.mock("@/lib/metrics/reader", () => ({
  getMetricsDir: () => undefined,
  readMetricsFromDir: () => ({}),
}));
vi.mock("@/lib/metrics/v2/reader", () => ({
  getPublicMetricsRootV2: publicRootMock,
  getOwnerMetricsRootV2: ownerRootMock,
  readPublicLatestV2: publicReadMock,
  readPublicIncidentsV2: publicIncidentsMock,
  readOwnerLatestV2: ownerReadMock,
  readSeriesV2: seriesReadMock,
}));
vi.mock("@/lib/metrics/status-page", () => ({
  createStatusPageModel: () => ({
    public: {
      freshness: "unavailable",
      host: {
        state: "unknown",
        diskPressure: "unknown",
        lastUpdatedAt: null,
        lastUpdatedLabel: "Unavailable",
        serviceSummary: { total: 0, up: 0, down: 0, unknown: 0 },
      },
      services: [],
      projectHealthBySlug: {},
      history: [],
      historyCoverage: {
        availability: "unavailable",
        windowStartAt: "2026-07-11T00:00:00Z",
        windowEndAt: "2026-07-12T00:00:00Z",
        sampleCount: 0,
        gapCount: 0,
        leadingGap: true,
        trailingGap: true,
      },
      serviceTrends: {},
      lastKnownServiceCount: null,
    },
    overall: { kind: "unavailable", label: "Status unavailable", description: "Unavailable" },
    owner: ownerMock() ? { freshness: "unavailable", latest: null, history: [], historyGapBefore: [], historyCoverage: {}, diagnostics: [] } : null,
    ownerAttention: ownerMock() ? [] : null,
  }),
}));
vi.mock("@/lib/metrics/v2/mining", () => ({ fetchMiningV2: miningMock }));
vi.mock("@/components/dashboard/VpsStatusSummary", () => ({ VpsStatusSummary: () => <div /> }));
vi.mock("@/components/dashboard/StatusInventory", () => ({ StatusInventory: () => <div /> }));
vi.mock("@/components/dashboard/CoarseHistoryStrip", () => ({ CoarseHistoryStrip: () => <div /> }));
vi.mock("@/components/dashboard/OwnerAttentionSummary", () => ({ OwnerAttentionSummary: () => <div /> }));
vi.mock("@/components/dashboard/OwnerMetricsPanel", () => ({ OwnerMetricsPanel: () => <div /> }));
vi.mock("@/components/dashboard/observability/OwnerObservabilityPanel", () => ({
  OwnerObservabilityPanel: () => <div>V2 owner panel</div>,
}));
vi.mock("@/components/ui/RelativeTime", () => ({ RelativeTime: () => <span /> }));

import StatusPage from "./page";

const ownerLatest = {
  schema_version: 2,
  generated_at: "2026-07-12T18:59:45Z",
  collected_at: "2026-07-12T18:59:45Z",
  freshness: "fresh",
  host: { totals: [], capabilities: [] },
  workloads: [],
  diagnostics: [],
  incidents: [],
};
const series = {
  schema_version: 2,
  generated_at: "2026-07-12T18:59:45Z",
  range: "1h",
  resolution_seconds: 15,
  view: "host",
  resource: null,
  timestamps: ["2026-07-12T18:59:45Z"],
  series: [{ id: "cpu-total", label: "CPU total", unit: "percent", values: [1] }],
  coverage_percent: 100,
  truncated: false,
};

describe("StatusPage v2 composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publicRootMock.mockReturnValue("/public");
    ownerRootMock.mockReturnValue("/owner");
    publicReadMock.mockReturnValue({ availability: "unavailable", data: null, diagnostics: [] });
    publicIncidentsMock.mockReturnValue({ availability: "unavailable", data: null, diagnostics: [] });
    ownerReadMock.mockReturnValue({ availability: "available", data: ownerLatest, diagnostics: [] });
    seriesReadMock.mockReturnValue(series);
    miningMock.mockResolvedValue({
      data: null,
      sourceSampleAt: null,
      observedAt: null,
      observationAgeMs: null,
      freshness: "unavailable",
    });
  });

  afterEach(() => delete process.env.FRONTPAGE_OBSERVABILITY_V2);

  it("reads public v2 but never resolves owner paths for anonymous sessions", async () => {
    process.env.FRONTPAGE_OBSERVABILITY_V2 = "1";
    authMock.mockResolvedValue(null);
    ownerMock.mockReturnValue(false);
    await StatusPage();
    expect(publicReadMock).toHaveBeenCalledWith("/public");
    expect(ownerRootMock).not.toHaveBeenCalled();
    expect(ownerReadMock).not.toHaveBeenCalled();
    expect(seriesReadMock).not.toHaveBeenCalled();
  });

  it("does not resolve owner paths when the feature flag is off", async () => {
    authMock.mockResolvedValue({ user: { id: "owner" } });
    ownerMock.mockReturnValue(true);
    await StatusPage();
    expect(ownerRootMock).not.toHaveBeenCalled();
  });

  it("renders the v2 panel only after owner and feature checks succeed", async () => {
    process.env.FRONTPAGE_OBSERVABILITY_V2 = "1";
    authMock.mockResolvedValue({ user: { id: "owner" } });
    ownerMock.mockReturnValue(true);
    const markup = renderToStaticMarkup(await StatusPage());
    expect(ownerReadMock).toHaveBeenCalledWith("/owner");
    expect(seriesReadMock).toHaveBeenCalled();
    expect(markup).toContain("V2 owner panel");
    expect(markup).toContain("data-observability-v2=\"available\"");
  });

  it("keeps the current public mining disclosure allowlisted and explains unknown sample time", async () => {
    authMock.mockResolvedValue(null);
    miningMock.mockResolvedValue({
      data: {
        hashrate: 1200,
        hashrate_avg_1h: 1100,
        accepted_shares: 12,
        last_share_at_ms: Date.parse("2026-10-03T13:58:00Z"),
        worker_name: "rig-main",
        uptime_seconds: 3600,
        worker_agent: "private-agent-build",
        paid: 912345,
        balance_unlocked: 812345,
        balance_locked: 712345,
        rejected_shares: 612345,
      },
      sourceSampleAt: null,
      observedAt: "2026-10-03T14:00:00.000Z",
      observationAgeMs: 20_000,
      freshness: "unknown",
    });

    const markup = renderToStaticMarkup(await StatusPage());
    expect(markup).toContain("Pool sample time unknown");
    expect(markup).toContain("rig-main");
    expect(markup).toContain("1.20 KH/s");
    for (const privateValue of ["private-agent-build", "912345", "812345", "712345", "612345"]) {
      expect(markup).not.toContain(privateValue);
    }
  });

  it("does not describe stale cached pool data as current mining activity", async () => {
    authMock.mockResolvedValue(null);
    miningMock.mockResolvedValue({
      data: {
        hashrate: 1200,
        hashrate_avg_1h: 1100,
        accepted_shares: 12,
        last_share_at_ms: Date.parse("2026-10-03T13:58:00Z"),
        worker_name: "rig-main",
        uptime_seconds: 3600,
      },
      sourceSampleAt: null,
      observedAt: "2026-10-03T13:00:00.000Z",
      observationAgeMs: 3_600_000,
      freshness: "stale",
    });

    const markup = renderToStaticMarkup(await StatusPage());
    expect(markup).toContain("Last-known mining stats");
    expect(markup).not.toContain("Mining PEARL");
  });
});
