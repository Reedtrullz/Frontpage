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
    await page.locator('a[href="/admin/projects/nytt"]').click();
    await expect(page.getByRole("heading", { name: "Nytt", exact: true })).toBeVisible();
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

  test("keeps invalid gallery JSON visible, links its error, and focuses it on save", async ({ page }) => {
    let saveNumber = 0;
    let savedGallery: unknown;
    await page.route("**/api/data/projects", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const payload = route.request().postDataJSON() as { content: Array<{ slug: string; media?: { gallery?: unknown[] } }> };
      savedGallery = payload.content.find((project) => project.slug === "rfs")?.media?.gallery;
      saveNumber += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ revision: `00000000-0000-4000-8000-${String(saveNumber).padStart(12, "0")}` }),
      });
    });
    await page.goto("/admin/projects/rfs");
    const gallery = page.getByLabel("Gallery JSON");

    // Seed a real saved value using the canonical approved cover already shown in this editor.
    const cover = {
      src: await page.getByLabel("Cover source").inputValue(),
      alt: await page.getByLabel("Cover alt text").inputValue(),
      width: Number(await page.getByLabel("Width").inputValue()),
      height: Number(await page.getByLabel("Height").inputValue()),
      caption: await page.getByLabel("Caption").inputValue(),
    };
    await gallery.fill(JSON.stringify([cover], null, 2));
    await page.getByRole("button", { name: "Save project draft" }).click();
    await expect(page.getByText("Projects draft saved locally. It is not published.")).toBeVisible();
    expect(savedGallery).toEqual([cover]);

    await gallery.fill("{}");
    await expect(gallery).toHaveAttribute("aria-invalid", "true");
    await expect(gallery).toHaveAttribute("aria-describedby", "project-gallery-error");
    await page.getByRole("button", { name: "Save project draft" }).click();
    await expect(gallery).toBeFocused();
    await expect(gallery).toHaveValue("{}");

    await gallery.fill("[]");
    await expect(gallery).toHaveAttribute("aria-invalid", "false");
    await expect(page.getByRole("button", { name: "Save project draft" })).toBeEnabled();
    await page.getByRole("button", { name: "Save project draft" }).click();
    await expect(page.getByText("Projects draft saved locally. It is not published.")).toBeVisible();
    expect(savedGallery).toEqual([]);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Discard all project drafts" }).click();
  });

  test("new project starts honestly and canceled then accepted Back uses one entry each", async ({ page }) => {
    await page.goto("/admin/projects");
    await page.getByRole("link", { name: "Create project draft" }).click();
    await expect(page.getByRole("heading", { name: "Create project draft" })).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue("");
    await expect(page.getByLabel("Evidence note")).toHaveValue("");
    await page.getByLabel("Name").fill("Unpublished draft");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/projects\/new$/);
    await expect(page.getByLabel("Name")).toHaveValue("Unpublished draft");

    page.once("dialog", (dialog) => dialog.accept());
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/projects$/);
    await expect(page.getByRole("heading", { name: "Project content" })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/admin\/projects\/new$/);
    await expect(page.getByRole("heading", { name: "Create project draft" })).toBeVisible();
  });

  test("popstate fallback cancels before routing and accepted Back leaves in one action", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "navigation", { configurable: true, value: undefined });
    });
    await page.goto("/admin/projects");
    await page.getByRole("link", { name: "Create project draft" }).click();
    await page.getByLabel("Name").fill("Fallback unsaved draft");

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/projects\/new$/);
    await expect(page.getByLabel("Name")).toHaveValue("Fallback unsaved draft");

    page.once("dialog", (dialog) => dialog.accept());
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/projects$/);
    await expect(page.getByRole("heading", { name: "Project content" })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/admin\/projects\/new$/);
  });

  test("popstate fallback cancels Forward by restoring the prior entry", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "navigation", { configurable: true, value: undefined });
    });
    await page.goto("/admin/projects/new");
    await page.evaluate(() => {
      history.pushState({ ...history.state, forwardProbe: "earlier" }, "", location.href);
      history.pushState({ ...history.state, forwardProbe: "later" }, "", location.href);
      history.back();
    });
    await page.waitForFunction(() => history.state?.forwardProbe === "earlier");

    const name = page.getByLabel("Name");
    await name.fill("Keep fields after rejected Forward");
    const historyLength = await page.evaluate(() => history.length);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.goForward();
    await expect(page).toHaveURL(/\/admin\/projects\/new$/);
    await expect(name).toHaveValue("Keep fields after rejected Forward");
    await expect.poll(() => page.evaluate(() => history.state?.forwardProbe)).toBe("earlier");
    expect(await page.evaluate(() => history.length)).toBe(historyLength);

    page.once("dialog", (dialog) => dialog.accept());
    await page.goForward();
    await expect.poll(() => page.evaluate(() => history.state?.forwardProbe)).toBe("later");
  });

  test("failed programmatic push does not corrupt fallback position for a later canceled Back", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "navigation", { configurable: true, value: undefined });
    });
    await page.goto("/admin/projects/new");
    const failedPushWasRejected = await page.evaluate(() => {
      try {
        history.pushState({ ...history.state, uncloneable: () => undefined }, "", location.href);
      } catch {
        return true;
      }
      return false;
    });
    expect(failedPushWasRejected).toBe(true);

    await page.evaluate(() => {
      history.pushState({ ...history.state, pushProbe: "earlier" }, "", location.href);
      history.pushState({ ...history.state, pushProbe: "later" }, "", location.href);
      history.back();
    });
    await page.waitForFunction(() => history.state?.pushProbe === "earlier");
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => history.state?.pushProbe === undefined);
    await page.evaluate(() => history.forward());
    await page.waitForFunction(() => history.state?.pushProbe === "earlier");

    const name = page.getByLabel("Name");
    await name.fill("Retain fields after failed push");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.goBack();
    await expect(name).toHaveValue("Retain fields after failed push");
    await expect.poll(() => page.evaluate(() => history.state?.pushProbe)).toBe("earlier");

    page.once("dialog", (dialog) => dialog.accept());
    await page.goBack();
    await expect.poll(() => page.evaluate(() => history.state?.pushProbe)).toBeUndefined();
  });

  test("modified and new-tab links do not prompt or disturb unsaved fields", async ({ page }) => {
    await page.goto("/admin/projects/new");
    await page.getByLabel("Name").fill("Keep this editor open");
    let dialogCount = 0;
    page.on("dialog", async (dialog) => {
      dialogCount += 1;
      await dialog.dismiss();
    });

    const editorsLink = page.getByRole("link", { name: "All project editors" });
    const modifiedPopup = page.waitForEvent("popup");
    await editorsLink.click({ modifiers: ["Control"] });
    await expect(await modifiedPopup).toHaveURL(/\/admin\/projects$/);

    await editorsLink.evaluate((anchor: HTMLAnchorElement) => { anchor.target = "_blank"; });
    const newTab = page.waitForEvent("popup");
    await editorsLink.click();
    await expect(await newTab).toHaveURL(/\/admin\/projects$/);
    await expect(page).toHaveURL(/\/admin\/projects\/new$/);
    await expect(page.getByLabel("Name")).toHaveValue("Keep this editor open");
    expect(dialogCount).toBe(0);
  });

  test("accepted same-tab links show one unsaved warning", async ({ page }) => {
    await page.goto("/admin/projects/new");
    await page.getByLabel("Name").fill("Navigate after accepting once");
    let dialogCount = 0;
    page.on("dialog", async (dialog) => {
      dialogCount += 1;
      await dialog.accept();
    });
    await page.getByRole("link", { name: "All project editors" }).click();
    await expect(page).toHaveURL(/\/admin\/projects$/);
    expect(dialogCount).toBe(1);
  });

  test("creates, previews, archives, then discards one complete project draft", async ({ page }) => {
    const submittedRenames: Array<{ slug: string; aliases?: string[] }> = [];
    await page.route("**/api/data/projects", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { content: Array<{ name: string; slug: string; aliases?: string[] }> };
        const candidate = body.content.find((project) => project.name === "E2E Owner Draft");
        if (candidate) submittedRenames.push({ slug: candidate.slug, aliases: candidate.aliases });
      }
      await route.continue();
    });
    await page.goto("/admin/projects/new");
    await expect(page.getByRole("button", { name: "Discard all project drafts" })).toHaveCount(0);
    await page.getByLabel("Name").fill("E2E Owner Draft");
    await page.getByLabel("Slug").fill("rfs");
    await page.getByRole("button", { name: "Save project draft" }).click();
    await expect(page.getByLabel("Slug")).toBeFocused();
    await expect(page.getByLabel("Slug")).toHaveAttribute("aria-describedby", "project-slug-error");
    await page.getByLabel("Slug").fill("e2e-owner-draft");
    await page.getByRole("button", { name: "Save project draft" }).click();
    await expect(page.getByLabel("Outcome")).toBeFocused();
    await expect(page.getByLabel("Outcome")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Outcome")).toHaveAttribute("aria-describedby", "project-outcome-error");
    await page.getByLabel("Outcome").fill("Demonstrates a complete owner-created draft.");
    await page.getByLabel("Short description").fill("A local-only project draft for browser regression.");
    await page.getByLabel("Long description").fill("This content is created in the isolated browser test runtime and is never published.");
    await page.getByLabel("What it solves").fill("Makes the create workflow verifiable.");
    await page.getByLabel("Current state").fill("This is an unpublished test candidate.");
    await page.getByLabel("How it works").fill("The owner fills required evidence and saves the bundle.");
    await page.getByLabel("Reviewed at (UTC)").fill("2026-10-03T15:00:00Z");
    await page.getByLabel("Evidence note").fill("Synthetic browser fixture only; no public claim.");
    await page.getByLabel("Milestones JSON").fill(JSON.stringify([{ id: "fixture-first-release", occurredAt: "2026-10-02", title: "Synthetic timeline fixture", summary: "A local browser fixture with a documented source reference.", scope: "source-reviewed", evidenceUrl: "https://example.com/test-evidence", reviewedAt: "2026-10-03T15:00:00Z" }], null, 2));
    await expect(page.getByRole("button", { name: "Save project draft" })).toBeEnabled();
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("heading", { name: "What it solves" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Project timeline" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Synthetic timeline fixture" })).toBeVisible();
    await expect(page.getByText("Current limitations")).toHaveCount(0);
    await page.getByRole("button", { name: "Save project draft" }).click();
    await expect(page.getByText("Projects draft saved locally. It is not published.")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/projects\/e2e-owner-draft$/);
    await page.getByLabel("Slug").fill("e2e-owner-draft-renamed");
    await page.getByRole("button", { name: "Save project draft" }).click();
    await expect(page).toHaveURL(/\/admin\/projects\/e2e-owner-draft-renamed$/);
    await page.getByLabel("Slug").fill("e2e-owner-draft-final");
    await page.getByRole("button", { name: "Save project draft" }).click();
    await expect(page).toHaveURL(/\/admin\/projects\/e2e-owner-draft-final$/);
    await page.getByLabel("Slug").fill("e2e-owner-draft");
    await expect(page.getByRole("button", { name: "Save project draft" })).toBeEnabled();
    await page.getByRole("button", { name: "Save project draft" }).click();
    await expect(page).toHaveURL(/\/admin\/projects\/e2e-owner-draft$/);
    expect(submittedRenames.at(-1)).toEqual({ slug: "e2e-owner-draft", aliases: ["e2e-owner-draft-renamed", "e2e-owner-draft-final"] });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Archive project" }).click();
    await expect(page.getByText(/Project archived in the local draft/)).toBeVisible();
    await expect(page.getByLabel("Evidence note")).toHaveValue("Synthetic browser fixture only; no public claim.");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Discard all project drafts" }).click();
    await expect(page).toHaveURL(/\/admin\/projects$/);
  });

  test("offline save and discard failures preserve personal editor text and recover busy state", async ({ page }) => {
    let saveAttempt = 0;
    await page.route("**/api/data/personal", async (route) => {
      if (route.request().method() === "DELETE") return route.abort();
      saveAttempt += 1;
      if (saveAttempt === 1) return route.abort();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ revision: "personal-network-revision" }) });
    });
    await page.goto("/admin/personal");
    const bio = page.getByLabel("Bio");
    await bio.fill(`${await bio.inputValue()} network regression`);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText(/save request failed/i)).toBeVisible();
    await expect(bio).toHaveValue(new RegExp("network regression"));
    await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Personal draft saved locally. It is not published.")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Discard draft", exact: true }).click();
    await expect(page.getByText(/discard request failed/i)).toBeVisible();
    await expect(bio).toHaveValue(new RegExp("network regression"));
  });

  test("offline project save preserves unsaved fields and retry remains guarded", async ({ page }) => {
    await page.goto("/admin/projects/rfs");
    const name = page.getByLabel("Name");
    await name.fill("RFS offline owner edit");
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "Save project draft" }).click();
    await expect(page.getByText(/save request failed/i)).toBeVisible();
    await expect(name).toHaveValue("RFS offline owner edit");
    await expect(page.getByRole("button", { name: "Save project draft" })).toBeEnabled();

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("link", { name: "All project editors" }).click();
    await expect(page).toHaveURL(/\/admin\/projects\/rfs$/);
    await expect(name).toHaveValue("RFS offline owner edit");
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
