import { describe, expect, it, vi } from "vitest";
import {
  markOwnerSessionExpired,
  ownerSessionExpired,
  subscribeOwnerSession,
} from "./owner-session";

describe("owner session expiry signal", () => {
  it("notifies the owner boundary once and remains expired for the page lifetime", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOwnerSession(listener);
    expect(ownerSessionExpired()).toBe(false);
    markOwnerSessionExpired();
    markOwnerSessionExpired();
    expect(ownerSessionExpired()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
