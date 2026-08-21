import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test, expect, type Locator, type Page } from "@playwright/test"
import { bootKanna, type KannaBoot } from "./boot"
import {
  FONT_SCALE_MULTIPLIERS,
  FONT_SCALE_STEPS,
  type FontScaleStep,
} from "../src/shared/design/typography"

// P10 feature assertions (Task 16d, see
// docs/tribe/planning/typography-scale-preference-plan.md § "16d — P10 feature assertions").
// Everything below drives the REAL Settings → General UI in a REAL browser and reads back
// REAL, browser-computed layout — happy-dom (used by `bun test`) has no layout engine and no
// font metrics, so none of this is reachable from a unit test. `FONT_SCALE_MULTIPLIERS` and
// `FONT_SCALE_STEPS` are imported from the pure core (`src/shared/design/typography.ts`,
// zero DOM/node deps) rather than re-typed here, so this oracle can never drift from the
// values it is meant to be checking.

let boot: KannaBoot | undefined

// Set once project + chat creation succeeds (see the terminal-metrics test below) and reused
// by the screenshot test, so the (expensive, real-filesystem, real-websocket) project/chat
// creation flow runs exactly once per file, not once per test.
let sharedChatId: string | undefined

test.beforeAll(async () => {
  boot = await bootKanna()
})

test.afterAll(async () => {
  await boot?.stop()
})

function requireBoot(): KannaBoot {
  if (!boot) {
    throw new Error("boot was not initialized — beforeAll must have failed")
  }
  return boot
}

async function waitForShell(page: Page): Promise<void> {
  // Same positive-shell-rendered signal as the bootstrap smoke test above — see its comment
  // for why this must be a positive wait, not a negative guard against a splash string.
  await page.waitForSelector('[data-sidebar="open"]')
}

// The Settings → General "Typography Scale" row (built in Task 10) has no accessible name of
// its own — SettingsRow renders a plain, unassociated `<label>`-less title/description pair
// next to its control (src/client/app/SettingsPage.tsx:954-983). The row's own title text is
// therefore the only stable anchor: its parent's next sibling holds the row's control, and its
// own next sibling (within the same parent) holds the description text.
function typographyRowTitle(page: Page): Locator {
  return page.getByText("Typography Scale", { exact: true })
}

function typographyRowDescription(page: Page): Locator {
  return typographyRowTitle(page).locator("xpath=following-sibling::div[1]")
}

function typographyTrigger(page: Page): Locator {
  return typographyRowTitle(page).locator("xpath=../following-sibling::div[1]").getByRole("combobox")
}

function themeButton(page: Page, label: "Light" | "Dark"): Locator {
  return page
    .getByText("Theme", { exact: true })
    .locator("xpath=../following-sibling::div[1]")
    .getByRole("button", { name: label, exact: true })
}

// Mirrors typographyScaleOptions in SettingsPage.tsx (private to that module — not exported,
// so this is the real, user-visible option text a real user would click, not an internal id).
const TYPOGRAPHY_SCALE_OPTION_LABELS: Record<FontScaleStep, string> = {
  sm: "Small",
  md: "Default",
  lg: "Large",
  xl: "Extra Large",
  xxl: "XX-Large",
}

/** Drives the real Select control and waits for the real CSS var to reflect the new step. */
async function selectTypographyScale(page: Page, step: FontScaleStep): Promise<void> {
  await typographyTrigger(page).click()
  await page.getByRole("option", { name: TYPOGRAPHY_SCALE_OPTION_LABELS[step], exact: true }).click()
  await page.waitForFunction(
    (expectedMultiplier) =>
      getComputedStyle(document.documentElement).getPropertyValue("--kanna-font-scale").trim() ===
      expectedMultiplier,
    String(FONT_SCALE_MULTIPLIERS[step]),
  )
}

async function selectTheme(page: Page, mode: "light" | "dark"): Promise<void> {
  await themeButton(page, mode === "dark" ? "Dark" : "Light").click()
  await page.waitForFunction(
    (dark) => document.documentElement.classList.contains("dark") === dark,
    mode === "dark",
  )
}

async function computedFontSizePx(locator: Locator): Promise<number> {
  const value = await locator.evaluate((el) => getComputedStyle(el).fontSize)
  return Number.parseFloat(value)
}

test("root font-size is the honest current default (16px, nothing overrides it yet)", async ({ page }) => {
  const kannaBoot = requireBoot()

  await page.goto(kannaBoot.baseUrl)
  await waitForShell(page)

  const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)

  expect(fontSize).toBe("16px")
})

