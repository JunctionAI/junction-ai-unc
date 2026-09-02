import { defineConfig, devices } from "@playwright/test";

/* Phase 1 acceptance harness.

   - The Next dev server must ALREADY be running on :3400 (scripts/dev.sh). We never start
     or stop it from here (webServer is deliberately undefined).
   - tests/e2e/global-setup.ts serves design-reference/ over http on a spare port so the
     original .dc.html prototypes render (they load React from unpkg and need http://, not
     file://). Its origin reaches the specs through process.env.PROTO_BASE.
   - Viewport is 1280×900 everywhere so the parity captures and the functional specs see
     the same layout. */

export const PORT_BASE = process.env.PORT_BASE || "http://localhost:3400";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: "./test-results",
  use: {
    baseURL: PORT_BASE,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: undefined,
});
