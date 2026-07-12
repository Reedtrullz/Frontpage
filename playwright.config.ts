import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const port = 3100;
const ownerStorageState = path.join(process.cwd(), "tests", "e2e", ".auth", "owner.json");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testMatch: /public-ui\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["auth-setup"],
    },
    {
      name: "owner-chromium",
      testMatch: /owner-ui\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ownerStorageState,
      },
      dependencies: ["auth-setup"],
    },
  ],
  webServer: {
    command: "node .next/standalone/server.js",
    url: `http://127.0.0.1:${port}`,
    env: {
      AUTH_SECRET: "frontpage-playwright-secret",
      AUTH_URL: `http://127.0.0.1:${port}`,
      FRONTPAGE_E2E_OWNER: process.env.FRONTPAGE_E2E_OWNER ?? "1",
      FRONTPAGE_E2E_OWNER_TOKEN:
        process.env.FRONTPAGE_E2E_OWNER_TOKEN ?? "frontpage-e2e-owner-token",
      OWNER_GITHUB_ID: process.env.OWNER_GITHUB_ID ?? "e2e-owner",
      DATA_DIR: path.join(process.cwd(), "tests", "e2e", ".data"),
      HOSTNAME: "127.0.0.1",
      METRICS_DIR: path.join(process.cwd(), "tests", "e2e", ".metrics"),
      PUBLIC_METRICS_DIR: path.join(process.cwd(), "tests", "e2e", ".metrics-v2-public"),
      OWNER_METRICS_DIR: path.join(process.cwd(), "tests", "e2e", ".metrics-v2-owner"),
      FRONTPAGE_OBSERVABILITY_V2: "1",
      PORT: String(port),
      VERSION: "e2e-version",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
