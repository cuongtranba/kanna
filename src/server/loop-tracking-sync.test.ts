import { describe, expect, test } from "bun:test"
import type { AutoContinueEvent } from "./auto-continue/events"
import { rehydrateLoopTracking, syncLoopTracking } from "./loop-tracking-sync"

function armed(overrides: Partial<Extract<AutoContinueEvent, { kind: "loop_armed" }>> = {}): AutoContinueEvent {
  return {
    kind: "loop_armed",
    chatId: "c1",
    timestamp: 1_000,
    subagentId: "sa-1",
    prompt: "Do the next chunk",
    verifyCommand: "bun run lint",
    workdirAbs: "/repo/worktree",
    trackingFileRel: "PROGRESS.md",
    ...overrides,
  } as AutoContinueEvent
}

function disarmed(chatId = "c1"): AutoContinueEvent {
  return { kind: "loop_disarmed", chatId, timestamp: 2_000, reason: "goal_met" } as AutoContinueEvent
}

interface Harness {
  deps: Parameters<typeof syncLoopTracking>[0]
  registered: Array<[string, string]>
  unregistered: string[]
}

function harness(eventsByChat: Record<string, AutoContinueEvent[]>): Harness {
  const registered: Array<[string, string]> = []
  const unregistered: string[] = []
  return {
    registered,
    unregistered,
    deps: {
      getAutoContinueEvents: (chatId) => eventsByChat[chatId] ?? [],
      registry: {
        register: (chatId, abs) => registered.push([chatId, abs]),
        unregister: (chatId) => unregistered.push(chatId),
      },
    },
  }
}

describe("syncLoopTracking", () => {
  test("an armed loop watches its tracking file, resolved against the loop's workdir", () => {
    const h = harness({ c1: [armed()] })
    syncLoopTracking(h.deps, "c1")
    expect(h.registered).toEqual([["c1", "/repo/worktree/PROGRESS.md"]])
    expect(h.unregistered).toEqual([])
  })

  test("a disarmed loop stops the watch", () => {
    const h = harness({ c1: [armed(), disarmed()] })
    syncLoopTracking(h.deps, "c1")
    expect(h.registered).toEqual([])
    expect(h.unregistered).toEqual(["c1"])
  })

  test("re-arming in a different worktree follows the new tracking file", () => {
    const h = harness({
      c1: [armed(), disarmed(), armed({ timestamp: 3_000, workdirAbs: "/repo/other", trackingFileRel: "PLAN.md" })],
    })
    syncLoopTracking(h.deps, "c1")
    expect(h.registered).toEqual([["c1", "/repo/other/PLAN.md"]])
  })

  test("a loop armed before tracking files were recorded watches nothing", () => {
    const h = harness({ c1: [armed({ workdirAbs: undefined, trackingFileRel: undefined })] })
    syncLoopTracking(h.deps, "c1")
    expect(h.registered).toEqual([])
    expect(h.unregistered).toEqual(["c1"])
  })

  test("a tracking path escaping the workdir is refused, not followed", () => {
    const h = harness({ c1: [armed({ trackingFileRel: "../outside.md" })] })
    syncLoopTracking(h.deps, "c1")
    expect(h.registered).toEqual([])
    expect(h.unregistered).toEqual(["c1"])
  })
})

describe("rehydrateLoopTracking", () => {
  test("re-arms the watch for armed chats only, so a restart keeps the panel live", () => {
    const h = harness({
      armedChat: [armed({ chatId: "armedChat" })],
      finishedChat: [armed({ chatId: "finishedChat" }), disarmed("finishedChat")],
    })
    rehydrateLoopTracking(h.deps, ["armedChat", "finishedChat"])
    expect(h.registered).toEqual([["armedChat", "/repo/worktree/PROGRESS.md"]])
    expect(h.unregistered).toEqual(["finishedChat"])
  })
})
