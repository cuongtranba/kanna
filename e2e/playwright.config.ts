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
  // `fullyParallel: false` only serialises tests WITHIN a file — Playwright still
  // hands separate files to separate workers. Every spec here boots through
  // `bootKanna`, which binds one fixed port (TEST_PORT 3299) on purpose, so two
  // files running at once means the second one hits `assertPortFree` and dies
  // with "Port 3299 is already in use". Observed the moment a third spec file
  // was added: smoke and plugins raced and both failed. One worker is the whole
  // fix; a per-worker port would trade a 3-line config for a port-allocation
  // scheme this harness (a handful of specs, run on demand) does not need.
  workers: 1,
  reporter: [["html", { outputFolder: "./.output/html-report", open: "never" }]],
  use: {
    // Drives the machine's installed Google Chrome directly — no Playwright
    // browser download/cache required (verified: `playwright install` is
    // unnecessary here).
    channel: "chrome",
    viewport: { width: 2560, height: 1440 },
  },
})
