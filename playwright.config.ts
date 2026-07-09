import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const port = 3100;

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
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node .next/standalone/server.js",
    url: `http://127.0.0.1:${port}`,
    env: {
      AUTH_SECRET: "frontpage-playwright-secret",
      AUTH_URL: `http://127.0.0.1:${port}`,
      HOSTNAME: "127.0.0.1",
      METRICS_DIR: path.join(process.cwd(), "tests", "e2e", ".metrics"),
      PORT: String(port),
      VERSION: "e2e-version",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
