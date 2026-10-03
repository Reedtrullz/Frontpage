import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectsMock, pairsMock, statsMock } = vi.hoisted(() => ({
  projectsMock: vi.fn(),
  pairsMock: vi.fn(),
  statsMock: vi.fn(),
}));

vi.mock("@/lib/data", () => ({ getProjects: projectsMock }));
vi.mock("@/lib/github-stats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github-stats")>()),
  extractRepoPairs: pairsMock,
  fetchAllRepoStats: statsMock,
}));

import { GET } from "./route";

describe("GitHub stats API", () => {
  const project = { slug: "frontpage", repoUrl: "https://github.com/Reedtrullz/Frontpage", lifecycle: "active", maturity: "flagship" };

  beforeEach(() => {
    vi.clearAllMocks();
    projectsMock.mockReturnValue([project]);
    pairsMock.mockReturnValue([{ owner: "Reedtrullz", repo: "Frontpage", key: "reedtrullz/frontpage", slug: "frontpage" }]);
    statsMock.mockResolvedValue(new Map([["reedtrullz/frontpage", { status: "unavailable", stars: 0 }]]));
  });

  it("matches normalized keys and keeps content-owned project posture unchanged on optional stats failure", async () => {
    const before = { lifecycle: project.lifecycle, maturity: project.maturity };
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ frontpage: { status: "unavailable", stars: 0 } });
    expect(project).toMatchObject(before);
  });
});
