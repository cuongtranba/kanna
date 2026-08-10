import { describe, expect, test } from "bun:test"
import { PausableTimeout } from "./subagent-orchestrator"

/**
 * The idle-watchdog invariant used to be covered only by an orchestrator test
 * that burned real wall-clock against a 900 ms budget and then asserted the
 * timer had fired by a fixed deadline. Under full-suite load the event loop
 * delays timers past that deadline, so the test failed for scheduling reasons
 * rather than logic ones — it flaked 2 runs in 3, and widening the budget 4x
 * did not fix it.
 *
 * Every `PausableTimeout` method already accepts `now`, so the arithmetic that
 * actually encodes the invariant is testable with an injected clock and no
 * timers at all. These tests own the logic; the orchestrator test is left to
 * prove only the wiring.
 */
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
    // The bug this guards: a chunk streaming in during an approval gate used to
    // re-arm the full window, so a hung run got a fresh deadline for free.
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
    // Still the original window — resume must not behave like reset.
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
