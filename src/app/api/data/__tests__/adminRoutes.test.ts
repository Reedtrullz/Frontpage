import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  savePersonal: vi.fn(),
  saveProjects: vi.fn(),
  syncToGithub: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/data", () => ({
  savePersonal: mocks.savePersonal,
  saveProjects: mocks.saveProjects,
}));

vi.mock("@/lib/github", () => ({
  syncToGithub: mocks.syncToGithub,
}));

const ORIGINAL_ENV = { ...process.env };

type RouteKind = "personal" | "projects";

type RouteModule = {
  PUT(req: Request): Promise<Response>;
};

const routeCases: Array<{
  kind: RouteKind;
  payload: unknown;
  saveMock: typeof mocks.savePersonal;
  blockedSaveMock: typeof mocks.saveProjects;
  expectedPath: string;
}> = [
  {
    kind: "personal",
    payload: { name: "Reidar", title: "Builder" },
    saveMock: mocks.savePersonal,
    blockedSaveMock: mocks.saveProjects,
    expectedPath: "public/data/personal.json",
  },
  {
    kind: "projects",
    payload: [{ slug: "nytt", name: "Nytt" }],
    saveMock: mocks.saveProjects,
    blockedSaveMock: mocks.savePersonal,
    expectedPath: "public/data/projects.json",
  },
];

function makePutRequest(payload: unknown): Request {
  return new Request("http://localhost/api/data", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function importRoute(kind: RouteKind): Promise<RouteModule> {
  if (kind === "personal") return import("../personal/route");
  return import("../projects/route");
}

describe.each(routeCases)("$kind data route owner authorization", ({
  kind,
  payload,
  saveMock,
  blockedSaveMock,
  expectedPath,
}) => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ADMIN_GITHUB_EMAIL;
    process.env.ADMIN_GITHUB_LOGIN = "Reedtrullz";
    process.env.ADMIN_GITHUB_ID = "12345";
    mocks.syncToGithub.mockResolvedValue({ committed: true });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 401 without a session", async () => {
    mocks.auth.mockResolvedValue(null);
    const route = await importRoute(kind);

    const response = await route.PUT(makePutRequest(payload));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(saveMock).not.toHaveBeenCalled();
    expect(blockedSaveMock).not.toHaveBeenCalled();
    expect(mocks.syncToGithub).not.toHaveBeenCalled();
  });

  it("returns 403 for authenticated non-owners without writing data", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        githubId: "999",
        githubLogin: "someone-else",
        email: "other@example.com",
      },
    });
    const route = await importRoute(kind);

    const response = await route.PUT(makePutRequest(payload));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(saveMock).not.toHaveBeenCalled();
    expect(blockedSaveMock).not.toHaveBeenCalled();
    expect(mocks.syncToGithub).not.toHaveBeenCalled();
  });

  it("lets the configured owner write data and sync the expected payload", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        githubId: "12345",
        githubLogin: "someone-renamed",
        email: "untrusted-email@example.net",
      },
    });
    const route = await importRoute(kind);

    const response = await route.PUT(makePutRequest(payload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, synced: { committed: true } });
    expect(saveMock).toHaveBeenCalledWith(payload);
    expect(blockedSaveMock).not.toHaveBeenCalled();
    expect(mocks.syncToGithub).toHaveBeenCalledWith([
      {
        path: expectedPath,
        content: JSON.stringify(payload, null, 2),
      },
    ]);
  });
});
