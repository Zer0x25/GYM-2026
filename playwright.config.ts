import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
    timezoneId: "America/Santiago",
    locale: "es-CL",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "/tmp/gym-e2e-results",
  reporter: "list",
});
