import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.pw.ts",
  timeout: 90_000,
  outputDir: "./.output/test-results",
  fullyParallel: false,
  workers: 1,
  reporter: [["html", { outputFolder: "./.output/html-report", open: "never" }]],
  use: {
    channel: "chrome",
    viewport: { width: 2560, height: 1440 },
  },
})
