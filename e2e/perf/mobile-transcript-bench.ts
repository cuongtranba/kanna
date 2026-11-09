import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { chromium, type CDPSession, type Page } from "@playwright/test"
import { bootKanna, type KannaBoot } from "../boot"
import { startFakeAnthropic, type FakeAnthropic } from "./fake-anthropic"
import { LONG_SESSION_ID, seedLongSession } from "./long-session-fixture"

const args = process.argv.slice(2)
function arg(name: string, fallback: string): string {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const TURNS = Number(arg("turns", "300"))
const CPU_RATE = Number(arg("cpu", "4"))
const LABEL = arg("label", "run")
const HEADLESS = arg("headless", "true") === "true"
const DSF = Number(arg("dsf", "3"))
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".output", "perf")
const PHONE = { width: 390, height: 844 }
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const PREPEND_FLINGS = Number(arg("prepend-flings", "30"))
const SCROLLER = "[class*='scroll-pt-[72px]']"

const COLLECTOR = `
window.__bench = (() => {
  let rec = null
  const loop = (t) => {
    if (rec) {
      if (rec.last) rec.frames.push(t - rec.last)
      rec.last = t
      const scroller = document.querySelector(${JSON.stringify(SCROLLER)})
      if (scroller) {
        const distance = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
        rec.maxDistanceFromEnd = Math.max(rec.maxDistanceFromEnd, distance)
        rec.distanceSamples.push(distance)
      }
      if (scroller) {
        const content = scroller.querySelector(":scope > .legend-list-content-container")
        const vb = scroller.getBoundingClientRect()
        let blank = 0
        for (const fy of [0.15, 0.3, 0.5, 0.7, 0.85]) {
          const hit = document.elementFromPoint(vb.left + vb.width / 2, vb.top + vb.height * fy)
          if (hit === content || hit === scroller) blank++
        }
        if (blank > 0) rec.blankFrames++
      }
      const jump = document.querySelector('button[aria-label="Scroll to latest message"]')
      if (jump && jump.parentElement && jump.parentElement.classList.contains("opacity-100")) rec.jumpButtonFrames++
      if (rec.anchor && rec.anchor.isConnected) {
        const top = rec.anchor.getBoundingClientRect().top
        const drift = top - rec.anchorTop
        rec.maxAnchorDrift = Math.max(rec.maxAnchorDrift, Math.abs(drift))
        if (Math.abs(top - rec.lastAnchorTop) > 2) rec.anchorJumps++
        rec.lastAnchorTop = top
      } else if (rec.anchor) {
        rec.anchorLost = true
      }
      const box = scroller ? scroller.getBoundingClientRect() : null
      const prevTop = rec.lastScrollTop
      const prevHeight = rec.lastScrollHeight
      const tracked = rec.motionAnchor
      const trackedTop = tracked && tracked.isConnected ? tracked.getBoundingClientRect().top : null
      if (box && trackedTop !== null && trackedTop > box.top + 40 && trackedTop < box.bottom - 120) {
        const doc = trackedTop - box.top + scroller.scrollTop
        rec.motion.push(trackedTop - rec.motionTop)
        rec.docMotion.push(doc - rec.motionDoc)
        rec.ctx.push([Math.round(scroller.scrollTop - rec.lastScrollTop), Math.round(scroller.scrollHeight - rec.lastScrollHeight)])
        rec.motionTop = trackedTop
        rec.motionDoc = doc
        rec.lastScrollTop = scroller.scrollTop
        rec.lastScrollHeight = scroller.scrollHeight
      } else {
        rec.motion.push(null)
        rec.docMotion.push(null)
        rec.ctx.push(null)
        rec.motionAnchor = pickAnchor()
        rec.motionTop = rec.motionAnchor ? rec.motionAnchor.getBoundingClientRect().top : 0
        rec.motionDoc = box ? rec.motionTop - box.top + scroller.scrollTop : 0
        if (scroller) { rec.lastScrollTop = scroller.scrollTop; rec.lastScrollHeight = scroller.scrollHeight }
      }
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  try {
    new PerformanceObserver((list) => { if (rec) for (const e of list.getEntries()) rec.longTasks.push(e.duration) }).observe({ type: "longtask" })
  } catch {}
  try {
    new PerformanceObserver((list) => { if (rec) for (const e of list.getEntries()) if (!e.hadRecentInput) rec.layoutShift += e.value }).observe({ type: "layout-shift" })
  } catch {}
  function pickAnchor() {
    const scroller = document.querySelector(${JSON.stringify(SCROLLER)})
    if (!scroller) return null
    const box = scroller.getBoundingClientRect()
    for (const y of [0.35, 0.45, 0.55, 0.25]) {
      const el = document.elementFromPoint(box.left + box.width / 2, box.top + box.height * y)
      if (el && el !== scroller && scroller.contains(el)) return el
    }
    return null
  }
  const api = {
    begin(withAnchor) {
      const anchor = withAnchor ? pickAnchor() : null
      const top = anchor ? anchor.getBoundingClientRect().top : 0
      rec = { frames: [], longTasks: [], layoutShift: 0, last: 0, start: performance.now(), maxDistanceFromEnd: 0, distanceSamples: [], anchor, anchorTop: top, lastAnchorTop: top, maxAnchorDrift: 0, anchorJumps: 0, anchorLost: false, motion: [], docMotion: [], ctx: [], lastScrollTop: 0, lastScrollHeight: 0, jumpButtonFrames: 0, blankFrames: 0, motionAnchor: null, motionTop: 0, motionDoc: 0 }
      return !!anchor
    },
    end() {
      const r = rec
      rec = null
      r.duration = performance.now() - r.start
      r.anchor = undefined
      r.motionAnchor = undefined
      return r
    },
  }
  if (sessionStorage.getItem("__benchAutoBegin")) {
    sessionStorage.removeItem("__benchAutoBegin")
    api.begin(false)
  }
  return api
})()
`

