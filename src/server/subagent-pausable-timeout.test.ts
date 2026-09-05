import { describe, expect, test } from "bun:test"
import { PausableTimeout } from "./subagent-orchestrator"

const noop = () => {}

describe("PausableTimeout", () => {
  test("pause records the residual instead of the full window", () => {
    const t = new PausableTimeout(900, noop)
    t.start(1_000)
    t.pause(1_500)
    expect(t.remainingMs).toBe(400)
    t.clear()
  })

  test("reset() while PAUSED is a no-op — the residual survives", () => {
    const t = new PausableTimeout(900, noop)
    t.start(1_000)
    t.pause(1_500)
    expect(t.remainingMs).toBe(400)

    t.reset(1_600)
    expect(t.remainingMs).toBe(400)
    t.clear()
  })

  test("reset() while RUNNING re-arms the full window", () => {
    const t = new PausableTimeout(900, noop)
    t.start(1_000)
    t.reset(1_400)
    expect(t.remainingMs).toBe(900)
    t.clear()
  })

  test("resume re-arms the residual, not the full window", () => {
    const t = new PausableTimeout(900, noop)
    t.start(1_000)
    t.pause(1_700)
    expect(t.remainingMs).toBe(200)
    t.resume(5_000)
    expect(t.remainingMs).toBe(200)
    t.clear()
  })

  test("a pause past the deadline clamps the residual at zero", () => {
    const t = new PausableTimeout(900, noop)
    t.start(1_000)
    t.pause(9_999)
    expect(t.remainingMs).toBe(0)
    t.clear()
  })

  test("pause is a no-op when the timer was never started", () => {
    const t = new PausableTimeout(900, noop)
    t.pause(5_000)
    expect(t.remainingMs).toBe(900)
  })

  test("resume while already running does not re-arm", () => {
    const t = new PausableTimeout(900, noop)
    t.start(1_000)
    t.resume(1_800)
    expect(t.remainingMs).toBe(900)
    t.clear()
  })

  test("fires once the window elapses", async () => {
    let fired = 0
    const t = new PausableTimeout(20, () => { fired += 1 })
    t.start()
    await new Promise((r) => setTimeout(r, 120))
    expect(fired).toBe(1)
  }, 10_000)
})
