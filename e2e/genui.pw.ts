import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { bootKanna, type KannaBoot } from "./boot"
import { SESSION_ID, seedGenUIReport } from "./genui-fixture"

const REPORT = "FY2026 revenue report"
const CODING = "Invoice rounding fix"
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
const DESKTOP = { width: 1440, height: 2600 }
const PHONE = { width: 390, height: 3400 }
const SNAPSHOT = { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.01 } as const

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

async function openView(page: Page, name: string): Promise<Locator> {
  if (!boot) throw new Error("boot failed")
  await page.goto(boot.baseUrl)
  await page.waitForSelector("[data-sidebar]", { state: "attached" })
  chatId ??= await importSession(page)
  await page.goto(`${boot.baseUrl}/chat/${chatId}`)
  const view = page.getByRole("region", { name, exact: true })
  await expect(async () => {
    await view.scrollIntoViewIfNeeded({ timeout: 1_000 })
    await expect(view).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  return view
}

async function openReady(page: Page, name: string): Promise<Locator> {
  const view = await openView(page, name)
  if (name === REPORT) {
    await expect(view.getByRole("img").first()).toBeVisible({ timeout: 20_000 })
    await expect(view.getByText("Gross profit")).toBeVisible()
  }
  return view
}

async function tabTo(page: Page, target: Locator, key: "Tab" | "Shift+Tab" = "Tab", limit = 80): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    await page.keyboard.press(key)
    if (await target.evaluate((element) => element === document.activeElement)) return
  }
  throw new Error(`${key} never reached the target after ${limit} presses`)
}

async function revealLatest(page: Page, text: string): Promise<void> {
  const target = page.getByText(text).first()
  await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2)
  await expect(async () => {
    await page.mouse.wheel(0, 4_000)
    await expect(target).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 20_000 })
}

async function expectMatchesBaseline(target: Locator, name: string): Promise<void> {
  await target.evaluate((element) => element.scrollIntoView({ block: "start" }))
  await expect(target).toHaveScreenshot(name, SNAPSHOT)
}

async function expectVisibleFocus(target: Locator): Promise<void> {
  const ring = await target.evaluate((element) => {
    const style = getComputedStyle(element)
    return { outline: style.outlineStyle !== "none" && style.outlineWidth !== "0px", shadow: style.boxShadow !== "none" }
  })
  expect(ring.outline || ring.shadow).toBe(true)
}

async function expectNoAxeViolations(page: Page, name: string): Promise<void> {
  const results = await new AxeBuilder({ page }).include(`section[aria-label="${name}"]`).withTags(WCAG_AA).analyze()
  expect(results.passes.length).toBeGreaterThan(0)
  expect(results.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(" ")) }))).toEqual([])
}

test("renders the report from workspace files, with charts drawn on canvas", async ({ page }) => {
  const report = await openReady(page, REPORT)
  await expect(report.getByText("August revenue")).toBeVisible()
  await expect(report.locator("canvas").first()).toBeVisible({ timeout: 20_000 })
  await expect(report.getByText("Income statement")).toBeVisible()
})

test("drills down and updates the chart without involving the agent", async ({ page }) => {
  const report = await openReady(page, REPORT)
  await report.getByRole("button", { name: "Break down August by customer" }).click()
  await expect(report.getByText("by customer").first()).toBeVisible()
  await report.getByRole("button", { name: "Table" }).first().click()
  await expect(report.getByRole("rowheader", { name: "Acme" }).first()).toBeVisible()
})

test("Explain variance sends the agent a message carrying the view's structured context", async ({ page }) => {
  const report = await openReady(page, REPORT)
  await report.getByRole("button", { name: "Explain variance" }).click()
  await report.getByRole("group", { name: "Send to the agent" }).getByRole("button", { name: "Send" }).click()
  await revealLatest(page, "Variance explanation request from a report")
})

