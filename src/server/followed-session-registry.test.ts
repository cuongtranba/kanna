import { describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  createFollowedSessionRegistry,
  createSessionDeltaRunner,
  type FollowedSessionRegistryDeps,
} from "./followed-session-registry"
import { statSessionFile } from "./followed-session-io.adapter"
import { importOneSession, importSessionsByIds, type SessionImportedInfo } from "./claude-session-importer.adapter"
import { sourceForProvider } from "./session-source-registry"
import { createTestEventStore } from "./storage/test-helpers"
import type { AgentProvider } from "../shared/types"
import type { ImportableSession, SessionParseResult, SessionSource } from "./session-source"

function makeRegistry(over: Partial<FollowedSessionRegistryDeps> = {}) {
  let nowMs = 1_000_000
  const stat = { size: 100, mtimeMs: nowMs }
  const deps: FollowedSessionRegistryDeps = {
    statFile: mock(() => ({ ...stat })),
    runDelta: mock(async () => true),
    isTurnActive: mock(() => false),
    now: () => nowMs,
    onChange: mock(() => {}),
    activeWindowMs: 600_000,
    idleMs: 600_000,
    maxConsecutiveFailures: 3,
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
  // A codex rollout that crosses the size cap mid-session answers `tooLarge` on
  // every tick while the file keeps growing. Refreshing `lastGrowthAt` on GROWTH
  // rather than on delta SUCCESS made the idle stop unreachable, so the registry
  // followed that chat for the life of the process — polling every 2s, appending
  // nothing, saying nothing, with the UI still showing the live badge.
  test("a failing delta does not refresh the idle deadline", async () => {
    const { reg, stat, advance } = makeRegistry({
      runDelta: mock(async () => false),
      maxConsecutiveFailures: 1000, // isolate the idle timer from the give-up count
    })
    reg.consider(INFO)
    for (let i = 0; i < 4; i += 1) {
      stat.size += 100
      advance(200_000)
      await reg.tick()
    }
    // Growth stopped; the deadline must already be blown, since none of the
    // deltas above counted as progress.
    await reg.tick()
    expect(reg.isFollowing("chat-1")).toBe(false)
  })

  test("a succeeding delta does refresh the idle deadline", async () => {
    const { reg, stat, advance } = makeRegistry()
    reg.consider(INFO)
    for (let i = 0; i < 4; i += 1) {
      stat.size += 100
      advance(200_000)
      await reg.tick()
    }
    await reg.tick()
    expect(reg.isFollowing("chat-1")).toBe(true)
  })

  test("gives up after maxConsecutiveFailures failing deltas, and says so on onChange", async () => {
    const calls: string[][] = []
    const { reg, deps, stat } = makeRegistry({
      runDelta: mock(async () => false),
      maxConsecutiveFailures: 3,
      onChange: (ids) => calls.push(ids),
    })
    reg.consider(INFO)
    for (let i = 0; i < 2; i += 1) {
      stat.size += 100
      await reg.tick()
    }
    expect(reg.isFollowing("chat-1")).toBe(true)
    stat.size += 100
    await reg.tick()
    expect(reg.isFollowing("chat-1")).toBe(false)
    expect(deps.runDelta).toHaveBeenCalledTimes(3)
    expect(calls).toEqual([["chat-1"], []])
    // Nothing further is polled once the entry is gone.
    stat.size += 100
    await reg.tick()
    expect(deps.runDelta).toHaveBeenCalledTimes(3)
  })

  test("a throwing delta counts as a failure and never kills the tick loop", async () => {
    const { reg, deps, stat } = makeRegistry({
      runDelta: mock(async () => { throw new Error("unreadable") }),
      maxConsecutiveFailures: 2,
    })
    reg.consider(INFO)
    stat.size += 100
    await reg.tick()
    expect(reg.isFollowing("chat-1")).toBe(true)
    stat.size += 100
    await reg.tick()
    expect(reg.isFollowing("chat-1")).toBe(false)
    expect(deps.runDelta).toHaveBeenCalledTimes(2)
  })

  test("one success resets the failure count", async () => {
    let ok = false
    const { reg, stat } = makeRegistry({
      runDelta: mock(async () => ok),
      maxConsecutiveFailures: 2,
    })
    reg.consider(INFO)
    stat.size += 100
    await reg.tick() // failure 1
    ok = true
    stat.size += 100
    await reg.tick() // success — resets
    ok = false
    stat.size += 100
    await reg.tick() // failure 1 again, below the cap
    expect(reg.isFollowing("chat-1")).toBe(true)
  })

  test("onChange fires on every membership change with current ids", () => {
    const calls: string[][] = []
    const { reg } = makeRegistry({ onChange: (ids) => calls.push(ids) })
    reg.consider(INFO)
    reg.stop("chat-1", "chat_deleted")
    expect(calls).toEqual([["chat-1"], []])
  })
})

