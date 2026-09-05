import { afterEach, describe, expect, test } from "bun:test"
import type { TimerPort } from "../ports/timerPort"
import { MOTION_DURATION } from "../lib/motion"
import { selectIsAnySpawning, selectIsSpawning, useNewSessionStore } from "./newSessionStore"

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
    const timer = controllableTimer()
    useNewSessionStore.getState().markSpawned("chat-a", timer.port)
    expect(selectIsAnySpawning(useNewSessionStore.getState())).toBe(true)

    timer.runAll()
    expect(selectIsAnySpawning(useNewSessionStore.getState())).toBe(false)
  })

  test("a second spawn supersedes the first and cancels its clear", () => {
    const timer = controllableTimer()
    useNewSessionStore.getState().markSpawned("chat-a", timer.port)
    useNewSessionStore.getState().markSpawned("chat-b", timer.port)

    expect(selectIsSpawning("chat-b")(useNewSessionStore.getState())).toBe(true)
    expect(selectIsSpawning("chat-a")(useNewSessionStore.getState())).toBe(false)
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
    expect(MOTION_DURATION.sequence).toBe(860)
  })
})
