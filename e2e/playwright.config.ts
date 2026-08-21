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
  // Must comfortably exceed boot.ts's READY_TIMEOUT_MS (60_000ms): Playwright derives its
  // `beforeAll`/`afterAll` hook timeout from this same project `timeout` (verified empirically
  // against the installed Playwright 1.62 — `--timeout=500` produces "beforeAll hook timeout of
  // 500ms exceeded"). Left at the 30s default, Playwright can kill `beforeAll` WHILE
  // `bootKanna()` is still mid-flight on a legitimately slow (30-60s) boot, before `boot` is
  // ever assigned in e2e/typography.pw.ts — leaving `afterAll`'s `boot?.stop()` a no-op and the
  // already-spawned detached child (and its temp KANNA_HOME) orphaned, bound to the fixed
  // TEST_PORT forever. Raising this ceiling above READY_TIMEOUT_MS instead guarantees
  // bootKanna's own internal deadline always fires first, so its `catch` block runs `stop()`
  // before Playwright's hook timeout could ever intervene.
  timeout: 90_000,
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
