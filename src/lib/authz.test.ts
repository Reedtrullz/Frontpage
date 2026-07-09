import { describe, expect, it } from "vitest";
import { isOwnerUser, requireOwnerUser } from "./authz";

describe("isOwnerUser", () => {
  it("accepts the configured immutable GitHub id", () => {
    expect(
      isOwnerUser(
        { id: "12345", email: "other@example.com" },
        { OWNER_GITHUB_ID: "12345", OWNER_EMAIL: "owner@example.com" },
      ),
    ).toBe(true);
  });

  it("accepts the configured owner email when id is absent", () => {
    expect(
      isOwnerUser(
        { id: null, email: "owner@example.com" },
        { OWNER_GITHUB_ID: "12345", OWNER_EMAIL: "owner@example.com" },
      ),
    ).toBe(true);
  });

  it("rejects missing users and non-owners", () => {
    expect(isOwnerUser(null, { OWNER_GITHUB_ID: "12345" })).toBe(false);
    expect(
      isOwnerUser(
        { id: "999", email: "other@example.com" },
        { OWNER_GITHUB_ID: "12345", OWNER_EMAIL: "owner@example.com" },
      ),
    ).toBe(false);
  });

  it("throws a stable forbidden error from requireOwnerUser", () => {
    expect(() =>
      requireOwnerUser(
        { id: "999", email: "other@example.com" },
        {
          OWNER_GITHUB_ID: "12345",
        },
      ),
    ).toThrow("Forbidden");
  });
});
