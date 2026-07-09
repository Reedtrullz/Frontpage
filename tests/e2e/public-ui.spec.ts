import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("application shell", () => {
  test("exposes identity, navigation, skip target, and accessible structure", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: /Reidar/i })).toBeVisible();
    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(
      primary.getByRole("link", { name: "Projects", exact: true }),
    ).toBeVisible();
    await expect(
      primary.getByRole("link", { name: /^Status/ }),
    ).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    const accessibility = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("provides a usable mobile navigation menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Projects" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Status" })).toBeVisible();
  });

  test("uses branded owner sign-in and not-found surfaces", async ({ page }) => {
    await page.goto("/signin");
    await expect(
      page.getByRole("heading", { name: "Owner sign in" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continue with GitHub/i }),
    ).toBeVisible();

    await page.goto("/this-route-does-not-exist");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back home" })).toBeVisible();
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
  });

  test("shows real project media and structured limits", async ({ page }) => {
    await page.goto("/projects/rfs");
    await expect(page.getByRole("heading", { level: 1, name: "RFS" })).toBeVisible();
    await expect(
      page.getByRole("img", { name: /RFS flight simulator showing Trondheim/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Current limitations" }),
    ).toBeVisible();
  });

  test("does not overflow a narrow mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/projects");
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe("public status", () => {
  test("degrades honestly without metrics and leaks no owner fields", async ({
    page,
  }) => {
    await page.goto("/status");
    await expect(
      page.getByRole("heading", { level: 1, name: "System status" }),
    ).toBeVisible();
    await expect(page.getByText("Status unavailable", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("No public checks configured.")).toBeVisible();

    const html = await page.content();
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
      expect(html).not.toContain(privateMarker);
    }
  });
});
