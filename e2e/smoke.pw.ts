/**
 * smoke.pw.ts — page-level smoke test for the production bundle.
 *
 * Purpose: catch bundle regressions (CJS interop crashes, React tree failures,
 * any error that produces a white screen) before `npm publish` ships them.
 * The 1.44.0 release shipped a broken bundle where the React root never mounted
 * because `react-use-websocket`'s default export resolved to undefined under
 * rolldown's CJS interop — this spec would have turned that into a red CI run.
 *
 * What this is NOT: a full end-to-end feature test. It asserts only that the
 * production server boots, the page loads, and the React shell renders past the
 * initial connecting splash — not that any individual feature works correctly.
 *
 * Placement: gated by `release-please.yml` before `npm publish`, NOT wired into
 * the default `test.yml` CI path (which is intentionally kept Playwright-free
 * for cost and environment-dependency reasons). Running the smoke test on every
 * PR would require Chrome on every runner; the release path runs it once,
 * against the exact build that is about to ship.
 */

import { test, expect } from "@playwright/test"
import { bootKanna, type KannaBoot } from "./boot"

let boot: KannaBoot | undefined

test.beforeAll(async () => {
  boot = await bootKanna()
})

test.afterAll(async () => {
  await boot?.stop()
})

test("production bundle renders the app shell without page errors", async ({ page }) => {
  if (!boot) throw new Error("boot was not initialized — beforeAll must have failed")

  const pageErrors: string[] = []
  const consoleErrors: string[] = []

  page.on("pageerror", (error) => {
    pageErrors.push(String(error))
  })

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text())
    }
  })

  await page.goto(boot.baseUrl)

  // Wait for the sidebar — this is the positive signal that the React tree
  // mounted AND the WebSocket connected successfully. A white-screen crash
  // (like 1.44.0's CJS interop failure) never reaches this selector.
  // The `[data-sidebar]` attribute is set by KannaSidebar on first render,
  // regardless of Claude auth state — so this works on a fresh KANNA_HOME
  // with no credentials configured.
  await expect(page.locator("[data-sidebar]")).toBeVisible({ timeout: 30_000 })

  // The #root element must have actual content — proves React mounted.
  await expect(page.locator("#root")).not.toBeEmpty()

  // Any page-level JavaScript error (TypeError, ReferenceError, …) is a
  // hard failure. This is the class of error that produced the white screen
  // in 1.44.0 — collect during navigation, assert at the end so the
  // sidebar-wait above has already confirmed the positive case.
  expect(pageErrors, `page errors: ${pageErrors.join("; ")}`).toEqual([])

  // console.error calls (React prop-type warnings, unhandled promise
  // rejections reported to the console) are treated as errors — they signal
  // degraded startup behaviour even when the shell renders.
  expect(consoleErrors, `console errors: ${consoleErrors.join("; ")}`).toEqual([])
})
