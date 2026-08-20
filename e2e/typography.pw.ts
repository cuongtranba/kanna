import { test, expect } from "@playwright/test"
import { bootKanna, type KannaBoot } from "./boot"

// P10 bootstrap smoke (see docs/tribe/planning/typography-scale-preference-spec.md §5 and
// docs/tribe/planning/typography-scale-preference-plan.md Task 5). This is the only place in
// the repo that can observe real, browser-computed layout: happy-dom (used by `bun test`) has
// no layout engine and cannot see that anything got bigger.
//
// The typography feature itself does not exist yet. This spec asserts the CURRENT default
// state — nothing in `src/index.css` sets a root `font-size` today — and will grow the scale
// assertions once the feature lands.

let boot: KannaBoot

test.beforeAll(async () => {
  boot = await bootKanna()
})

test.afterAll(async () => {
  await boot.stop()
})

test("root font-size is the honest current default (16px, nothing overrides it yet)", async ({ page }) => {
  await page.goto(boot.baseUrl)
  await page.waitForSelector("#root > *")

  const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)

  expect(fontSize).toBe("16px")
})
