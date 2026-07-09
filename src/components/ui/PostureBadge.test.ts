import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PostureBadge } from "./PostureBadge";

describe("PostureBadge", () => {
  it("renders explicit lifecycle and maturity labels", () => {
    expect(
      renderToStaticMarkup(
        createElement(PostureBadge, {
          dimension: "lifecycle",
          value: "maintained",
        }),
      ),
    ).toContain("Maintained");
    expect(
      renderToStaticMarkup(
        createElement(PostureBadge, {
          dimension: "maturity",
          value: "experimental",
        }),
      ),
    ).toContain("Experimental");
  });

  it("uses explicit text for unmonitored health", () => {
    const markup = renderToStaticMarkup(
      createElement(PostureBadge, {
        dimension: "health",
        value: "not-monitored",
      }),
    );
    expect(markup).toContain("Not monitored");
    expect(markup).toContain("aria-hidden=\"true\"");
  });
});