test("a keyboard alone can change the period, read a chart as a table, drill in, and ask the agent", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  const report = await openReady(page, REPORT)
  const trend = report.getByRole("figure", { name: "Revenue", exact: true })
  await page.getByText("Here is the revenue report.").click()

  const period = report.getByRole("combobox").first()
  await tabTo(page, period)
  await expectVisibleFocus(period)
  await page.keyboard.press("Enter")
  const lastThreeMonths = page.getByRole("option", { name: "Last 3 months" })
  await page.keyboard.type("Last 3")
  await expect.poll(() => lastThreeMonths.evaluate((element) => element === document.activeElement)).toBe(true)
  await page.keyboard.press("Enter")
  await expect(period).toContainText("Last 3 months")

  const tableToggle = trend.getByRole("button", { name: "Table" })
  await tabTo(page, tableToggle)
  await expectVisibleFocus(tableToggle)
  await page.keyboard.press("Enter")
  await expect(tableToggle).toHaveAttribute("aria-pressed", "true")

  const drillRow = trend.getByRole("button", { name: "Break down Aug 2026 by customer" })
  await tabTo(page, drillRow)
  await expectVisibleFocus(drillRow)
  await page.keyboard.press("Enter")
  const back = trend.getByRole("button", { name: "Back" })
  await expect(back).toBeFocused()
  await expectVisibleFocus(back)
  await page.keyboard.press("Enter")
  await expect(trend).toBeFocused()

  const explain = trend.getByRole("button", { name: "Explain variance" })
  await tabTo(page, explain)
  await page.keyboard.press("Enter")
  const send = report.getByRole("group", { name: "Send to the agent" }).getByRole("button", { name: "Send" })
  await tabTo(page, send)
  await expectVisibleFocus(send)
})

test("the coding task and test result views render and offer their actions", async ({ page }) => {
  const coding = await openReady(page, CODING)
  await expect(coding.getByRole("region", { name: "Task: fix invoice rounding" }).getByText("Needs review")).toBeVisible()
  await expect(coding.getByText("src/billing/round.ts")).toBeVisible()
  await expect(coding.getByText("'legacyRound' is declared but its value is never read")).toBeVisible()
  const tests = coding.getByRole("region", { name: "Test run" })
  await expect(tests.getByText("rounds half-cent totals")).toBeVisible()
  await expect(tests.getByRole("button", { name: "Ask the agent to fix rounds half-cent totals" })).toBeVisible()
})

for (const theme of ["light", "dark"] as const) {
  test(`generated views have no WCAG 2.1 AA violations in the ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize(DESKTOP)
    await openReady(page, REPORT)
    await expectNoAxeViolations(page, REPORT)
    await openReady(page, CODING)
    await expectNoAxeViolations(page, CODING)
  })

  test(`generated views match their baselines in the ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize(DESKTOP)
    const coding = await openReady(page, CODING)
    await expectMatchesBaseline(coding.getByRole("region", { name: "Task: fix invoice rounding" }), `coding-task-${theme}.png`)
    await expectMatchesBaseline(coding.getByRole("region", { name: "Test run" }), `test-result-${theme}.png`)

    const report = await openReady(page, REPORT)
    await expectMatchesBaseline(report.getByRole("region", { name: "Headline metrics" }), `kpi-dashboard-${theme}.png`)
    const trend = report.getByRole("figure", { name: "Revenue", exact: true })
    await expectMatchesBaseline(trend, `time-series-${theme}.png`)
    await expectMatchesBaseline(report.getByRole("figure", { name: "EBITDA bridge" }), `waterfall-${theme}.png`)
    await expectMatchesBaseline(report.getByRole("figure", { name: "Income statement" }), `financial-table-${theme}.png`)
    await expectMatchesBaseline(report, `report-${theme}.png`)

    await report.getByRole("button", { name: "Break down August by customer" }).click()
    await expect(trend.getByRole("button", { name: "Back" })).toBeVisible()
    await expect(trend.getByRole("img")).toBeVisible()
    await expectMatchesBaseline(trend, `drilldown-${theme}.png`)
  })
}

test("generated views match their baselines on a phone-width viewport", async ({ page }) => {
  await page.setViewportSize(PHONE)
  await expectMatchesBaseline(await openReady(page, REPORT), "report-mobile.png")
  await expectMatchesBaseline(await openReady(page, CODING), "coding-mobile.png")
})
