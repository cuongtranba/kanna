import { test, expect, type CDPSession, type Page } from "@playwright/test"
import { bootKanna, type KannaBoot } from "./boot"
import { startFakeAnthropic, type FakeAnthropic } from "./perf/fake-anthropic"
import { LONG_SESSION_ID, seedLongSession } from "./perf/long-session-fixture"

const PHONE = { width: 390, height: 844 }
const SCROLLER = "[class*='scroll-pt-[72px]']"
const JUMP = "Scroll to latest message"

let boot: KannaBoot | undefined
let fake: FakeAnthropic | undefined
let chatId: string | undefined

test.use({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

test.beforeAll(async () => {
  fake = await startFakeAnthropic({ streamMs: 12_000, deltaIntervalMs: 35 })
  boot = await bootKanna({ seed: (home) => seedLongSession(home, 60) })
})

test.afterAll(async () => {
  await boot?.stop()
  await fake?.stop()
})

async function command(page: Page, id: string, body: object): Promise<string> {
  return await page.evaluate(async ({ id, body }) => await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`)
    socket.onerror = () => reject(new Error("socket failed"))
    socket.onopen = () => socket.send(JSON.stringify({ v: 1, type: "command", id, command: body }))
    socket.onmessage = (event) => {
      const envelope = JSON.parse(String(event.data))
      if (envelope.id !== id) return
      socket.close()
      resolve(JSON.stringify(envelope))
    }
  }), { id, body })
}

async function importChat(page: Page): Promise<string> {
  if (!boot || !fake) throw new Error("boot failed")
  await page.goto(boot.baseUrl)
  await page.waitForSelector("[data-sidebar]", { state: "attached" })
  const imported = JSON.parse(await command(page, "import", { type: "sessions.importClaudeSession", sessionIds: [LONG_SESSION_ID] }))
  const id = imported.result?.results?.[0]?.chatId
  if (typeof id !== "string") throw new Error(`import failed: ${JSON.stringify(imported)}`)
  await command(page, "provider", {
    type: "settings.writeAppSettingsPatch",
    patch: { customProviders: { create: { id: "fake", label: "Fake", baseUrl: fake.baseUrl, apiKey: "sk-fake-e2e", models: [{ id: "bench", label: "Bench" }] } } },
  })
  return id
}

async function openStreamingChat(page: Page, cpuThrottle = 1): Promise<CDPSession> {
  if (!boot || !fake) throw new Error("boot failed")
  chatId ??= await importChat(page)
  await page.goto(`${boot.baseUrl}/chat/${chatId}`)
  await page.waitForFunction((selector) => {
    const el = document.querySelector(selector)
    return !!el && el.scrollHeight > el.clientHeight * 2
  }, SCROLLER)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle })
  const started = fake.streamsStarted()
  await command(page, "send", { type: "chat.send", chatId, content: "Stream a long answer", provider: "custom", model: "fake/bench" })
  await expect.poll(() => fake?.streamsStarted() ?? 0, { timeout: 60_000 }).toBeGreaterThan(started)
  await page.waitForTimeout(1_500)
  return cdp
}

async function distanceFromEnd(page: Page): Promise<number> {
  return await page.evaluate((selector) => {
    const el = document.querySelector(selector)
    return el ? el.scrollHeight - el.clientHeight - el.scrollTop : -1
  }, SCROLLER)
}

test("streaming output never moves the text a reader has scrolled up to", async ({ page }) => {
  const cdp = await openStreamingChat(page)
  await cdp.send("Input.synthesizeScrollGesture", { x: PHONE.width / 2, y: 460, yDistance: 900, speed: 2_000, gestureSourceType: "touch" })
  await page.waitForTimeout(600)

  const before = await page.evaluate((selector) => {
    const scroller = document.querySelector(selector)
    if (!scroller) return null
    const box = scroller.getBoundingClientRect()
    const el = document.elementFromPoint(box.left + box.width / 2, box.top + box.height * 0.4)
    if (!el || el === scroller) return null
    el.setAttribute("data-e2e-anchor", "")
    return el.getBoundingClientRect().top
  }, SCROLLER)
  expect(before).not.toBeNull()

  await page.waitForTimeout(3_000)
  const after = await page.locator("[data-e2e-anchor]").evaluate((el) => el.getBoundingClientRect().top)

  expect(Math.abs(after - (before ?? 0))).toBeLessThanOrEqual(1)
  await expect(page.getByRole("button", { name: JUMP })).toBeVisible()
})

test("streaming at the bottom keeps following without offering a jump to latest", async ({ page }) => {
  await openStreamingChat(page, 6)
  await page.evaluate((selector) => {
    const el = document.querySelector(selector)
    if (el) el.scrollTop = el.scrollHeight
  }, SCROLLER)
  await page.waitForTimeout(500)

  const jumpShown = await page.evaluate(async (label) => await new Promise<boolean>((resolve) => {
    const until = performance.now() + 3_000
    const tick = () => {
      const wrapper = document.querySelector(`button[aria-label="${label}"]`)?.parentElement
      if (wrapper?.classList.contains("opacity-100")) return resolve(true)
      if (performance.now() > until) return resolve(false)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }), JUMP)

  expect(jumpShown).toBe(false)
  await expect.poll(() => distanceFromEnd(page), { timeout: 30_000 }).toBeLessThanOrEqual(4)
})
