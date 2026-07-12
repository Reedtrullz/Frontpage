import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.describe("owner workspace", () => {
  test("renders exact owner status and protected workspaces", async ({ page }) => {
    await page.goto("/status");
    await expect(page.getByRole("heading", { name: "Owner status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Resource observability" })).toBeVisible();
    await expect(page.getByText("Frontpage internal", { exact: true })).toBeVisible();
    await expect(page.getByText("Frontpage container", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "CPU total" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "RAM total" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Disk I/O", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Network total" })).toBeVisible();
    await expect(
      page
        .getByLabel("Network total attribution")
        .getByText("Network workload attribution unavailable", { exact: true }),
    ).toBeVisible();

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Content workspace" })).toBeVisible();
    await page.goto("/admin/projects");
    await expect(page.getByRole("heading", { name: "Project content" })).toBeVisible();
    await page.getByRole("link", { name: /Nytt/ }).click();
    await expect(page.getByRole("heading", { name: "Nytt" })).toBeVisible();
    await page.goto("/ansible");
    await expect(page.getByRole("heading", { name: "Frontpage operations" })).toBeVisible();
  });

  test("supports ranges, attribution, workload drilldown, and chart inspection", async ({ page }) => {
    await page.goto("/status");
    for (const [control, label] of [
      ["24 hours", "Last 24 hours"],
      ["7 days", "Last 7 days"],
      ["30 days", "Last 30 days"],
      ["1 hour", "Last hour"],
    ] as const) {
      await page.getByRole("button", { name: control }).click();
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }

    const cpuRow = page.locator("#owner-cpu-heading").locator("..").locator("..");
    await expect(cpuRow.getByRole("button", { name: "By workload" })).toHaveAttribute("aria-pressed", "true");
    await expect(cpuRow.getByText("system/untracked", { exact: true })).toBeVisible();
    const networkRow = page.locator("#owner-network-heading").locator("..").locator("..");
    await expect(networkRow.getByRole("button", { name: "By workload" })).toBeDisabled();

    const workloadSection = page.getByRole("heading", { name: "Current workloads" }).locator("..");
    await workloadSection.getByRole("button", { name: "CPU" }).click();
    await workloadSection.getByRole("button", { name: /frontpage-app/ }).click();
    await expect(workloadSection.getByRole("heading", { name: "Current processes" })).toBeVisible();
    await expect(workloadSection.getByText("node", { exact: true })).toBeVisible();

    const cpuChart = page.getByRole("img", { name: /CPU history. Use left and right/ });
    await cpuChart.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(cpuChart.locator("..").locator('[aria-live="polite"]')).toContainText("CPU total");

    const incident = page.getByRole("button", { name: /Frontpage workload recovered after OOM kill/ });
    await incident.click();
    await expect(incident).toHaveAttribute("aria-pressed", "true");

    await page.setViewportSize({ width: 390, height: 844 });
    const [summary, chart, attribution] = await Promise.all([
      page.locator("#owner-cpu-heading").boundingBox(),
      cpuChart.boundingBox(),
      cpuRow.getByText("CPU attribution", { exact: true }).boundingBox(),
    ]);
    expect(summary).not.toBeNull();
    expect(chart).not.toBeNull();
    expect(attribution).not.toBeNull();
    expect(summary!.y).toBeLessThan(chart!.y);
    expect(chart!.y).toBeLessThan(attribution!.y);
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
