import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.describe("application shell", () => {
  test("exposes identity, active navigation, and keyboard skip target", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: /Reidar/i }),
    ).toBeVisible();
    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(
      primary.getByRole("link", { name: "Projects", exact: true }),
    ).toBeVisible();
    await expect(primary.getByRole("link", { name: /^Status/ })).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    await page.goto("/projects/rfs");
    await expect(
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Projects", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.goto("/status");
    await expect(
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: /^Status/ }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("provides a usable mobile navigation menu", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");

    await page.getByRole("button", { name: "Open navigation" }).click();
    const mobile = page.getByRole("navigation", { name: "Mobile" });
    await expect(mobile).toBeVisible();
    await expect(
      mobile.getByRole("link", { name: "Projects" }),
    ).toBeVisible();
    await expect(mobile.getByRole("link", { name: /^Status/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("uses branded sign-in and not-found surfaces", async ({ page }) => {
    await page.goto("/signin?callbackUrl=/ansible");
    await expect(
      page.getByRole("heading", { name: "Owner sign in" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continue with GitHub/i }),
    ).toBeVisible();
    await expect(page.locator('input[name="callbackUrl"]')).toHaveValue(
      "/ansible",
    );

    await page.goto("/signin?callbackUrl=https://example.com/admin");
    await expect(page.locator('input[name="callbackUrl"]')).toHaveValue(
      "/admin",
    );

    await page.goto("/this-route-does-not-exist");
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Back home" })).toBeVisible();
  });

  test("fails closed on owner routes", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(
      /\/signin\?callbackUrl=%2Fadmin|\/signin\?callbackUrl=\/admin/,
    );
    await expect(
      page.getByRole("heading", { name: "Owner sign in" }),
    ).toBeVisible();

    await page.goto("/ansible");
    await expect(page).toHaveURL(
      /\/signin\?callbackUrl=%2Fansible|\/signin\?callbackUrl=\/ansible/,
    );
    await expect(
      page.getByRole("heading", { name: "Owner sign in" }),
    ).toBeVisible();
  });
});

test.describe("public project experience", () => {
  test("persists catalogue filters in the URL", async ({ page }) => {
    await page.goto("/projects");
    await expect(
      page.getByRole("heading", { name: "Published projects" }),
    ).toBeVisible();
    await expect(page.getByText("14 of 14 projects")).toBeVisible();

    await page.getByLabel("Maturity").selectOption("experimental");
    await expect(page).toHaveURL(/maturity=experimental/);
    await expect(page.getByText("5 of 14 projects")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "THORArb" }),
    ).toBeVisible();

    await page.goto("/projects");
    await expect(page.getByText("Media not published").first()).toBeVisible();
    await page.getByLabel("Health").selectOption("not-monitored");
    await expect(page).toHaveURL(/health=not-monitored/);
    await expect(page.getByText("9 of 14 projects")).toBeVisible();
  });

  test("shows real media, media-less evidence, and structured limits", async ({
    page,
  }) => {
    await page.goto("/projects/rfs");
    await expect(
      page.getByRole("heading", { level: 1, name: "RFS" }),
    ).toBeVisible();
    const image = page.getByRole("img", {
      name: /RFS flight simulator showing Trondheim/i,
    });
    await expect(image).toBeVisible();
    expect(
      await image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    await expect(
      page.getByRole("heading", { name: "Current limitations" }),
    ).toBeVisible();
    await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();

    for (const [slug, accessibleName] of [
      ["rfmc", /VirtualCDU training mission selector/i],
      ["heimdall", /Heimdall THORChain operations console/i],
    ] as const) {
      await page.goto(`/projects/${slug}`);
      const proofImage = page.getByRole("img", { name: accessibleName });
      await expect(proofImage).toBeVisible();
      expect(
        await proofImage.evaluate(
          (element) => (element as HTMLImageElement).naturalWidth,
        ),
      ).toBeGreaterThan(0);
    }

    await page.goto("/projects/nytt");
    await expect(
      page.getByRole("heading", { level: 1, name: "Nytt" }),
    ).toBeVisible();
    await expect(page.getByText(/coverage and certainty depend/i)).toBeVisible();

    await page.goto("/projects/thorarb");
    await expect(page.getByText("Not monitored", { exact: true }).first()).toBeVisible();
  });
});

test.describe("public status", () => {
  test("renders coarse history and leaks no owner fields", async ({ page }) => {
    await page.goto("/status");
    await expect(
      page.getByRole("heading", { level: 1, name: "System status" }),
    ).toBeVisible();
    await expect(page.getByText("Operational", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Coarse pressure history" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /CPU pressure over the available 24-hour window/i }),
    ).toBeVisible();
    await expect(page.getByText("Frontpage", { exact: true })).toBeVisible();

    const statusHtml = await page.content();
    await page.goto("/");
    const publicHtml = `${statusHtml}${await page.content()}`;
    for (const privateMarker of [
      "cpu_percent",
      "ram_used_bytes",
      "disk_used_bytes",
      "uptime_seconds",
      "frontpage-internal",
      "frontpage-container",
      "Collector diagnostics",
      "Owner status",
    ]) {
      expect(publicHtml).not.toContain(privateMarker);
    }
  });
});

test.describe("responsive and accessible public routes", () => {
  test("has no horizontal overflow across target routes and widths", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const routes = [
      "/",
      "/projects",
      "/projects/nytt",
      "/projects/rfs",
      "/status",
      "/signin",
      "/projects/not-a-published-project",
    ];
    const widths = [360, 390, 768, 1024, 1440];

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(route);
        await expectNoHorizontalOverflow(page);
      }
    }
  });

  test("passes axe on representative desktop and mobile routes", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    for (const route of ["/", "/projects", "/projects/rfs", "/status", "/signin"]) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(route);
      await expectNoSeriousAccessibilityViolations(page);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expectNoSeriousAccessibilityViolations(page);
  });
});
