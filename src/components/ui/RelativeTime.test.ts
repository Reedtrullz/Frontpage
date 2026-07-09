import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RelativeTime, formatRelativeTime } from "./RelativeTime";

describe("RelativeTime", () => {
  const now = new Date("2026-07-09T19:12:00Z");

  it("formats a concise relative value", () => {
    expect(formatRelativeTime("2026-07-09T19:00:00Z", now)).toBe("12m ago");
  });

  it("keeps the exact time in semantic output", () => {
    const markup = renderToStaticMarkup(
      createElement(RelativeTime, {
        value: "2026-07-09T19:00:00Z",
        now,
      }),
    );
    expect(markup).toContain('dateTime="2026-07-09T19:00:00.000Z"');
    expect(markup).toContain("July 9, 2026 at 19:00 UTC");
    expect(markup).toContain("12m ago");
  });
});
