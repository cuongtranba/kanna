import { describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createFollowedSessionRegistry, type FollowedSessionRegistryDeps } from "./followed-session-registry"
import { statSessionFile } from "./followed-session-io.adapter"
import { importOneSession, importSessionsByIds, type SessionImportedInfo } from "./claude-session-importer.adapter"
import { claudeSessionSource } from "./session-source-registry.adapter"
import { createTestEventStore } from "./storage/test-helpers"

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

describe("FollowedSessionRegistry integration (real fs + importer)", () => {
  test("consider + tick delta-imports growth into the event store", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "kanna-data-"))
    const homeDir = mkdtempSync(path.join(tmpdir(), "kanna-home-"))
    const realProj = mkdtempSync(path.join(tmpdir(), "kanna-proj-"))
    try {
      const sessionId = "8f1c2b3e-9a41-4c7d-9b2e-1a2b3c4d5e6f"
      const folderName = realProj.replace(/\//g, "-")
      const projDir = path.join(homeDir, ".claude", "projects", folderName)
      mkdirSync(projDir, { recursive: true })
      const jsonlPath = path.join(projDir, `${sessionId}.jsonl`)
      const line1 = JSON.stringify({
        type: "user", uuid: "u1", sessionId, cwd: realProj,
        timestamp: "2026-04-20T10:00:00.000Z",
        message: { role: "user", content: "hi" },
      })
      const line2 = JSON.stringify({
        type: "assistant", uuid: "a1", sessionId, cwd: realProj,
        timestamp: "2026-04-20T10:00:01.000Z",
        message: { role: "assistant", id: "m1", content: [{ type: "text", text: "hello" }] },
      })
      writeFileSync(jsonlPath, `${line1}\n${line2}\n`, "utf8")

      const store = createTestEventStore(dataDir)
      await store.initialize()

      let followedInfo: SessionImportedInfo | null = null
      const importResult = await importSessionsByIds({
        store,
        homeDir,
        sessionIds: [sessionId],
        onSessionImported: (info) => { followedInfo = info },
      })
      const chatId = importResult.results[0].chatId
      if (!chatId) throw new Error("expected chatId from import")

      const registry = createFollowedSessionRegistry({
        statFile: statSessionFile,
        runDelta: async (deltaChatId, sourcePath) => {
          const parsed = claudeSessionSource.parse(sourcePath)
          if (parsed.kind === "parsed") await importOneSession(store, parsed.session)
        },
        isTurnActive: () => false,
        now: () => Date.now(),
        onChange: () => {},
        activeWindowMs: 600_000,
        idleMs: 600_000,
      })
      if (!followedInfo) throw new Error("expected onSessionImported to fire")
      registry.consider(followedInfo)
      expect(registry.isFollowing(chatId)).toBe(true)

      const line3 = JSON.stringify({
        type: "user", uuid: "u2", sessionId, cwd: realProj,
        timestamp: "2026-04-20T10:00:02.000Z",
        message: { role: "user", content: "second" },
      })
      const existing = `${line1}\n${line2}\n`
      writeFileSync(jsonlPath, `${existing}${line3}\n`, "utf8")

      const before = store.getMessages(chatId).length
      await registry.tick()
      const after = store.getMessages(chatId)
      expect(after.length).toBeGreaterThan(before)
      expect(after.some((entry) => entry.kind === "user_prompt" && entry.content === "second")).toBe(true)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(realProj, { recursive: true, force: true })
    }
  })
})
