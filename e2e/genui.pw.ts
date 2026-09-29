import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import { bootKanna, type KannaBoot } from "./boot"
import { SESSION_ID, seedGenUIReport } from "./genui-fixture"

const SCREENSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "screenshots")


let boot: KannaBoot | undefined
let chatId: string | undefined

test.beforeAll(async () => {
  boot = await bootKanna({ seed: seedGenUIReport })
})

test.afterAll(async () => {
  await boot?.stop()
})

async function importSession(page: Page): Promise<string> {
  const result = await page.evaluate(async (sessionId) => await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`)
    socket.onerror = () => reject(new Error("socket failed"))
    socket.onopen = () => socket.send(JSON.stringify({ v: 1, type: "command", id: "import", command: { type: "sessions.importClaudeSession", sessionIds: [sessionId] } }))
    socket.onmessage = (event) => {
      const envelope = JSON.parse(String(event.data))
      if (envelope.id !== "import") return
      socket.close()
      resolve(JSON.stringify(envelope))
    }
  }), SESSION_ID)
  const id = JSON.parse(result).result?.results?.[0]?.chatId
  if (typeof id !== "string") throw new Error(`import did not create a chat: ${result}`)
  return id
}

async function openReport(page: Page): Promise<void> {
  if (!boot) throw new Error("boot failed")
  await page.goto(boot.baseUrl)
  await page.waitForSelector('[data-sidebar]', { state: "attached" })
  chatId ??= await importSession(page)
  await page.goto(`${boot.baseUrl}/chat/${chatId}`)
  await expect(page.getByRole("region", { name: "FY2026 revenue report" })).toBeVisible({ timeout: 20_000 })
}

test("renders the report from workspace files, with charts drawn on canvas", async ({ page }) => {
  await openReport(page)
  const report = page.getByRole("region", { name: "FY2026 revenue report" })
  await expect(report.getByText("August revenue")).toBeVisible()
  await expect(report.locator("canvas").first()).toBeVisible({ timeout: 20_000 })
  await expect(report.getByText("Income statement")).toBeVisible()
  await expect(report.getByText("Gross profit")).toBeVisible()
})

test("drills down and updates the chart without involving the agent", async ({ page }) => {
  await openReport(page)
  const report = page.getByRole("region", { name: "FY2026 revenue report" })
  await report.getByRole("button", { name: "Break down August by customer" }).click()
  await expect(report.getByText("by customer").first()).toBeVisible()
  await report.getByRole("button", { name: "Table" }).first().click()
  await expect(report.getByRole("rowheader", { name: "Acme" }).first()).toBeVisible()
})

test("Explain variance sends the agent a message carrying the view's structured context", async ({ page }) => {
  await openReport(page)
  const report = page.getByRole("region", { name: "FY2026 revenue report" })
  await report.getByRole("button", { name: "Explain variance" }).click()
  await report.getByRole("group", { name: "Send to the agent" }).getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Variance explanation request from a report").first()).toBeVisible({ timeout: 20_000 })
})

test("captures the generative UI screenshot set — light, dark, and a narrow viewport", async ({ page }) => {
  await mkdir(SCREENSHOT_DIR, { recursive: true })
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize({ width: 1440, height: 1600 })
    await openReport(page)
    const report = page.getByRole("region", { name: "FY2026 revenue report" })
    await expect(report.locator("canvas").first()).toBeVisible({ timeout: 20_000 })
    await report.screenshot({ path: join(SCREENSHOT_DIR, `genui-report-${theme}.png`) })
  }
  await page.setViewportSize({ width: 390, height: 1800 })
  await openReport(page)
  await page.getByRole("region", { name: "FY2026 revenue report" }).screenshot({ path: join(SCREENSHOT_DIR, "genui-report-mobile.png") })
})
