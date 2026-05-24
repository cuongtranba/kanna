import { describe, expect, test } from "bun:test"
import type { PtyInstanceState } from "../../shared/pty-instance"
import { createPtyInstancesStore } from "./ptyInstancesStore"

function instance(chatId: string, overrides: Partial<PtyInstanceState> = {}): PtyInstanceState {
  return {
    chatId,
    sessionId: null,
    pid: null,
    cwd: "/tmp",
    model: "claude-opus-4-7",
    accountLabel: null,
    oauthMasked: null,
    phase: "ready",
    startedAt: 0,
    lastEventAt: 0,
    turnCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    planMode: null,
    smokeTest: null,
    outputRingTail: null,
    exitedAt: null,
    exitCode: null,
    rssBytes: null,
    rssPeakBytes: null,
    cpuPercent: null,
    cpuPeakPercent: null,
    ...overrides,
  }
}

describe("ptyInstancesStore", () => {
  test("applySnapshot replaces instances and keeps stable empty ref", () => {
    const store = createPtyInstancesStore()
    const first = store.getState().instances
    store.getState().applySnapshot([])
    expect(store.getState().instances).toBe(first)
    store.getState().applySnapshot([instance("c1")])
    expect(store.getState().instances).toHaveLength(1)
  })

  test("applyDiff added/updated/removed", () => {
    const store = createPtyInstancesStore()
    store.getState().applyDiff({ op: "added", instance: instance("c1") })
    expect(store.getState().instances).toHaveLength(1)
    store.getState().applyDiff({ op: "added", instance: instance("c1") })
    expect(store.getState().instances).toHaveLength(1)
    store.getState().applyDiff({ op: "updated", instance: instance("c1", { phase: "streaming" }) })
    expect(store.getState().instances[0]!.phase).toBe("streaming")
    store.getState().applyDiff({ op: "removed", chatId: "c1" })
    expect(store.getState().instances).toHaveLength(0)
  })

  test("applySnapshot drops exited entries", () => {
    const store = createPtyInstancesStore()
    store.getState().applySnapshot([
      instance("c1", { phase: "ready" }),
      instance("c2", { phase: "exited" }),
      instance("c3", { phase: "streaming" }),
    ])
    const ids = store.getState().instances.map((i) => i.chatId)
    expect(ids).toEqual(["c1", "c3"])
  })

  test("applyDiff added with exited phase is ignored", () => {
    const store = createPtyInstancesStore()
    store.getState().applyDiff({ op: "added", instance: instance("c1", { phase: "exited" }) })
    expect(store.getState().instances).toHaveLength(0)
  })

  test("applyDiff updated transitioning to exited removes entry", () => {
    const store = createPtyInstancesStore()
    store.getState().applyDiff({ op: "added", instance: instance("c1", { phase: "ready" }) })
    expect(store.getState().instances).toHaveLength(1)
    store.getState().applyDiff({ op: "updated", instance: instance("c1", { phase: "exited" }) })
    expect(store.getState().instances).toHaveLength(0)
  })

  test("applyDiff updated for unknown live entry inserts it", () => {
    const store = createPtyInstancesStore()
    store.getState().applyDiff({ op: "updated", instance: instance("c1", { phase: "ready" }) })
    expect(store.getState().instances).toHaveLength(1)
  })

  test("popover toggles", () => {
    const store = createPtyInstancesStore()
    store.getState().togglePopover()
    expect(store.getState().popoverOpen).toBe(true)
    store.getState().closePopover()
    expect(store.getState().popoverOpen).toBe(false)
  })
})
