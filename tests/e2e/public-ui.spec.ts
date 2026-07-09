import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("application shell", () => {
  test("exposes identity, navigation, skip target, and accessible structure", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: /Reidar/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Projects" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Status" })).toBeVisible();

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
