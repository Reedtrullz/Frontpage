import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, ownerMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  ownerMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/authz", () => ({ isOwnerUser: ownerMock }));

import { DELETE as deletePersonal, PUT as putPersonal } from "./personal/route";
import { DELETE as deleteProjects, PUT as putProjects } from "./projects/route";
import { POST as publish } from "./publish/route";

const handlers = [
  {
    name: "personal PUT",
    run: () => putPersonal(new Request("http://localhost/api/data/personal", { body: "{}", method: "PUT" })),
  },
  { name: "personal DELETE", run: () => deletePersonal() },
  {
    name: "projects PUT",
    run: () => putProjects(new Request("http://localhost/api/data/projects", { body: "[]", method: "PUT" })),
  },
  { name: "projects DELETE", run: () => deleteProjects() },
  { name: "publish POST", run: () => publish() },
];

describe("protected content routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerMock.mockReturnValue(false);
  });

  for (const handler of handlers) {
    it(`${handler.name} returns 401 for anonymous users`, async () => {
      authMock.mockResolvedValue(null);

      const response = await handler.run();

      expect(response.status).toBe(401);
    });

    it(`${handler.name} returns 403 for signed-in non-owners`, async () => {
      authMock.mockResolvedValue({ user: { id: "not-owner" } });

      const response = await handler.run();

      expect(response.status).toBe(403);
      expect(ownerMock).toHaveBeenCalledWith({ id: "not-owner" });
    });
  }
});
