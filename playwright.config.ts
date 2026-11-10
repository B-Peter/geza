import { defineConfig, devices } from "@playwright/test";

// Two projects:
//   iphone  dev server, every screen on a phone viewport, screenshot baselines
//   prod    production build (vite preview): the strict CSP is only injected at
//           build time, so this is the project that catches CSP regressions
//
//   npm run e2e           both
//   npm run e2e:prod      production smoke only (what CI runs)
//   npm run e2e:update    approve the current renders as the new baseline
//   npm run shots         save fresh screenshots to screenshots/ for review

const phone = {
  ...devices["iPhone 13"],
  // Uses the installed Edge locally (no browser download). In CI, set
  // PW_CHANNEL=chromium after `npx playwright install chromium`.
  browserName: "chromium" as const,
  channel: process.env.PW_CHANNEL ?? "msedge",
};

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
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "iphone", testIgnore: /prod\.spec\.ts/, use: { ...phone, baseURL: "http://127.0.0.1:5199/" } },
    { name: "prod", testMatch: /prod\.spec\.ts/, use: { ...phone, baseURL: "http://127.0.0.1:5198/" } },
  ],
  webServer: [
    {
      command: "npx vite --host 127.0.0.1 --port 5199 --strictPort",
      url: "http://127.0.0.1:5199/",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run build && npx vite preview --host 127.0.0.1 --port 5198 --strictPort",
      url: "http://127.0.0.1:5198/",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