interface Recording {
  frames: number[]
  longTasks: number[]
  layoutShift: number
  duration: number
  maxDistanceFromEnd: number
  distanceSamples: number[]
  maxAnchorDrift: number
  anchorJumps: number
  anchorLost: boolean
  motion: (number | null)[]
  docMotion: (number | null)[]
  ctx: ([number, number] | null)[]
  jumpButtonFrames: number
  blankFrames: number
}

function motionDiscontinuities(motion: (number | null)[], docMotion: (number | null)[], ctx: ([number, number] | null)[] = []): { count: number; maxPx: number; samples: string[] } {
  const samples: string[] = []
  let count = 0
  let maxPx = 0
  for (let i = 2; i < motion.length - 2; i++) {
    const d = motion[i]
    const docShift = docMotion[i]
    if (d === null || docShift === null || Math.abs(docShift) <= 2) continue
    const neighbours = [motion[i - 2], motion[i - 1], motion[i + 1], motion[i + 2]].filter((v): v is number => v !== null)
    if (neighbours.length < 3) continue
    const sorted = [...neighbours].sort((a, b) => a - b)
    const median = (sorted[1] + sorted[sorted.length - 2]) / 2
    const deviation = Math.abs(d - median)
    const reversal = Math.abs(d) > 8 && Math.abs(median) > 4 && Math.sign(d) !== Math.sign(median)
    if (deviation > 48 || reversal) {
      if (samples.length < 12) samples.push(`d=${Math.round(d)} med=${Math.round(median)} doc=${Math.round(docShift)} scroll=${ctx[i]?.[0]} height=${ctx[i]?.[1]}`)
      count++
      maxPx = Math.max(maxPx, deviation)
    }
  }
  return { count, maxPx: Math.round(maxPx), samples }
}

