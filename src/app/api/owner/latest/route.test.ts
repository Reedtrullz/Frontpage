import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, ownerMock, rootMock, readLatestMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  ownerMock: vi.fn(),
  rootMock: vi.fn(),
  readLatestMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/authz", () => ({ isOwnerUser: ownerMock }));
vi.mock("@/lib/metrics/v2/reader", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/metrics/v2/reader")>();
  return { ...original, getOwnerMetricsRootV2: rootMock, readOwnerLatestV2: readLatestMock };
});

import { GET } from "./route";

const latest = { schema_version: 2, generated_at: "2026-07-12T18:59:45Z" };

describe("owner latest API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerMock.mockReturnValue(true);
    rootMock.mockReturnValue("/metrics-owner");
    readLatestMock.mockReturnValue({ availability: "available", data: latest, diagnostics: [] });
  });

  it.each([
    [null, 401],
    [{ user: { id: "not-owner" } }, 403],
  ])("denies access before owner I/O", async (session, status) => {
    authMock.mockResolvedValue(session);
    if (status === 403) ownerMock.mockReturnValue(false);
    const response = await GET(new Request("http://localhost/api/owner/latest"));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rootMock).not.toHaveBeenCalled();
    expect(readLatestMock).not.toHaveBeenCalled();
  });

  it("returns private no-store data and supports ETags", async () => {
    authMock.mockResolvedValue({ user: { id: "owner" } });
    const response = await GET(new Request("http://localhost/api/owner/latest"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual(latest);
    const etag = response.headers.get("etag")!;
    const unchanged = await GET(
      new Request("http://localhost/api/owner/latest", { headers: { "If-None-Match": etag } }),
    );
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("cache-control")).toBe("private, no-store");
  });
});
