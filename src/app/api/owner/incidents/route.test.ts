import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, ownerMock, rootMock, readIncidentsMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  ownerMock: vi.fn(),
  rootMock: vi.fn(),
  readIncidentsMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/authz", () => ({ isOwnerUser: ownerMock }));
vi.mock("@/lib/metrics/v2/reader", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/metrics/v2/reader")>();
  return {
    ...original,
    getOwnerMetricsRootV2: rootMock,
    readOwnerIncidentsV2: readIncidentsMock,
  };
});

import { ProjectionReadError } from "@/lib/metrics/v2/reader";
import { GET } from "./route";

const payload = {
  schema_version: 2,
  generated_at: "2026-07-12T18:59:45Z",
  incidents: [],
};

describe("owner incidents API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerMock.mockReturnValue(true);
    rootMock.mockReturnValue("/metrics-owner");
    readIncidentsMock.mockReturnValue({ availability: "available", data: payload, diagnostics: [] });
  });

  it.each([
    [null, 401],
    [{ user: { id: "not-owner" } }, 403],
  ])("denies access before owner I/O", async (session, status) => {
    authMock.mockResolvedValue(session);
    if (status === 403) ownerMock.mockReturnValue(false);
    expect((await GET(new Request("http://localhost/api/owner/incidents"))).status).toBe(status);
    expect(rootMock).not.toHaveBeenCalled();
    expect(readIncidentsMock).not.toHaveBeenCalled();
  });

  it("returns strict private headers and supports ETags", async () => {
    authMock.mockResolvedValue({ user: { id: "owner" } });
    const response = await GET(new Request("http://localhost/api/owner/incidents"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const etag = response.headers.get("etag")!;
    const unchanged = await GET(
      new Request("http://localhost/api/owner/incidents", { headers: { "If-None-Match": etag } }),
    );
    expect(unchanged.status).toBe(304);
  });

  it("maps oversized incident projections to 413", async () => {
    authMock.mockResolvedValue({ user: { id: "owner" } });
    readIncidentsMock.mockImplementation(() => {
      throw new ProjectionReadError("too_large", "Incident projection exceeds 512 KiB.");
    });
    expect((await GET(new Request("http://localhost/api/owner/incidents"))).status).toBe(413);
  });
});