interface ScenarioResult {
  scenario: string
  durationMs: number
  frames: number
  fps: number
  frameP50: number
  frameP95: number
  frameMax: number
  jankFrames: number
  severeFrames: number
  longTasks: number
  longTaskMs: number
  layoutCount: number
  recalcStyleCount: number
  layoutMs: number
  scriptMs: number
  layoutShift: number
  extra: { [key: string]: number | string | boolean }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

async function cdpMetrics(cdp: CDPSession): Promise<Map<string, number>> {
  const { metrics } = await cdp.send("Performance.getMetrics")
  return new Map(metrics.map((m) => [m.name, m.value]))
}

async function measure(
  page: Page,
  cdp: CDPSession,
  scenario: string,
  withAnchor: boolean | "auto",
  run: () => Promise<{ [key: string]: number | string | boolean } | void>,
): Promise<ScenarioResult> {
  const before = await cdpMetrics(cdp)
  const anchored = withAnchor === "auto" ? false : await page.evaluate((a) => window.__bench.begin(a), withAnchor)
  const extra = (await run()) ?? {}
  const rec: Recording = await page.evaluate(() => window.__bench.end())
  const after = await cdpMetrics(cdp)
  const delta = (name: string) => (after.get(name) ?? 0) - (before.get(name) ?? 0)
  const result: ScenarioResult = {
    scenario,
    durationMs: Math.round(rec.duration),
    frames: rec.frames.length,
    fps: round((rec.frames.length / rec.duration) * 1000),
    frameP50: round(percentile(rec.frames, 50)),
    frameP95: round(percentile(rec.frames, 95)),
    frameMax: round(Math.max(0, ...rec.frames)),
    jankFrames: rec.frames.filter((f) => f > 25).length,
    severeFrames: rec.frames.filter((f) => f > 50).length,
    longTasks: rec.longTasks.length,
    longTaskMs: Math.round(rec.longTasks.reduce((a, b) => a + b, 0)),
    layoutCount: delta("LayoutCount"),
    recalcStyleCount: delta("RecalcStyleCount"),
    layoutMs: Math.round(delta("LayoutDuration") * 1000),
    scriptMs: Math.round(delta("ScriptDuration") * 1000),
    layoutShift: round(rec.layoutShift * 1000) / 1000,
    extra: { ...extra },
  }
  if (withAnchor === true) {
    result.extra.anchored = anchored
    result.extra.maxAnchorDriftPx = round(rec.maxAnchorDrift)
    result.extra.anchorJumps = rec.anchorJumps
    result.extra.anchorLost = rec.anchorLost
  }
  result.extra.maxDistanceFromEndPx = round(rec.maxDistanceFromEnd)
  result.extra.p95DistanceFromEndPx = round(percentile(rec.distanceSamples, 95))
  result.extra.framesBeyond24pxFromEnd = rec.distanceSamples.filter((d) => d > 24).length
  result.extra.jumpButtonFrames = rec.jumpButtonFrames
  result.extra.blankFrames = rec.blankFrames
  const jumps = motionDiscontinuities(rec.motion, rec.docMotion, rec.ctx)
  if (jumps.samples.length > 0) result.extra.jumpSamples = jumps.samples.join(" | ")
  result.extra.motionJumps = jumps.count
  result.extra.motionJumpMaxPx = jumps.maxPx
  return result
}

async function wsCommand(page: Page, id: string, command: object): Promise<string> {
  return await page.evaluate(async ({ id, command }) => await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`)
    socket.onerror = () => reject(new Error("socket failed"))
    socket.onopen = () => socket.send(JSON.stringify({ v: 1, type: "command", id, command }))
    socket.onmessage = (event) => {
      const envelope = JSON.parse(String(event.data))
      if (envelope.id !== id) return
      socket.close()
      resolve(JSON.stringify(envelope))
    }
  }), { id, command })
}

async function fling(cdp: CDPSession, yDistance: number, speed = 4000): Promise<void> {
  await cdp.send("Input.synthesizeScrollGesture", {
    x: PHONE.width / 2,
    y: Math.round(PHONE.height * 0.55),
    yDistance,
    speed,
    gestureSourceType: "touch",
  })
}

async function scrollerState(page: Page): Promise<{ top: number; height: number; client: number }> {
  return await page.evaluate((selector) => {
    const el = document.querySelector(selector)
    if (!el) return { top: -1, height: -1, client: -1 }
    return { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }
  }, SCROLLER)
}

async function waitForScroller(page: Page): Promise<void> {
  await page.waitForFunction((selector) => {
    const el = document.querySelector(selector)
    return !!el && el.scrollHeight > el.clientHeight * 2
  }, SCROLLER, { timeout: 60_000 })
}

async function main(): Promise<void> {
  let fake: FakeAnthropic | undefined
  let boot: KannaBoot | undefined
  const browser = await chromium.launch({ channel: "chrome", headless: HEADLESS, args: ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"] })
  const results: ScenarioResult[] = []
  const notes: string[] = []
  try {
    fake = await startFakeAnthropic({ streamMs: 24_000, deltaIntervalMs: 35 })
    process.env.KANNA_IMPORT_FOLLOW_POLL_MS = "250"
    boot = await bootKanna({ seed: (home) => seedLongSession(home, TURNS) })
    const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: DSF, isMobile: true, hasTouch: true, userAgent: IPHONE_UA })
    await context.addInitScript(COLLECTOR)
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(String(error)))
    await page.goto(boot.baseUrl)
    await page.waitForSelector("[data-sidebar]", { state: "attached", timeout: 60_000 })
    const imported = JSON.parse(await wsCommand(page, "import", { type: "sessions.importClaudeSession", sessionIds: [LONG_SESSION_ID] }))
    const chatId = imported.result?.results?.[0]?.chatId
    if (typeof chatId !== "string") throw new Error(`import failed: ${JSON.stringify(imported)}`)
    const patched = await wsCommand(page, "provider", {
      type: "settings.writeAppSettingsPatch",
      patch: { customProviders: { create: { id: "fake", label: "Fake", baseUrl: fake.baseUrl, apiKey: "sk-fake-bench", models: [{ id: "bench", label: "Bench" }] } } },
    })
    if (!patched.includes("\"fake\"")) notes.push(`provider patch: ${patched.slice(0, 300)}`)

    const cdp = await context.newCDPSession(page)
    await cdp.send("Performance.enable")
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE })

    results.push(await measure(page, cdp, "open-long-chat", "auto", async () => {
      await page.evaluate(() => sessionStorage.setItem("__benchAutoBegin", "1"))
      const t0 = Date.now()
      await page.goto(`${boot!.baseUrl}/chat/${chatId}`)
      await waitForScroller(page)
      const visibleMs = Date.now() - t0
      await sleep(3_000)
      const state = await scrollerState(page)
      return { timeToTranscriptMs: visibleMs, settledDistanceFromEndPx: round(state.height - state.client - state.top) }
    }))

    results.push(await measure(page, cdp, "idle-control", false, async () => {
      await sleep(3_000)
      return {}
    }))

    results.push(await measure(page, cdp, "fling-up-down", false, async () => {
      for (let i = 0; i < 3; i++) await fling(cdp, 2_500)
      await sleep(800)
      for (let i = 0; i < 3; i++) await fling(cdp, -2_500)
      await sleep(800)
      return {}
    }))

    await page.evaluate((selector) => {
      const el = document.querySelector(selector)
      if (el) el.scrollTop = el.scrollHeight
    }, SCROLLER)
    await sleep(1_000)

    const sent = await wsCommand(page, "send", { type: "chat.send", chatId, content: "Stream a long answer", provider: "custom", model: "fake/bench" })
    if (!sent.includes("\"ok\"") && sent.includes("error")) notes.push(`chat.send: ${sent.slice(0, 400)}`)
    const streamStart = Date.now()
    while (fake.streamsStarted() === 0 && Date.now() - streamStart < 60_000) await sleep(200)
    const streaming = fake.streamsStarted() > 0
    if (!streaming) notes.push("streaming never started; stream scenarios skipped")

    if (streaming) {
      await sleep(1_500)
      results.push(await measure(page, cdp, "stream-at-bottom", false, async () => {
        await sleep(6_000)
        const state = await scrollerState(page)
        return { endDistanceFromEndPx: round(state.height - state.client - state.top) }
      }))

      await fling(cdp, 1_200, 2_500)
      await sleep(700)
      results.push(await measure(page, cdp, "stream-scrolled-away", true, async () => {
        const startTop = (await scrollerState(page)).top
        await sleep(6_000)
        const state = await scrollerState(page)
        const button = await page.getByRole("button", { name: "Scroll to latest message" }).isVisible()
        return { scrollTopDeltaPx: round(state.top - startTop), jumpToLatestVisible: button }
      }))

      results.push(await measure(page, cdp, "drag-while-streaming", false, async () => {
        for (let i = 0; i < 4; i++) {
          await fling(cdp, 700, 1_800)
          await fling(cdp, -500, 1_800)
        }
        return {}
      }))

      const waitEnd = Date.now()
      while (Date.now() - waitEnd < 40_000) {
        const busy = await page.locator("[data-live-turn], [aria-label='Stop']").count()
        if (busy === 0) break
        await sleep(500)
      }
    }

    let prependJumps = 0
    let prependMaxDrift = 0
    let historyLoads = 0
    let flings = 0
    results.push(await measure(page, cdp, "prepend-history", false, async () => {
      while (flings < PREPEND_FLINGS) {
        await fling(cdp, 4_000, 6_000)
        flings++
        await sleep(250)
        const loading = await page.getByText("Loading more messages...").count()
        if (loading > 0) historyLoads++
        const probed = await page.evaluate((selector) => {
          const scroller = document.querySelector(selector)
          if (!scroller) return false
          const box = scroller.getBoundingClientRect()
          const el = document.elementFromPoint(box.left + box.width / 2, box.top + box.height * 0.45)
          if (!el || el === scroller) return false
          window.__benchProbe = { el, top: el.getBoundingClientRect().top }
          return true
        }, SCROLLER)
        if (!probed) continue
        await sleep(900)
        const drift = await page.evaluate(() => {
          const probe = window.__benchProbe
          if (!probe || !probe.el.isConnected) return -1
          return Math.abs(probe.el.getBoundingClientRect().top - probe.top)
        })
        if (drift > 2) prependJumps++
        prependMaxDrift = Math.max(prependMaxDrift, drift)
      }
      const end = await scrollerState(page)
      return { flings, historyLoadsObserved: historyLoads, idleAnchorJumps: prependJumps, idleMaxDriftPx: round(prependMaxDrift), endScrollTop: Math.round(end.top), endScrollHeight: end.height }
    }))

    await cdp.send("HeapProfiler.collectGarbage")
    const memory = await page.evaluate(() => ({
      heapMb: Math.round(((performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1_048_576),
      domNodes: document.getElementsByTagName("*").length,
    }))
    const report = { label: LABEL, turns: TURNS, entries: TURNS * 5, cpuThrottle: CPU_RATE, viewport: PHONE, deviceScaleFactor: DSF, headless: HEADLESS, results, memory, notes, pageErrors }
    await mkdir(OUT_DIR, { recursive: true })
    const file = join(OUT_DIR, `mobile-transcript-${LABEL}.json`)
    await writeFile(file, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    console.log(`wrote ${file}`)
  } finally {
    await browser.close()
    await boot?.stop()
    await fake?.stop()
  }
}

declare global {
  interface Window {
    __bench: { begin: (withAnchor: boolean) => boolean; end: () => Recording }
    __benchProbe?: { el: Element; top: number }
  }
}

await main()
