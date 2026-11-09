import { test, expect, type Page } from "@playwright/test"
import { bootKanna, type KannaBoot } from "./boot"

const PHONE = { width: 390, height: 844 }

let boot: KannaBoot | undefined

test.use({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

test.beforeAll(async () => {
  boot = await bootKanna()
})

test.afterAll(async () => {
  await boot?.stop()
})

async function openHome(page: Page): Promise<void> {
  if (!boot) throw new Error("boot failed")
  await page.goto(boot.baseUrl)
  await page.waitForSelector(".kanna-sidebar-shell", { state: "attached" })
}

async function sampleShellRight(page: Page, durationMs: number): Promise<number[]> {
  return await page.evaluate(async (ms) => await new Promise<number[]>((resolve) => {
    const samples: number[] = []
    const until = performance.now() + ms
    const tick = () => {
      const shell = document.querySelector(".kanna-sidebar-shell")
      if (shell && getComputedStyle(shell).display !== "none") samples.push(Math.round(shell.getBoundingClientRect().right))
      if (performance.now() > until) return resolve(samples)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }), durationMs)
}

test("a closed drawer being dragged is drawn at the finger, not hidden until release", async ({ page }) => {
  await openHome(page)

  const right = await page.evaluate(() => {
    document.documentElement.classList.add("kanna-drawer-dragging")
    document.documentElement.style.setProperty("--kanna-drawer-progress", "0.5")
    const shell = document.querySelector(".kanna-sidebar-shell")
    return shell && getComputedStyle(shell).display !== "none" ? Math.round(shell.getBoundingClientRect().right) : null
  })

  expect(right).toBe(PHONE.width / 2)
})

test("tapping the menu slides the drawer in rather than popping it open", async ({ page }) => {
  await openHome(page)
  const samples = sampleShellRight(page, 700)
  await page.getByRole("button", { name: "Open sidebar" }).click()
  const rights = await samples

  expect(rights.some((right) => right > 0 && right < PHONE.width - 1)).toBe(true)
  await expect.poll(() => page.locator(".kanna-sidebar-shell").evaluate((shell) => Math.round(shell.getBoundingClientRect().right))).toBe(PHONE.width)
})

test("a phone dialog rises as a bottom sheet", async ({ page }) => {
  await openHome(page)
  await page.keyboard.press("Control+k")
  const dialog = page.getByRole("dialog").last()
  await expect(dialog).toBeVisible()

  const animation = await dialog.evaluate((el) => getComputedStyle(el).animationName)

  expect(animation).toBe("kanna-sheet-in")
})

test("with reduced motion the drawer opens without travelling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await openHome(page)
  const samples = sampleShellRight(page, 500)
  await page.getByRole("button", { name: "Open sidebar" }).click()
  const rights = await samples

  expect(rights.length).toBeGreaterThan(0)
  expect(rights.every((right) => right === PHONE.width)).toBe(true)
})

test("a desktop dialog scales in instead of rising as a sheet", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openHome(page)
  await page.keyboard.press("Control+k")
  const dialog = page.getByRole("dialog").last()
  await expect(dialog).toBeVisible()

  expect(await dialog.evaluate((el) => getComputedStyle(el).animationName)).toBe("kanna-dialog-in")
})
