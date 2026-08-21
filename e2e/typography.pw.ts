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

// `undefined` until `beforeAll` succeeds: `bootKanna()` can throw (port already occupied,
// `dist/client` missing, backend exits early — see e2e/boot.ts), and when it does, `boot` is
// never assigned. `afterAll` must tolerate that (see below) rather than crash on
// `undefined.stop()`, which would mask the real boot-failure diagnostic behind an unrelated
// TypeError.
let boot: KannaBoot | undefined

test.beforeAll(async () => {
  boot = await bootKanna()
})

test.afterAll(async () => {
  // Only stop if `beforeAll` actually produced a boot: calling `.stop()` on `undefined` after a
  // failed boot would throw `TypeError: Cannot read properties of undefined`, hiding the real
  // error `bootKanna()` threw.
  await boot?.stop()
})

test("root font-size is the honest current default (16px, nothing overrides it yet)", async ({ page }) => {
  if (!boot) {
    throw new Error("boot was not initialized — beforeAll must have failed")
  }

  await page.goto(boot.baseUrl)

  // Wait for a POSITIVE signal that the real application shell — not any bootstrap/splash state
  // — has rendered. `AppBootstrap` (src/client/app/AppBootstrap.tsx) is reused for every splash
  // state (`"Checking session"`, `"Connecting to workspace"`, UI-restart labels, ...) and never
  // renders `[data-sidebar="open"]` — that attribute is emitted exactly once, by
  // `KannaSidebar.tsx`, which only mounts once `App.tsx`'s `state.sidebarReady` is true (i.e. the
  // real shell). A negative guard (absence of one splash string) would false-green on any OTHER
  // splash state still showing 16px; this positive wait cannot.
  await page.waitForSelector('[data-sidebar="open"]')

  const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)

  expect(fontSize).toBe("16px")
})
