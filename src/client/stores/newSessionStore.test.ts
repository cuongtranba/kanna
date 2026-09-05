import { afterEach, describe, expect, test } from "bun:test"
import type { TimerPort } from "../ports/timerPort"
import { MOTION_DURATION } from "../lib/motion"
import { selectIsAnySpawning, selectIsSpawning, useNewSessionStore } from "./newSessionStore"

/**
 * A timer whose pending callbacks fire only when the test says so, so the
 * clearing behaviour can be asserted without waiting 860ms of real time.
 */
function controllableTimer() {
  const pending = new Map<number, () => void>()
  let nextId = 1

  const timer: Pick<TimerPort, "setTimeout" | "clearTimeout"> = {
    setTimeout: (handler: () => void, _ms?: number) => {
      const id = nextId++
      pending.set(id, handler)
      return id
    },
    clearTimeout: (id?: number) => {
      if (id !== undefined) pending.delete(id)
    },
  }

  return {
    port: timer as TimerPort,
    runAll() {
      for (const handler of [...pending.values()]) handler()
      pending.clear()
    },
    pendingCount: () => pending.size,
  }
}

afterEach(() => {
  useNewSessionStore.setState({ spawnedChatId: null })
})

describe("newSessionStore", () => {
  test("marking a spawn makes exactly that chat the arriving one", () => {
    const timer = controllableTimer()
    useNewSessionStore.getState().markSpawned("chat-a", timer.port)

    const state = useNewSessionStore.getState()
    expect(selectIsSpawning("chat-a")(state)).toBe(true)
    expect(selectIsSpawning("chat-b")(state)).toBe(false)
    expect(selectIsAnySpawning(state)).toBe(true)
  })

  test("a null chat id is never spawning", () => {
    const timer = controllableTimer()
    useNewSessionStore.getState().markSpawned("chat-a", timer.port)
    expect(selectIsSpawning(null)(useNewSessionStore.getState())).toBe(false)
  })

  test("the flag clears itself, so the next spawn is a fresh arrival", () => {
    // A CSS animation plays on class arrival and would never play again while
    // the class stayed. Clearing is what makes the sentence repeatable.
    const timer = controllableTimer()
    useNewSessionStore.getState().markSpawned("chat-a", timer.port)
    expect(selectIsAnySpawning(useNewSessionStore.getState())).toBe(true)

    timer.runAll()
    expect(selectIsAnySpawning(useNewSessionStore.getState())).toBe(false)
  })

  test("a second spawn supersedes the first and cancels its clear", () => {
    // The user creating a second chat mid-transition wants the second one —
    // and the first spawn's pending clear must not later wipe it.
    const timer = controllableTimer()
    useNewSessionStore.getState().markSpawned("chat-a", timer.port)
    useNewSessionStore.getState().markSpawned("chat-b", timer.port)

    expect(selectIsSpawning("chat-b")(useNewSessionStore.getState())).toBe(true)
    expect(selectIsSpawning("chat-a")(useNewSessionStore.getState())).toBe(false)
    // Only the live spawn's clear is still armed.
    expect(timer.pendingCount()).toBe(1)

    timer.runAll()
    expect(selectIsAnySpawning(useNewSessionStore.getState())).toBe(false)
  })

  test("clearing a chat that is not the live one is a no-op", () => {
    const timer = controllableTimer()
    useNewSessionStore.getState().markSpawned("chat-a", timer.port)
    useNewSessionStore.getState().clearSpawned("chat-other")
    expect(selectIsSpawning("chat-a")(useNewSessionStore.getState())).toBe(true)
  })

  test("the sequence is the documented 860ms", () => {
    // Pins the clear against the token rather than a retyped literal: if the
    // sentence is retimed, the flag has to be retimed with it or the surfaces
    // sit at their end state after the animation has finished.
    expect(MOTION_DURATION.sequence).toBe(860)
  })
})
