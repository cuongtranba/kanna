import { defineConfig } from "@playwright/test"

// P10 infrastructure (see docs/tribe/planning/typography-scale-preference-spec.md §5).
// Runs off the default CI path deliberately — invoked only via `bun run test:e2e`,
// never wired into `.github/workflows/test.yml` or any existing test script.
export default defineConfig({
  testDir: ".",
  // Deliberately NOT *.spec.ts / *.test.ts: bun's default `bun test` discovery glob picks up
  // both suffixes project-wide, and would try (and fail) to execute Playwright spec files with
  // the wrong test runner. `*.pw.ts` keeps this harness invisible to `bun test`.
  testMatch: "**/*.pw.ts",
  outputDir: "./.output/test-results",
  fullyParallel: false,
  reporter: [["html", { outputFolder: "./.output/html-report", open: "never" }]],
  use: {
    // Drives the machine's installed Google Chrome directly — no Playwright
    // browser download/cache required (verified: `playwright install` is
    // unnecessary here).
    channel: "chrome",
    viewport: { width: 2560, height: 1440 },
  },
})
