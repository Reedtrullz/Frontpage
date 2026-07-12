import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.describe("owner workspace", () => {
  test("renders exact owner status and protected workspaces", async ({ page }) => {
    await page.goto("/status");
    await expect(page.getByRole("heading", { name: "Owner status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Host resources" })).toBeVisible();
    await expect(page.getByText("Frontpage internal", { exact: true })).toBeVisible();
    await expect(page.getByText("Frontpage container", { exact: true })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "24%" }).first()).toBeVisible();
    await expect(page.getByText("Fresh telemetry", { exact: true })).toBeVisible();
    const statusSections = page.getByRole("navigation", { name: "Owner status sections" });
    await expect(statusSections).toBeVisible();
    await expect(statusSections.getByRole("link", { name: "Resources" })).toBeVisible();
    await expect(statusSections.getByRole("link", { name: "Runbook" })).toBeVisible();

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Content workspace" })).toBeVisible();
    await page.goto("/admin/projects");
    await expect(page.getByRole("heading", { name: "Project content" })).toBeVisible();
    await page.getByRole("link", { name: /Nytt/ }).click();
    await expect(page.getByRole("heading", { name: "Nytt" })).toBeVisible();
    await page.goto("/ansible");
    await expect(page.getByRole("heading", { name: "Frontpage operations" })).toBeVisible();
  });

  test("saves and discards a personal draft", async ({ page }) => {
    await page.goto("/admin/personal");
    const bio = page.getByLabel("Bio");
    const original = await bio.inputValue();

    await bio.fill(`${original} E2E draft`);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Personal draft saved locally. It is not published.")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Discard draft", exact: true }).click();
    await expect(page.getByText("Personal draft discarded. Published content is unchanged.")).toBeVisible();
  });

  test("supports keyboard owner-menu dismissal and mobile parity", async ({ page }) => {
    await page.goto("/");
    const ownerButton = page.getByRole("button", { name: "Owner" });
    await ownerButton.click();
    const menu = page.getByRole("menu", { name: "Owner navigation" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Proposals" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Content workspace" })).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Operations runbook" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(menu.getByRole("menuitem", { name: "Content workspace" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(ownerButton).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    const mobile = page.getByRole("navigation", { name: "Mobile" });
    await expect(mobile.getByRole("link", { name: "Proposals" })).toBeVisible();
  });
});
