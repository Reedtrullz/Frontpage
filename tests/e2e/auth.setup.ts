import fs from "node:fs";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";

const authFile = path.join(process.cwd(), "tests", "e2e", ".auth", "owner.json");
const ownerToken = process.env.FRONTPAGE_E2E_OWNER_TOKEN ?? "frontpage-e2e-owner-token";

setup("authenticate owner", async ({ page }) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBe(true);
  const { csrfToken } = await csrfResponse.json();

  const callbackResponse = await page.request.post("/api/auth/callback/e2e-owner", {
    form: {
      csrfToken,
      token: ownerToken,
      callbackUrl: "/admin",
    },
    maxRedirects: 0,
  });

  expect([302, 303]).toContain(callbackResponse.status());
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Content workspace" })).toBeVisible();
  await page.context().storageState({ path: authFile });
});