test("Settings General drives all five typography steps and changes real computed font-size on sampled elements", async ({
  page,
}) => {
  const kannaBoot = requireBoot()

  await page.goto(`${kannaBoot.baseUrl}/settings/general`)
  await waitForShell(page)

  // Three distinct real elements, each governed by a DIFFERENT Tailwind/rem size token
  // (root `html`, `text-sm` = 0.875rem, the `--text-13` custom token = 0.8125rem introduced by
  // this card's px→rem conversion waves). Sampling more than the root proves the scale reaches
  // ordinary UI text, not just the `<html>` element the CSS rule is literally written against.
  for (const step of FONT_SCALE_STEPS) {
    await selectTypographyScale(page, step)

    const multiplier = FONT_SCALE_MULTIPLIERS[step]
    const rootFontSize = await computedFontSizePx(page.locator("html"))
    const titleFontSize = await computedFontSizePx(typographyRowTitle(page))
    const descriptionFontSize = await computedFontSizePx(typographyRowDescription(page))

    expect(rootFontSize, `root font-size at step "${step}"`).toBeCloseTo(16 * multiplier, 3)
    expect(titleFontSize, `text-sm sampled font-size at step "${step}"`).toBeCloseTo(14 * multiplier, 3)
    expect(descriptionFontSize, `--text-13 sampled font-size at step "${step}"`).toBeCloseTo(13 * multiplier, 3)
  }
})

