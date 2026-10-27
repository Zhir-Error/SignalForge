import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm dev",
    env: {
      ...process.env,
      INGEST_RATE_LIMIT_PER_MINUTE: "6",
      INVESTIGATION_RATE_LIMIT_PER_HOUR: "1",
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
