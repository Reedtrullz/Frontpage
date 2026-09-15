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
    await expect(page.getByRole("heading", { name: "Current work" })).toBeVisible();
    await expect(page.getByText("No approved media")).toHaveCount(0);
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
  test("bounds current work on the homepage and links to the matching catalogue filter", async ({
    page,
  }) => {
    await page.goto("/");
    const currentWork = page.getByRole("region", { name: "Current work" });
    await expect(currentWork).toBeVisible();
    await expect(currentWork.getByText("Showing 6 of 21 projects")).toBeVisible();
    expect(await currentWork.locator('a[href^="/projects/"]').count()).toBe(6);
    await expect(
      currentWork.getByRole("link", { name: "View all current work" }),
    ).toHaveAttribute("href", "/projects?lifecycle=current");
  });

  test("persists catalogue filters in the URL", async ({ page }) => {
    await page.goto("/projects");
    await expect(
      page.getByRole("heading", { name: "Published projects" }),
    ).toBeVisible();
    await expect(page.getByText("24 projects · 5 repositories")).toBeVisible();

    await page.getByLabel("Maturity").selectOption("experimental");
    await expect(page).toHaveURL(/maturity=experimental/);
    await expect(page.getByText("10 projects · 0 repositories")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "THORArb" }),
    ).toBeVisible();

    await page.goto("/projects");
    await expect(page.getByText("Media not published")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Other public repositories" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "View repository" })).toHaveCount(5);
    await page.getByLabel("Health").selectOption("not-monitored");
    await expect(page).toHaveURL(/health=not-monitored/);
    await expect(page.getByText("18 projects · 0 repositories")).toBeVisible();
  });

  test("searches project and repository records together and resets cleanly", async ({
    page,
  }) => {
    await page.goto("/projects?q=homebrew");
    await expect(page.getByText("0 projects · 1 repositories")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Homebrew Cask" }),
    ).toBeVisible();
    await expect(page.getByText("Fork", { exact: true })).toBeVisible();
    await expect(page.getByText("Upstream: Homebrew/homebrew-cask")).toBeVisible();

    await page.goto("/projects?q=bunker");
    await expect(page.getByText("1 projects · 0 repositories")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Bunkerkartet" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "View repository" })).toHaveCount(0);

    await page.goto("/projects?q=definitely-not-a-project");
    await expect(
      page.getByRole("heading", { name: "No matching projects or repositories" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL("/projects");
    await expect(page.getByText("24 projects · 5 repositories")).toBeVisible();
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
    await expect(page.getByText("Healthy", { exact: true }).first()).toBeVisible();

    for (const [slug, accessibleName] of [
      ["rfmc", /VirtualCDU training mission selector/i],
      ["heimdall", /Heimdall THORChain operations console/i],
      ["thorchain-wiki", /THORChain Wiki homepage with protocol navigation/i],
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
    await expect(page.getByText("Media not published")).toHaveCount(0);

    await page.goto("/projects/thorchain-wiki");
    await expect(
      page.getByRole("heading", { level: 1, name: "tcwiki / THORChain Wiki" }),
    ).toBeVisible();
    await expect(page.getByText("Healthy", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open live product" })).toHaveAttribute(
      "href",
      "https://wiki.thorchain.no/",
    );

    await page.goto("/projects/thorarb");
    await expect(page.getByText("Not monitored", { exact: true }).first()).toBeVisible();
  });
});

test.describe("public status", () => {
  test("prioritizes fresh public checks before history on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/status");

    await expect(page.getByText("Operational", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("6/6 up", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/100% available across 8 known checks/i).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Coverage 100%", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("24h ago", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("now", { exact: true }).first()).toBeVisible();

    const inventory = page.getByRole("heading", { name: "Service inventory" });
    const history = page.getByRole("heading", {
      name: "Coarse pressure history",
    });
    const [inventoryBox, historyBox] = await Promise.all([
      inventory.boundingBox(),
      history.boundingBox(),
    ]);

    expect(inventoryBox).not.toBeNull();
    expect(historyBox).not.toBeNull();
    expect(inventoryBox!.y).toBeLessThan(historyBox!.y);

    const inventoryPrecedesHistory = await page.locator("main").evaluate((main) => {
      const servicesHeading = main.querySelector("#public-services-heading");
      const historyHeading = main.querySelector("#history-heading");
      const servicesSection = servicesHeading?.closest("section");
      const historySection = historyHeading?.closest("section");
      if (!servicesSection || !historySection) return false;
      return Boolean(
        servicesSection.compareDocumentPosition(historySection) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });

    expect(inventoryPrecedesHistory).toBe(true);
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/status");
    const [desktopInventoryBox, desktopHistoryBox] = await Promise.all([
      inventory.boundingBox(),
      history.boundingBox(),
    ]);

    expect(desktopInventoryBox).not.toBeNull();
    expect(desktopHistoryBox).not.toBeNull();
    expect(desktopInventoryBox!.x).toBeGreaterThan(desktopHistoryBox!.x);
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);
  });

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
      page.getByRole("img", { name: /CPU pressure history:/i }),
    ).toBeVisible();
    await expect(page.getByText("Frontpage", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent events" })).toBeVisible();
    await expect(page.getByText("Public checks recovered after a brief disruption")).toBeVisible();

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
      "frontpage-app",
      "system/untracked",
      "Current processes",
      "Collector diagnostic",
      "trigger_value",
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
