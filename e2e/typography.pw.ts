import { test, expect } from "@playwright/test"
import { bootKanna, type KannaBoot } from "./boot"

// P10 bootstrap smoke (see docs/tribe/planning/typography-scale-preference-spec.md §5 and
// docs/tribe/planning/typography-scale-preference-plan.md Task 5). This is the only place in
// the repo that can observe real, browser-computed layout: happy-dom (used by `bun test`) has
// no layout engine and cannot see that anything got bigger.
//
// The typography *feature* (settings-driven scaling) does not exist yet. `src/index.css` does
// now declare `html { font-size: calc(16px * var(--kanna-font-scale, 1)) }` (Task 3), but with
// no scale preference wired up yet that resolves to plain 16px — so this spec still asserts the
// CURRENT default state, and will grow into the full scale assertions once the feature lands.

let boot: KannaBoot

test.beforeAll(async () => {
  boot = await bootKanna()
})

test.afterAll(async () => {
  await boot.stop()
})

test("root font-size is the honest current default (16px, nothing overrides it yet)", async ({ page }) => {
  await page.goto(boot.baseUrl)

  // Wait until the app has left the bootstrap splash (`AppBootstrap label="Connecting to
  // workspace"`, rendered while `!state.sidebarReady`) and is showing the real sidebar shell.
  // The splash's own root font-size is also 16px, so without this wait the assertion below could
  // pass against a client that never actually reached the real UI — `boot.baseUrl` answering
  // and `document.documentElement`'s font-size are necessary but not sufficient proof of that.
  await page.waitForFunction(() => !document.body.textContent?.includes("Connecting to workspace"))
  await page.waitForSelector("#root > *")

  const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)

  expect(fontSize).toBe("16px")
})
