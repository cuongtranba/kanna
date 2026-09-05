
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

  await expect(page.locator("[data-sidebar]")).toBeVisible({ timeout: 30_000 })

  await expect(page.locator("#root")).not.toBeEmpty()

  expect(pageErrors, `page errors: ${pageErrors.join("; ")}`).toEqual([])

  expect(consoleErrors, `console errors: ${consoleErrors.join("; ")}`).toEqual([])
})
