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


let boot: KannaBoot | undefined

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
  await page.waitForSelector('[data-sidebar="open"]')
}

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

const TYPOGRAPHY_SCALE_OPTION_LABELS: Record<FontScaleStep, string> = {
  sm: "Small",
  md: "Default",
  lg: "Large",
  xl: "Extra Large",
  xxl: "XX-Large",
}

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
  return page.locator(".kanna-terminal .xterm-rows > div").first()
}

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

  await page.getByRole("button", { name: "Settings" }).click()
  await page.waitForURL(/\/settings\//)
  await selectTypographyScale(page, "xxl")

  await page.goBack()
  await page.waitForURL(/\/chat\//)
  await page.waitForSelector("[data-pane-tab-strip]")

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
