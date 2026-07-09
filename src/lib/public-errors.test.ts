import { describe, expect, it } from "vitest";
import { getPublicErrorCopy } from "./public-errors";

describe("public error copy", () => {
  it("never includes an internal exception message", () => {
    const secret = "database password and private host";
    const copy = getPublicErrorCopy("projects", new Error(secret));

    expect(JSON.stringify(copy)).not.toContain(secret);
    expect(copy.description).toMatch(/try again/i);
  });
});
