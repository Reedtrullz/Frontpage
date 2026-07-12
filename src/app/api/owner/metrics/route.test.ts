import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, ownerMock, rootMock, readSeriesMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  ownerMock: vi.fn(),
  rootMock: vi.fn(),
  readSeriesMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/authz", () => ({ isOwnerUser: ownerMock }));
vi.mock("@/lib/metrics/v2/reader", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/metrics/v2/reader")>();
  return {
    ...original,
    getOwnerMetricsRootV2: rootMock,
    readSeriesV2: readSeriesMock,
  };
});

import { ProjectionReadError } from "@/lib/metrics/v2/reader";
import { GET } from "./route";

const request = (query = "range=1h&view=host", etag?: string) =>
  new Request(`http://localhost/api/owner/metrics?${query}`, {
    headers: etag ? { "If-None-Match": etag } : undefined,
  });

const payload = {
  schema_version: 2,
  generated_at: "2026-07-12T18:59:45Z",
  range: "1h",
  resolution_seconds: 15,
  view: "host",
  resource: null,
  timestamps: ["2026-07-12T18:59:45Z"],
  series: [{ id: "cpu-total", label: "CPU total", unit: "percent", values: [20] }],
  coverage_percent: 100,
  truncated: false,
};

describe("owner metrics API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerMock.mockReturnValue(true);
    rootMock.mockReturnValue("/metrics-owner");
    readSeriesMock.mockReturnValue(payload);
  });

  it("returns 401 before resolving or reading owner files", async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(ownerMock).not.toHaveBeenCalled();
    expect(rootMock).not.toHaveBeenCalled();
    expect(readSeriesMock).not.toHaveBeenCalled();
  });

  it("returns 403 before resolving or reading owner files", async () => {
    authMock.mockResolvedValue({ user: { id: "not-owner" } });
    ownerMock.mockReturnValue(false);
    expect((await GET(request())).status).toBe(403);
    expect(ownerMock).toHaveBeenCalledWith({ id: "not-owner" });
    expect(rootMock).not.toHaveBeenCalled();
    expect(readSeriesMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid query values before owner file I/O", async () => {
    authMock.mockResolvedValue({ user: { id: "owner" } });
    expect((await GET(request("range=forever&view=host"))).status).toBe(400);
    expect(rootMock).not.toHaveBeenCalled();
    expect(readSeriesMock).not.toHaveBeenCalled();
  });

  it("sets exact private headers and returns 304 for a matching ETag", async () => {
    authMock.mockResolvedValue({ user: { id: "owner" } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const etag = response.headers.get("etag");
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);

    const unchanged = await GET(request("range=1h&view=host", etag!));
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("cache-control")).toBe("private, no-store");
    expect(await unchanged.text()).toBe("");
  });

  it("maps oversized responses to 413", async () => {
    authMock.mockResolvedValue({ user: { id: "owner" } });
    readSeriesMock.mockImplementation(() => {
      throw new ProjectionReadError("too_large", "Series projection exceeds 4 MiB.");
    });
    expect((await GET(request())).status).toBe(413);
  });
});
