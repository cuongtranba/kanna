/**
 * Tests for the armed-loop wake invariant — an ARMED loop always holds exactly
 * one pending wake. Covers both windows that can drop it: the boot pass
 * (`recoverArmedLoopWakes`) and the runtime pass (`handleFailedLoopTurn`).
 */

import { describe, test, expect } from "bun:test"
import type { AutoContinueEvent } from "./auto-continue/events"
import { AUTO_CONTINUE_EVENT_VERSION } from "./auto-continue/events"
import { MAX_CONSECUTIVE_LOOP_FAILURES, type LoopCommandDeps } from "./claude-loop-commands"
import { handleFailedLoopTurn, recoverArmedLoopWakes, resumeLoop } from "./loop-wake-recovery"
import { armedLoop, makeDeps, makeStore } from "./test-helpers/loop-command-fakes"

describe("recoverArmedLoopWakes", () => {
  test("re-emits the wake for an armed chat left with nothing to wake it", async () => {
    const store = makeStore()
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (event) => { emitted.push(event) },
      isLoopArmed: () => armedLoop(),
    })

    const recovered = await recoverArmedLoopWakes(deps)

    expect(recovered).toEqual(["chat-1"])
    expect(store.sessionTokensSet).toEqual([{ chatId: "chat-1", provider: "claude", token: null }])
    expect(store.messages.map((m) => m.entry.kind)).toEqual(["context_cleared"])
    expect(emitted).toHaveLength(1)
    const event = emitted[0]
    if (event.kind !== "auto_continue_accepted") throw new Error("expected accepted event")
    expect(event.source).toBe("subagent_background")
    expect(event.prompt).toContain("ORCHESTRATOR loop prompt")
    expect(event.prompt).toContain("restart")
  })

  test("does nothing for a chat with no armed loop", async () => {
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({ emitAutoContinueEvent: async (e) => { emitted.push(e) } })
    expect(await recoverArmedLoopWakes(deps)).toEqual([])
    expect(emitted).toEqual([])
  })

  test("leaves a chat whose queued message survived to the queue recovery", async () => {
    const store = makeStore()
    store.queuedByChat.set("chat-1", [{ id: "qm-1" }])
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (e) => { emitted.push(e) },
      isLoopArmed: () => armedLoop(),
    })
    expect(await recoverArmedLoopWakes(deps)).toEqual([])
    expect(emitted).toEqual([])
  })

  test("leaves a chat that is already busy", async () => {
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      emitAutoContinueEvent: async (e) => { emitted.push(e) },
      isLoopArmed: () => armedLoop(),
      isChatBusy: () => true,
    })
    expect(await recoverArmedLoopWakes(deps)).toEqual([])
    expect(emitted).toEqual([])
  })

  test("one failing chat does not abort the rest", async () => {
    const store = makeStore()
    store.chats.set("chat-2", { id: "chat-2", projectId: "proj-1" })
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (event) => {
        if (event.chatId === "chat-1") throw new Error("append failed")
        emitted.push(event)
      },
      isLoopArmed: () => armedLoop(),
    })
    expect(await recoverArmedLoopWakes(deps)).toEqual(["chat-2"])
    expect(emitted.map((e) => e.chatId)).toEqual(["chat-2"])
  })

  // Boot recovery must IGNORE the running-subagent guard that the runtime path
  // relies on: a run killed with the server never wrote a terminal event, so it
  // replays as `running` forever. Honouring it here would re-break the exact
  // incident this recovery exists for (chat c87ab0ad).
  test("recovers a chat whose subagent run is stuck in `running` after a crash", async () => {
    const store = makeStore()
    store.subagentRunsByChat.set("chat-1", { "run-1": { status: "running" } })
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (e) => { emitted.push(e) },
      isLoopArmed: () => armedLoop(),
    })
    expect(await recoverArmedLoopWakes(deps)).toEqual(["chat-1"])
    expect(emitted.some((e) => e.kind === "auto_continue_accepted")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// handleFailedLoopTurn — the runtime half of the armed-loop wake invariant
// ---------------------------------------------------------------------------

describe("handleFailedLoopTurn", () => {
  function collectDeps(overrides: Partial<LoopCommandDeps> = {}) {
    const store = makeStore()
    const emitted: AutoContinueEvent[] = []
    const pending: (() => Promise<void>)[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (event) => {
        emitted.push(event)
        store.events.push(event)
      },
      isLoopArmed: () => armedLoop(),
      ...overrides,
    })
    const schedule = (rearm: () => Promise<void>) => { pending.push(rearm) }
    return { store, emitted, pending, deps, schedule }
  }

  test("re-arms the wake an errored orchestrator turn dropped", async () => {
    const { store, emitted, pending, deps, schedule } = collectDeps()

    await handleFailedLoopTurn(deps, "chat-1", schedule)
    expect(pending).toHaveLength(1)
    await pending[0]!()

    const accepted = emitted.filter((e) => e.kind === "auto_continue_accepted")
    expect(accepted).toHaveLength(1)
    const event = accepted[0]
    if (event?.kind !== "auto_continue_accepted") throw new Error("expected accepted event")
    expect(event.source).toBe("subagent_background")
    // The full loop discipline must ride the wake, exactly as a normal
    // background delivery does — a generic "decide next action" string is what
    // drifted the orchestrator into self-implementation.
    expect(event.prompt).toContain("ORCHESTRATOR loop prompt")
    expect(event.prompt).toContain("error")
    expect(store.sessionTokensSet).toEqual([{ chatId: "chat-1", provider: "claude", token: null }])
    expect(store.messages.map((m) => m.entry.kind)).toEqual(["context_cleared"])
  })

  // Without this the runtime re-arm turns a silent stall into a silent hot
  // loop: the host backstop counts `loop_run_outcome`, and a crashing
  // orchestrator previously contributed nothing to it.
  test("records the failed iteration so the host backstop can see it", async () => {
    const { emitted, deps, schedule } = collectDeps()
    await handleFailedLoopTurn(deps, "chat-1", schedule)
    const outcome = emitted.find((e) => e.kind === "loop_run_outcome")
    if (outcome?.kind !== "loop_run_outcome") throw new Error("expected outcome event")
    expect(outcome.ok).toBe(false)
  })

  test("disarms instead of re-arming once failures reach the cap", async () => {
    const { emitted, pending, deps, schedule } = collectDeps({
      isLoopArmed: () => ({ ...armedLoop(), consecutiveFailures: MAX_CONSECUTIVE_LOOP_FAILURES - 1 }),
    })

    await handleFailedLoopTurn(deps, "chat-1", schedule)

    const disarmed = emitted.find((e) => e.kind === "loop_disarmed")
    if (disarmed?.kind !== "loop_disarmed") throw new Error("expected disarm event")
    expect(disarmed.reason).toBe("repeated_failures")
    expect(pending).toHaveLength(0)
  })

  // Runs from the store's turn-terminal observer, which EVERY provider path
  // funnels through. An escape here would break the terminal path of turns that
  // have nothing to do with a loop.
  test("never throws, whatever the store does", async () => {
    const { deps, schedule } = collectDeps({
      isLoopArmed: () => { throw new Error("store exploded") },
    })
    expect(await handleFailedLoopTurn(deps, "chat-1", schedule)).toBeUndefined()
  })

  test("does nothing when no loop is armed", async () => {
    const { emitted, pending, deps, schedule } = collectDeps({ isLoopArmed: () => null })
    await handleFailedLoopTurn(deps, "chat-1", schedule)
    expect(emitted).toEqual([])
    expect(pending).toHaveLength(0)
  })

  // Each guard below proves the wake is already held by someone else, so
  // re-arming would run two orchestrator turns against one plan.
  test("stands down when the chat became busy again", async () => {
    const { emitted, pending, deps, schedule } = collectDeps({ isChatBusy: () => true })
    await handleFailedLoopTurn(deps, "chat-1", schedule)
    await pending[0]!()
    expect(emitted.some((e) => e.kind === "auto_continue_accepted")).toBe(false)
  })

  test("stands down when a queued message already holds the wake", async () => {
    const { store, emitted, pending, deps, schedule } = collectDeps()
    store.queuedByChat.set("chat-1", [{ id: "qm-1" }])
    await handleFailedLoopTurn(deps, "chat-1", schedule)
    await pending[0]!()
    expect(emitted.some((e) => e.kind === "auto_continue_accepted")).toBe(false)
  })

  test("stands down while a background subagent is still running", async () => {
    const { store, emitted, pending, deps, schedule } = collectDeps()
    store.subagentRunsByChat.set("chat-1", { "run-1": { status: "running" } })
    await handleFailedLoopTurn(deps, "chat-1", schedule)
    await pending[0]!()
    expect(emitted.some((e) => e.kind === "auto_continue_accepted")).toBe(false)
  })

  // A rate-limited turn already schedules its own resume via
  // handleLimitDetection; re-arming on top would double-wake at reset.
  test("stands down when a resume is already scheduled", async () => {
    const { store, emitted, pending, deps, schedule } = collectDeps()
    await handleFailedLoopTurn(deps, "chat-1", schedule)
    const now = Date.now()
    store.events.push({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_proposed",
      timestamp: now,
      chatId: "chat-1",
      scheduleId: "sched-live",
      tz: "system",
      resetAt: now + 60_000,
      detectedAt: now,
    })
    await pending[0]!()
    expect(emitted.some((e) => e.kind === "auto_continue_accepted")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resumeLoop — undoing a disarm
// ---------------------------------------------------------------------------

describe("resumeLoop", () => {
  function armEvent(): AutoContinueEvent {
    return {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_armed",
      timestamp: 1,
      chatId: "chat-1",
      scheduleId: "la-1",
      subagentId: "sub-1",
      prompt: "ORCHESTRATOR loop prompt",
      verifyCommand: "sh verify.sh",
      workdirAbs: "/repo/worktree",
      trackingFileRel: "PROGRESS-plugin.md",
    }
  }

  test("re-arms from the tombstone the disarm left behind", async () => {
    const store = makeStore()
    store.events.push(armEvent(), {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_disarmed",
      timestamp: 2,
      chatId: "chat-1",
      scheduleId: "ld-1",
      reason: "user_send",
    })
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (e) => { emitted.push(e); store.events.push(e) },
      isLoopArmed: () => null,
    })

    const result = await resumeLoop(deps, "chat-1")

    expect(result).toEqual({
      resumed: true,
      trackingFileRel: "PROGRESS-plugin.md",
      workdirAbs: "/repo/worktree",
    })
    const armed = emitted.find((e) => e.kind === "loop_armed")
    if (armed?.kind !== "loop_armed") throw new Error("expected loop_armed")
    // The spec must round-trip verbatim: a resume that loses the workdir or the
    // tracking file re-arms a loop pointed at the wrong checkout.
    expect(armed.subagentId).toBe("sub-1")
    expect(armed.prompt).toBe("ORCHESTRATOR loop prompt")
    expect(armed.verifyCommand).toBe("sh verify.sh")
    expect(armed.workdirAbs).toBe("/repo/worktree")
    expect(armed.trackingFileRel).toBe("PROGRESS-plugin.md")
  })

  test("refuses when a loop is already armed", async () => {
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      emitAutoContinueEvent: async (e) => { emitted.push(e) },
      isLoopArmed: () => armedLoop(),
    })
    expect(await resumeLoop(deps, "chat-1")).toEqual({ resumed: false, reason: "already_armed" })
    expect(emitted).toEqual([])
  })

  test("refuses when the chat never armed a loop", async () => {
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      emitAutoContinueEvent: async (e) => { emitted.push(e) },
      isLoopArmed: () => null,
    })
    expect(await resumeLoop(deps, "chat-1")).toEqual({ resumed: false, reason: "no_previous_loop" })
    expect(emitted).toEqual([])
  })
})
