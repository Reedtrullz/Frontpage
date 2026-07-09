import { describe, expect, it } from "vitest";
import { ownerCallbackPath } from "./owner-navigation";

describe("ownerCallbackPath", () => {
  it.each([
    [undefined, "/admin"],
    ["/admin", "/admin"],
    ["/admin/projects/rfs", "/admin/projects/rfs"],
    ["/ansible", "/ansible"],
  ])("maps %s to %s", (value, expected) => {
    expect(ownerCallbackPath(value)).toBe(expected);
  });

  it.each([
    "https://example.com/admin",
    "//example.com/admin",
    "/\\example.com/admin",
    "/admin/../../public",
    "/status",
  ])("rejects unsafe or public redirect target %s", (value) => {
    expect(ownerCallbackPath(value)).toBe("/admin");
  });
});
