import { defineConfig, devices } from "@playwright/test";

// Render loop: every screen on a phone viewport, Spotify and Anthropic mocked.
//   npm run e2e           compare against approved screenshots
//   npm run e2e:update    approve the current renders as the new baseline
//   npm run shots         save fresh screenshots to screenshots/ for review
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  use: {
    baseURL: "http://127.0.0.1:5199/",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "iphone",
      use: {
        ...devices["iPhone 13"],
        // Uses the installed Edge locally (no browser download). In CI, set
        // PW_CHANNEL=chromium after `npx playwright install chromium`.
        browserName: "chromium",
        channel: process.env.PW_CHANNEL ?? "msedge",
      },
    },
  ],
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 5199 --strictPort",
    url: "http://127.0.0.1:5199/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
