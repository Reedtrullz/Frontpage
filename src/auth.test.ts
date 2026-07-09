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
    jwt: (args: {
      token: { sub?: string; githubId?: string };
      profile?: { id?: string | number };
    }) => { sub?: string; githubId?: string };
    session: (args: {
      session: { user?: { id?: string; email?: string } };
      token: { sub?: string; githubId?: string };
    }) => { user?: { id?: string; email?: string } };
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

  it("stores the GitHub profile id and copies it into the session user id", async () => {
    await import("./auth");

    const token = capturedConfig.callbacks.jwt({
      token: { sub: "92b8ba85-ffb5-42ec-8654-d79917036faf" },
      profile: { id: 2069259 },
    });

    const session = capturedConfig.callbacks.session({
      session: { user: { email: "owner@example.com" } },
      token,
    });

    expect(token.githubId).toBe("2069259");
    expect(session.user?.id).toBe("2069259");
  });

  it("falls back to the token subject when no GitHub profile id is available", async () => {
    await import("./auth");

    const session = capturedConfig.callbacks.session({
      session: { user: { email: "owner@example.com" } },
      token: { sub: "92b8ba85-ffb5-42ec-8654-d79917036faf" },
    });

    expect(session.user?.id).toBe("92b8ba85-ffb5-42ec-8654-d79917036faf");
  });
});
