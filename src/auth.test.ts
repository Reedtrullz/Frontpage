import { beforeEach, describe, expect, it, vi } from "vitest";

const nextAuthMock = vi.fn();
const githubProviderMock = vi.fn(() => ({
  id: "github",
  name: "GitHub",
  type: "oauth",
}));
const isOwnerUserMock = vi.fn();
let capturedConfig: {
  callbacks: {
    authorized: (args: { auth: { user?: { id?: string; email?: string } } | null }) => boolean;
  };
};

vi.mock("next-auth", () => ({
  default: nextAuthMock,
}));

vi.mock("next-auth/providers/github", () => ({
  default: githubProviderMock,
}));

vi.mock("@/lib/authz", () => ({
  isOwnerUser: isOwnerUserMock,
}));

describe("auth authorized callback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    nextAuthMock.mockImplementation((config) => {
      capturedConfig = config;

      return {
        handlers: {},
        signIn: vi.fn(),
        signOut: vi.fn(),
        auth: vi.fn(),
      };
    });
  });

  it("returns false for missing users", async () => {
    await import("./auth");
    const result = capturedConfig.callbacks.authorized({ auth: null });

    expect(result).toBe(false);
    expect(isOwnerUserMock).not.toHaveBeenCalled();
  });

  it("delegates signed-in owner checks to isOwnerUser", async () => {
    isOwnerUserMock.mockReturnValue(true);

    await import("./auth");
    const user = { id: "12345", email: "owner@example.com" };
    const result = capturedConfig.callbacks.authorized({
      auth: { user },
    });

    expect(isOwnerUserMock).toHaveBeenCalledWith(user);
    expect(result).toBe(true);
  });
});