describe("createSessionDeltaRunner", () => {
  function makeSource(provider: AgentProvider, result: SessionParseResult): SessionSource {
    return {
      provider,
      scan: () => [],
      locate: () => null,
      parse: mock(() => result),
    }
  }
  const SESSION: ImportableSession = {
    provider: "codex",
    sessionId: "s-1",
    filePath: "/p/rollout.jsonl",
    cwd: "/p",
    firstTimestamp: 0,
    lastTimestamp: 1,
    sourceHash: "codex:v1:0:0:deadbeef",
    toEntries: () => [],
    newEntriesSince: () => [],
    recordKeyFromEntryId: () => null,
    title: () => "s-1",
    legacyTitleCandidates: () => new Set<string>(),
  }
  const PARSED: SessionParseResult = { kind: "parsed", session: SESSION }

  test("routes to the source that WROTE the file, never to a default", async () => {
    const claude = makeSource("claude", { kind: "rejected", reason: "parse_failed" })
    const codex = makeSource("codex", PARSED)
    const imported: string[] = []
    const run = createSessionDeltaRunner({
      providerOf: () => "codex",
      sourceFor: (provider) => (provider === "codex" ? codex : claude),
      importOne: async (session) => { imported.push(session.sessionId) },
    })
    expect(await run("chat-1", "/p/rollout.jsonl")).toBe(true)
    expect(imported).toEqual(["s-1"])
    expect(claude.parse as ReturnType<typeof mock>).not.toHaveBeenCalled()
  })

  // `?? "claude"` handed a codex-sourced chat to the claude reader whenever the
  // row was gone, which parses `rejected` and drops the delta silently on every
  // tick — the same silent drop the provider routing exists to fix, pointing the
  // other way. A vanished chat is reported, never guessed at.
  test("a missing chat row fails rather than guessing a provider", async () => {
    const codex = makeSource("codex", PARSED)
    const run = createSessionDeltaRunner({
      providerOf: () => null,
      sourceFor: () => codex,
      importOne: async () => {},
    })
    expect(await run("chat-gone", "/p/rollout.jsonl")).toBe(false)
    expect(codex.parse as ReturnType<typeof mock>).not.toHaveBeenCalled()
  })

  test("reports failure for every non-parsed outcome", async () => {
    const cases: SessionParseResult[] = [
      { kind: "tooLarge", size: 99, maxBytes: 10 },
      { kind: "rejected", reason: "unreadable" },
      { kind: "rejected", reason: "no_session_meta" },
    ]
    for (const result of cases) {
      const run = createSessionDeltaRunner({
        providerOf: () => "codex",
        sourceFor: () => makeSource("codex", result),
        importOne: async () => { throw new Error("must not import") },
      })
      expect(await run("chat-1", "/p/rollout.jsonl")).toBe(false)
    }
  })

  test("an unknown provider fails rather than importing nothing quietly", async () => {
    const run = createSessionDeltaRunner({
      providerOf: () => "openrouter",
      sourceFor: () => null,
      importOne: async () => { throw new Error("must not import") },
    })
    expect(await run("chat-1", "/p/x.jsonl")).toBe(false)
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
        // The REAL routing, as `server.ts` wires it. A hand-rolled claude-only
        // runDelta here reproduces the pre-fix behaviour and hides the whole
        // provider-routing question from this suite.
        runDelta: createSessionDeltaRunner({
          providerOf: (deltaChatId) => store.state.chatsById.get(deltaChatId)?.provider ?? null,
          sourceFor: (provider) => sourceForProvider(provider),
          importOne: async (session) => { await importOneSession(store, session) },
        }),
        isTurnActive: () => false,
        now: () => Date.now(),
        onChange: () => {},
        activeWindowMs: 600_000,
        idleMs: 600_000,
        maxConsecutiveFailures: 3,
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
