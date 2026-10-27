import { expect, test } from "vite-plus/test"
import { startProcessVitalsSampler } from "./process-vitals-sampler.adapter"

const WARM_UP_TICKS = 3
const BLOCK_MS = 150

function nextTick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function blockEventLoop(ms: number): void {
  const until = performance.now() + ms
  while (performance.now() < until) {
    continue
  }
}

test.skipIf(process.platform === "win32")(
  "reports a blocked event loop and the resident memory of a spawned child process",
  async () => {
    const sampler = startProcessVitalsSampler({ intervalMs: 3_600_000 })
    const child = Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    try {
      for (let tick = 0; tick < WARM_UP_TICKS; tick++) await nextTick(30)
      blockEventLoop(BLOCK_MS)
      await nextTick(30)

      const vitals = await sampler.sample()

      expect(vitals.eventLoop?.maxMs ?? 0).toBeGreaterThanOrEqual(100)
      const others = vitals.children?.find((usage) => usage.kind === "other")
      expect(others?.rssBytes ?? 0).toBeGreaterThan(0)
      expect(others?.count ?? 0).toBeGreaterThanOrEqual(1)
      expect(sampler.latest()).toEqual(vitals)
    } finally {
      child.kill()
      sampler.stop()
    }
  },
  30_000,
)