async function createProjectAndOpenChat(page: Page, baseUrl: string): Promise<string> {
  await page.goto(baseUrl)
  await waitForShell(page)

  // First visit ever in this (fresh, per-test) browser context: App.tsx's "what's new" redirect
  // (App.tsx:450-456) unconditionally sends a first-ever `/` visit to `/settings/changelog`,
  // then immediately records the app version as "seen" in the SAME effect run — so a second
  // visit to `/` in this same context is guaranteed to land, and stay, on the real
  // LocalProjectsPage this test needs.
  await page.goto(baseUrl)
  await waitForShell(page)

  await page.getByRole("button", { name: "Add Project" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByPlaceholder("Project name").fill(`typo-e2e-${Date.now()}`)
  await dialog.getByRole("button", { name: "Create", exact: true }).click()

  await page.waitForURL(/\/chat\//)
  const chatId = new URL(page.url()).pathname.split("/chat/")[1]
  if (!chatId) {
    throw new Error(`could not extract a chatId from the post-create URL: ${page.url()}`)
  }
  return chatId
}

function terminalFirstRow(page: Page): Locator {
  // `.kanna-terminal` is TerminalPane's own mount point (TerminalPane.tsx:586). `.xterm-rows`
  // is xterm.js's own DOM-renderer row container: each row is a real `<div>` whose
  // `style.height` is set, at paint time, from `_renderService.dimensions.css.cell.height` —
  // a value xterm computes via a real Canvas/OffscreenCanvas text measurement
  // (CharSizeService), which happy-dom cannot perform (no real font engine, no
  // OffscreenCanvas). Reading this element's real bounding box is therefore the only way to
  // observe xterm's cell metrics responding to the scale change.
  return page.locator(".kanna-terminal .xterm-rows > div").first()
}

/**
 * The embedded terminal renders as its OWN tab in the pane's tab strip (alongside "New Chat"),
 * not as an always-on split — an inactive tab's content stays mounted but hidden, which is why
 * merely waiting for `.xterm-rows > div` to exist is not enough; it must also be the SELECTED
 * tab before its real layout is observable. Clicking the tab is a harmless no-op when it is
 * already selected.
 */
async function ensureTerminalVisible(page: Page): Promise<Locator> {
  const terminalTab = page.getByRole("tab", { name: "Terminal" })
  if ((await terminalTab.count()) === 0) {
    await page.getByRole("button", { name: "Toggle terminal" }).click()
    await terminalTab.waitFor()
  }
  await terminalTab.click()

  const row = terminalFirstRow(page)
  await row.waitFor()
  return row
}

test("terminal pane cell metrics change at xxl, and tab-strip text does not clip --shell-top-band", async ({
  page,
}) => {
  const kannaBoot = requireBoot()

  const chatId = await createProjectAndOpenChat(page, kannaBoot.baseUrl)
  sharedChatId = chatId

  // The typography scale is a SERVER default (Settings → General writes it via
  // `handleWriteAppSettings`, see SettingsPage.tsx:1530-1534) — not per-browser-context — so it
  // can carry over from a previous test's last selection (e.g. the five-step test above, which
  // leaves it at "xxl"). Pin it to "md" explicitly before measuring the "default" baseline so
  // this test's md-vs-xxl comparison is correct regardless of run order.
  await page.getByRole("button", { name: "Settings" }).click()
  await page.waitForURL(/\/settings\//)
  await selectTypographyScale(page, "md")
  await page.goBack()
  await page.waitForURL(/\/chat\//)
  await page.waitForSelector("[data-pane-tab-strip]")

  const rowAtDefault = await ensureTerminalVisible(page)
  const boxAtDefault = await rowAtDefault.boundingBox()
  if (!boxAtDefault) {
    throw new Error("could not measure the terminal's first row at the default (md) scale")
  }

  // Client-side navigation only (a Link click, not `page.goto`): the terminal layout store
  // (visible/hasTerminals) lives in memory, and a hard navigation would be indistinguishable
  // from a real reload either way since react-router unmounts the whole route tree on a route
  // change — but staying in the same JS runtime keeps this deterministic regardless of the
  // terminal layout store's persistence details.
  await page.getByRole("button", { name: "Settings" }).click()
  await page.waitForURL(/\/settings\//)
  await selectTypographyScale(page, "xxl")

  await page.goBack()
  await page.waitForURL(/\/chat\//)
  await page.waitForSelector("[data-pane-tab-strip]")

  // --shell-top-band clipping check (P10, 16d bullet 3): the band is `h-` AND `max-h-`
  // locked to the SAME rem-valued custom property the sampled text uses, by design (see
  // src/client/lib/shellChrome.ts) — so growing text at xxl must never push a tab's label
  // outside its band's real, painted bounding box.
  const strip = page.locator("[data-pane-tab-strip]").first()
  const activeLabel = page.getByRole("tab", { selected: true }).locator("span.truncate")
  const stripBox = await strip.boundingBox()
  const labelBox = await activeLabel.boundingBox()
  if (!stripBox || !labelBox) {
    throw new Error("could not measure the pane tab strip or its active tab's label at xxl")
  }
  const CLIP_TOLERANCE_PX = 0.5
  expect(labelBox.y, "tab label top vs. shell-top-band top, at xxl").toBeGreaterThanOrEqual(
    stripBox.y - CLIP_TOLERANCE_PX,
  )
  expect(labelBox.y + labelBox.height, "tab label bottom vs. shell-top-band bottom, at xxl").toBeLessThanOrEqual(
    stripBox.y + stripBox.height + CLIP_TOLERANCE_PX,
  )

  const rowAtXxl = await ensureTerminalVisible(page)
  const boxAtXxl = await rowAtXxl.boundingBox()
  if (!boxAtXxl) {
    throw new Error("could not measure the terminal's first row at xxl")
  }

  // getTerminalFontSize goes from 13px (md) to round(13 * 1.5) = 20px (xxl) — a ~1.54x jump.
  // A 1.2x floor is a real, load-bearing, non-trivial bound (rules out "nothing happened" or
  // a negligible rounding blip) without over-fitting to one font's exact glyph metrics.
  expect(boxAtXxl.height, "terminal cell height, xxl vs. md").toBeGreaterThan(boxAtDefault.height * 1.2)
})

const SCREENSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "screenshots")
const SCREENSHOT_SCALE_STEPS: readonly FontScaleStep[] = ["md", "xxl"]
const SCREENSHOT_THEMES = ["light", "dark"] as const

test("captures the P9 screenshot set — chat + settings (sidebar always visible), at md and xxl, light and dark", async ({
  page,
}) => {
  const kannaBoot = requireBoot()
  if (!sharedChatId) {
    throw new Error(
      "sharedChatId was not set — the terminal-metrics test (which creates the shared project/chat) must run first",
    )
  }
  const chatId = sharedChatId

  await mkdir(SCREENSHOT_DIR, { recursive: true })

  for (const themeMode of SCREENSHOT_THEMES) {
    for (const scaleStep of SCREENSHOT_SCALE_STEPS) {
      await page.goto(`${kannaBoot.baseUrl}/settings/general`)
      await waitForShell(page)
      await selectTheme(page, themeMode)
      await selectTypographyScale(page, scaleStep)

      // The sidebar (`[data-sidebar="open"]`, waited for above) is part of the persistent
      // app shell at this viewport width (2560px, well past the `md` breakpoint) — every
      // screenshot below therefore always shows sidebar + page content together, satisfying
      // "chat + settings + sidebar" without a third, redundant sidebar-only capture.
      const settingsPath = join(SCREENSHOT_DIR, `settings-${scaleStep}-${themeMode}.png`)
      await page.screenshot({ path: settingsPath })
      expect(existsSync(settingsPath), `${settingsPath} was written`).toBe(true)

      await page.goto(`${kannaBoot.baseUrl}/chat/${chatId}`)
      await page.waitForSelector("[data-pane-tab-strip]")

      const chatPath = join(SCREENSHOT_DIR, `chat-${scaleStep}-${themeMode}.png`)
      await page.screenshot({ path: chatPath })
      expect(existsSync(chatPath), `${chatPath} was written`).toBe(true)
    }
  }
})
