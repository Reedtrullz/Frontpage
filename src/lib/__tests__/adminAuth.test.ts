import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadAdminAuth() {
  return import("../adminAuth");
}

describe("admin authorization", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ADMIN_GITHUB_EMAIL;
    process.env.ADMIN_GITHUB_LOGIN = "Reedtrullz";
    process.env.ADMIN_GITHUB_ID = "12345";
  });

  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it("allows the configured immutable GitHub owner id", async () => {
    const { isOwnerSession } = await loadAdminAuth();
    expect(
      isOwnerSession({
        user: {
          githubId: "12345",
          githubLogin: "someone-renamed",
          email: "owner-id-with-untrusted-email@example.net",
        },
      }),
    ).toBe(true);
  });

  it("allows the configured GitHub owner login", async () => {
    const { isOwnerSession } = await loadAdminAuth();
    expect(
      isOwnerSession({
        user: {
          githubLogin: "Reedtrullz",
          email: "owner-login-with-untrusted-email@example.net",
        },
      }),
    ).toBe(true);
  });

  it("rejects authenticated non-owner sessions", async () => {
    const { isOwnerSession } = await loadAdminAuth();
    expect(
      isOwnerSession({
        user: {
          githubLogin: "someone-else",
          githubId: "999",
          email: "other@example.com",
        },
      }),
    ).toBe(false);
  });

  it("does not trust display name as GitHub login", async () => {
    const { isOwnerSession } = await loadAdminAuth();
    expect(isOwnerSession({ user: { name: "Reedtrullz", email: "other@example.com" } })).toBe(false);
  });

  it("rejects owner email unless email fallback is explicitly configured", async () => {
    const { isOwnerSession } = await loadAdminAuth();
    expect(isOwnerSession({ user: { email: "reed@example.com" } })).toBe(false);
  });

  it("can allow a configured owner email only when explicitly set", async () => {
    process.env.ADMIN_GITHUB_EMAIL = "reed@example.com";
    const { isOwnerSession } = await loadAdminAuth();
    expect(isOwnerSession({ user: { email: "reed@example.com" } })).toBe(true);
  });
});
