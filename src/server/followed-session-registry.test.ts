import { describe, expect, mock, test } from "bun:test"
import { createFollowedSessionRegistry, type FollowedSessionRegistryDeps } from "./followed-session-registry"

function makeRegistry(over: Partial<FollowedSessionRegistryDeps> = {}) {
  let nowMs = 1_000_000
  const stat = { size: 100, mtimeMs: nowMs }
  const deps: FollowedSessionRegistryDeps = {
    statFile: mock(() => ({ ...stat })),
    runDelta: mock(async () => {}),
    isTurnActive: mock(() => false),
    now: () => nowMs,
    onChange: mock(() => {}),
    activeWindowMs: 600_000,
    idleMs: 600_000,
    ...over,
  }
  const reg = createFollowedSessionRegistry(deps)
  return { reg, deps, stat, advance: (ms: number) => { nowMs += ms }, setNow: (v: number) => { nowMs = v } }
}
const INFO = { chatId: "chat-1", sessionId: "s-1", sourcePath: "/p/s-1.jsonl", sourceMtimeMs: 1_000_000 }

describe("FollowedSessionRegistry", () => {
  test("consider arms only recently-active files", () => {
    const { reg } = makeRegistry()
    reg.consider(INFO)
    expect(reg.isFollowing("chat-1")).toBe(true)
    const { reg: reg2, deps } = makeRegistry()
    reg2.consider({ ...INFO, sourceMtimeMs: 1_000_000 - 700_000 }) // older than activeWindowMs
    expect(reg2.isFollowing("chat-1")).toBe(false)
    expect(deps.onChange).not.toHaveBeenCalled()
  })
  test("tick with growth runs delta once and updates lastSize", async () => {
    const { reg, deps, stat } = makeRegistry()
    reg.consider(INFO)
    stat.size = 250
    await reg.tick()
    expect(deps.runDelta).toHaveBeenCalledTimes(1)
    await reg.tick() // no further growth
    expect(deps.runDelta).toHaveBeenCalledTimes(1)
  })
  test("tick pauses while a Kanna turn is active (still following)", async () => {
    const { reg, deps, stat } = makeRegistry({ isTurnActive: mock(() => true) })
    reg.consider(INFO); stat.size = 250
    await reg.tick()
    expect(deps.runDelta).not.toHaveBeenCalled()
    expect(reg.isFollowing("chat-1")).toBe(true)
  })
  test("stop(user_takeover) is permanent — re-consider does not re-arm", () => {
    const { reg } = makeRegistry()
    reg.consider(INFO)
    reg.stop("chat-1", "user_takeover")
    reg.consider(INFO)
    expect(reg.isFollowing("chat-1")).toBe(false)
  })
  test("idle beyond idleMs stops following; missing file stops too", async () => {
    const { reg, advance } = makeRegistry()
    reg.consider(INFO)
    advance(700_000) // no growth for > idleMs
    await reg.tick()
    expect(reg.isFollowing("chat-1")).toBe(false)
    const { reg: reg2 } = makeRegistry({ statFile: mock(() => null) })
    reg2.consider(INFO)
    await reg2.tick()
    expect(reg2.isFollowing("chat-1")).toBe(false)
  })
  test("onChange fires on every membership change with current ids", () => {
    const calls: string[][] = []
    const { reg } = makeRegistry({ onChange: (ids) => calls.push(ids) })
    reg.consider(INFO)
    reg.stop("chat-1", "chat_deleted")
    expect(calls).toEqual([["chat-1"], []])
  })
})
