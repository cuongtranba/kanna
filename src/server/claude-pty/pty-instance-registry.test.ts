import { describe, expect, test } from "bun:test"
import {
  createPtyInstanceRegistry,
  type PtyInstanceDelta,
  type PtyInstanceState,
} from "./pty-instance-registry"

function baseline(overrides: Partial<PtyInstanceState> = {}): Omit<PtyInstanceState, "chatId"> {
  return {
    sessionId: null,
    pid: null,
    cwd: "/tmp",
    model: "claude-opus-4-7",
    accountLabel: null,
    oauthMasked: null,
    phase: "spawning",
    startedAt: 1_000,
    lastEventAt: 1_000,
    turnCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    planMode: null,
    smokeTest: null,
    outputRingTail: null,
    exitedAt: null,
    exitCode: null,
    ...overrides,
  }
}

describe("PtyInstanceRegistry", () => {
  test("upsert with new chatId fires added", () => {
    const registry = createPtyInstanceRegistry({ coalesceMs: 0 })
    const events: PtyInstanceDelta[] = []
    registry.subscribe((d) => events.push(d))
    registry.upsert("c1", baseline())
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "added", instance: { chatId: "c1" } })
  })

  test("upsert with existing chatId fires updated and merges patch", () => {
    const registry = createPtyInstanceRegistry({ coalesceMs: 0 })
    registry.upsert("c1", baseline())
    const events: PtyInstanceDelta[] = []
    registry.subscribe((d) => events.push(d))
    registry.upsert("c1", { phase: "ready", pid: 42 })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "updated",
      instance: { chatId: "c1", phase: "ready", pid: 42, cwd: "/tmp" },
    })
  })

  test("remove fires removed event and drops state", () => {
    const registry = createPtyInstanceRegistry({ coalesceMs: 0 })
    registry.upsert("c1", baseline())
    const events: PtyInstanceDelta[] = []
    registry.subscribe((d) => events.push(d))
    registry.remove("c1")
    expect(events).toEqual([{ type: "removed", chatId: "c1" }])
    expect(registry.snapshot()).toEqual([])
  })

  test("remove for unknown chatId is a no-op", () => {
    const registry = createPtyInstanceRegistry({ coalesceMs: 0 })
    const events: PtyInstanceDelta[] = []
    registry.subscribe((d) => events.push(d))
    registry.remove("nope")
    expect(events).toEqual([])
  })

  test("snapshot returns clones, not references", () => {
    const registry = createPtyInstanceRegistry({ coalesceMs: 0 })
    registry.upsert("c1", baseline())
    const a = registry.snapshot()
    const b = registry.snapshot()
    expect(a[0]).not.toBe(b[0])
    a[0]!.phase = "exited"
    expect(registry.snapshot()[0]!.phase).toBe("spawning")
  })

  test("unsubscribe stops further events", () => {
    const registry = createPtyInstanceRegistry({ coalesceMs: 0 })
    const events: PtyInstanceDelta[] = []
    const off = registry.subscribe((d) => events.push(d))
    off()
    registry.upsert("c1", baseline())
    expect(events).toEqual([])
  })

  test("coalesce: rapid updates within window emit one trailing delta", async () => {
    const registry = createPtyInstanceRegistry({ coalesceMs: 30 })
    registry.upsert("c1", baseline())
    const events: PtyInstanceDelta[] = []
    registry.subscribe((d) => events.push(d))
    registry.upsert("c1", { tokensIn: 1 })
    registry.upsert("c1", { tokensIn: 2 })
    registry.upsert("c1", { tokensIn: 3 })
    expect(events).toEqual([])
    await new Promise((r) => setTimeout(r, 50))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "updated", instance: { tokensIn: 3 } })
  })

  test("coalesce: added events are not delayed", () => {
    const registry = createPtyInstanceRegistry({ coalesceMs: 30 })
    const events: PtyInstanceDelta[] = []
    registry.subscribe((d) => events.push(d))
    registry.upsert("c1", baseline())
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe("added")
  })

  test("coalesce: removed flushes pending update for same chatId", async () => {
    const registry = createPtyInstanceRegistry({ coalesceMs: 30 })
    registry.upsert("c1", baseline())
    const events: PtyInstanceDelta[] = []
    registry.subscribe((d) => events.push(d))
    registry.upsert("c1", { phase: "streaming" })
    registry.remove("c1")
    await new Promise((r) => setTimeout(r, 50))
    expect(events.map((e) => e.type)).toEqual(["removed"])
  })

  test("subscribe replay seeds listener with current state", () => {
    const registry = createPtyInstanceRegistry({ coalesceMs: 0 })
    registry.upsert("c1", baseline())
    registry.upsert("c2", baseline({ phase: "ready" }))
    const events: PtyInstanceDelta[] = []
    registry.subscribe((d) => events.push(d), { replay: true })
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.type === "added")).toBe(true)
  })
})
