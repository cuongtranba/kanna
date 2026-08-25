import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  importAllSessions,
  importOneSession,
  importSessionsByIds,
} from "./claude-session-importer.adapter"
import type { SessionImportedInfo } from "./claude-session-importer.adapter"
import { writeCodexRolloutFixture, writeSubagentRollout } from "./__fixtures__/codex-rollout-fixture"
import { codexSessionSource } from "./session-source-registry.adapter"
import { createTestEventStore } from "./storage/test-helpers"

function fresh() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "kanna-data-"))
  const homeDir = mkdtempSync(path.join(tmpdir(), "kanna-home-"))
  const realProj = mkdtempSync(path.join(tmpdir(), "kanna-proj-"))
  return {
    dataDir,
    homeDir,
    realProj,
    cleanup: () => {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(realProj, { recursive: true, force: true })
    },
  }
}

function seedSession(homeDir: string, realProj: string, sessionId: string) {
  const folderName = realProj.replace(/\//g, "-")
  const projDir = path.join(homeDir, ".claude", "projects", folderName)
  mkdirSync(projDir, { recursive: true })
  const line1 = JSON.stringify({
    type: "user",
    uuid: "u1",
    sessionId,
    cwd: realProj,
    timestamp: "2026-04-20T10:00:00.000Z",
    message: { role: "user", content: "hi" },
  })
  const line2 = JSON.stringify({
    type: "assistant",
    uuid: "a1",
    sessionId,
    cwd: realProj,
    timestamp: "2026-04-20T10:00:01.000Z",
    message: { role: "assistant", id: "m1", content: [{ type: "text", text: "hello" }] },
  })
  writeFileSync(path.join(projDir, `${sessionId}.jsonl`), `${line1}\n${line2}\n`, "utf8")
}

function claudeProjectDir(homeDir: string, realProj: string) {
  const folderName = realProj.replace(/\//g, "-")
  return path.join(homeDir, ".claude", "projects", folderName)
}

/** `<homeDir>/.codex/sessions/YYYY/MM/DD` — the layout the codex scanner walks. */
function codexDayDir(homeDir: string) {
  return path.join(homeDir, ".codex", "sessions", "2026", "06", "07")
}

function seedCodexSession(homeDir: string, cwd: string, sessionId: string) {
  return writeCodexRolloutFixture(codexDayDir(homeDir), { sessionId, cwd })
}

function seedCodexSubagentSession(homeDir: string, cwd: string, sessionId: string) {
  return writeSubagentRollout(codexDayDir(homeDir), { sessionId, cwd })
}

function md5File(filePath: string) {
  return createHash("md5").update(readFileSync(filePath, "utf8")).digest("hex")
}

describe("importAllSessions", () => {
  test("imports a session, creating project + chat + messages", async () => {
    const ctx = fresh()
    try {
      seedSession(ctx.homeDir, ctx.realProj, "sess-aaa")
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const result = await importAllSessions({ store, homeDir: ctx.homeDir })

      expect(result.imported).toBe(1)
      expect(result.skipped).toBe(0)
      expect(result.failed).toBe(0)

      const chats = [...store.state.chatsById.values()].filter((c) => !c.deletedAt)
      expect(chats.length).toBe(1)
      expect(chats[0].sessionTokensByProvider.claude).toBe("sess-aaa")
      expect(chats[0].provider).toBe("claude")
      expect(store.getMessages(chats[0].id).length).toBe(2)
    } finally {
      ctx.cleanup()
    }
  })

  test("re-import is a no-op (dedup by sessionToken)", async () => {
    const ctx = fresh()
    try {
      seedSession(ctx.homeDir, ctx.realProj, "sess-bbb")
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      await importAllSessions({ store, homeDir: ctx.homeDir })
      const second = await importAllSessions({ store, homeDir: ctx.homeDir })

      expect(second.imported).toBe(0)
      expect(second.skipped).toBe(1)
    } finally {
      ctx.cleanup()
    }
  })

  test("skips session whose cwd no longer exists", async () => {
    const ctx = fresh()
    try {
      seedSession(ctx.homeDir, ctx.realProj, "sess-ccc")
      rmSync(ctx.realProj, { recursive: true, force: true })
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const result = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(result.imported).toBe(0)
      expect(result.failed).toBe(1)
    } finally {
      ctx.cleanup()
    }
  })

  test("derives title from array-form user text", async () => {
    const ctx = fresh()
    try {
      const folderName = ctx.realProj.replace(/\//g, "-")
      const projDir = path.join(ctx.homeDir, ".claude", "projects", folderName)
      mkdirSync(projDir, { recursive: true })
      const line = JSON.stringify({
        type: "user",
        uuid: "u1",
        sessionId: "sess-array",
        cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "analyse this repo" }],
        },
      })
      const line2 = JSON.stringify({
        type: "assistant",
        uuid: "a1",
        sessionId: "sess-array",
        cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:01.000Z",
        message: { role: "assistant", id: "m1", content: [{ type: "text", text: "sure" }] },
      })
      writeFileSync(path.join(projDir, "sess-array.jsonl"), `${line}\n${line2}\n`, "utf8")

      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()
      const result = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(result.imported).toBe(1)

      const chats = [...store.state.chatsById.values()].filter((c) => !c.deletedAt)
      expect(chats.length).toBe(1)
      expect(chats[0].title).toBe("analyse this repo")
    } finally {
      ctx.cleanup()
    }
  })

  test("prefers latest non-empty summary over first user text", async () => {
    const ctx = fresh()
    try {
      const folderName = ctx.realProj.replace(/\//g, "-")
      const projDir = path.join(ctx.homeDir, ".claude", "projects", folderName)
      mkdirSync(projDir, { recursive: true })
      const blankSummary = JSON.stringify({
        type: "summary",
        uuid: "s0",
        sessionId: "sess-summary",
        cwd: ctx.realProj,
        timestamp: "2026-04-20T09:59:59.000Z",
        summary: "   ",
      })
      const line = JSON.stringify({
        type: "user",
        uuid: "u1",
        sessionId: "sess-summary",
        cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:00.000Z",
        message: {
          role: "user",
          content: "first user prompt should not become the title",
        },
      })
      const olderSummary = JSON.stringify({
        type: "summary",
        uuid: "s1",
        sessionId: "sess-summary",
        cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:01.000Z",
        summary: "Older summary title",
      })
      const latestSummary = JSON.stringify({
        type: "summary",
        uuid: "s2",
        sessionId: "sess-summary",
        cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:02.000Z",
        summary: "Latest summary title",
      })
      writeFileSync(
        path.join(projDir, "sess-summary.jsonl"),
        `${blankSummary}\n${line}\n${olderSummary}\n${latestSummary}\n`,
        "utf8",
      )

      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()
      const result = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(result.imported).toBe(1)

      const chats = [...store.state.chatsById.values()].filter((c) => !c.deletedAt)
      expect(chats.length).toBe(1)
      expect(chats[0].title).toBe("Latest summary title")
    } finally {
      ctx.cleanup()
    }
  })

  test("prefers latest non-empty custom title over summary and first user text", async () => {
    const ctx = fresh()
    try {
      const projDir = claudeProjectDir(ctx.homeDir, ctx.realProj)
      mkdirSync(projDir, { recursive: true })
      const blankCustomTitle = JSON.stringify({
        type: "custom-title",
        sessionId: "sess-custom-title",
        customTitle: "   ",
      })
      const line = JSON.stringify({
        type: "user",
        uuid: "u1",
        sessionId: "sess-custom-title",
        cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:00.000Z",
        message: {
          role: "user",
          content: "first user prompt should not become the title",
        },
      })
      const summary = JSON.stringify({
        type: "summary",
        uuid: "s1",
        sessionId: "sess-custom-title",
        cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:01.000Z",
        summary: "Summary title",
      })
      const olderCustomTitle = JSON.stringify({
        type: "custom-title",
        sessionId: "sess-custom-title",
        customTitle: "Older custom title",
      })
      const latestCustomTitle = JSON.stringify({
        type: "custom-title",
        sessionId: "sess-custom-title",
        customTitle: "Latest custom title",
      })
      writeFileSync(
        path.join(projDir, "sess-custom-title.jsonl"),
        `${blankCustomTitle}\n${line}\n${summary}\n${olderCustomTitle}\n${latestCustomTitle}\n`,
        "utf8",
      )

      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()
      const result = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(result.imported).toBe(1)

      const chats = [...store.state.chatsById.values()].filter((c) => !c.deletedAt)
      expect(chats.length).toBe(1)
      expect(chats[0].title).toBe("Latest custom title")
    } finally {
      ctx.cleanup()
    }
  })

  test("backfills existing imported title even when source hash is unchanged", async () => {
    const ctx = fresh()
    try {
      const projDir = claudeProjectDir(ctx.homeDir, ctx.realProj)
      mkdirSync(projDir, { recursive: true })
      const legacyPrompt = "what is the current jtbd structure? create a folder for the patient app"
      const legacyPersistedTitle = legacyPrompt.slice(0, 60).trim()
      const line = JSON.stringify({
        type: "user",
        uuid: "u1",
        sessionId: "sess-backfill-title",
        cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:00.000Z",
        message: { role: "user", content: legacyPrompt },
      })
      const customTitle = JSON.stringify({
        type: "custom-title",
        sessionId: "sess-backfill-title",
        customTitle: "Backfilled custom title",
      })
      const jsonlPath = path.join(projDir, "sess-backfill-title.jsonl")
      writeFileSync(jsonlPath, `${line}\n${customTitle}\n`, "utf8")

      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()
      const project = await store.openProject(ctx.realProj)
      const chat = await store.createChat(project.id)
      await store.setChatProvider(chat.id, "claude")
      await store.renameChat(chat.id, legacyPersistedTitle)
      await store.setSessionTokenForProvider(chat.id, "claude", "sess-backfill-title")
      await store.setSourceHash(chat.id, md5File(jsonlPath))

      const result = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(result.imported).toBe(0)
      expect(result.updated).toBe(1)
      expect(result.skipped).toBe(0)
      expect(store.state.chatsById.get(chat.id)?.title).toBe("Backfilled custom title")
    } finally {
      ctx.cleanup()
    }
  })

  test("does not backfill over a manual Kanna title", async () => {
    const ctx = fresh()
    try {
      const projDir = claudeProjectDir(ctx.homeDir, ctx.realProj)
      mkdirSync(projDir, { recursive: true })
      const line = JSON.stringify({
        type: "user",
        uuid: "u1",
        sessionId: "sess-manual-title",
        cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:00.000Z",
        message: { role: "user", content: "legacy first prompt title" },
      })
      const customTitle = JSON.stringify({
        type: "custom-title",
        sessionId: "sess-manual-title",
        customTitle: "Claude custom title",
      })
      const jsonlPath = path.join(projDir, "sess-manual-title.jsonl")
      writeFileSync(jsonlPath, `${line}\n${customTitle}\n`, "utf8")

      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()
      const project = await store.openProject(ctx.realProj)
      const chat = await store.createChat(project.id)
      await store.setChatProvider(chat.id, "claude")
      await store.renameChat(chat.id, "Manual Kanna title")
      await store.setSessionTokenForProvider(chat.id, "claude", "sess-manual-title")
      await store.setSourceHash(chat.id, md5File(jsonlPath))

      const result = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(result.imported).toBe(0)
      expect(result.updated).toBe(0)
      expect(result.skipped).toBe(1)
      expect(store.state.chatsById.get(chat.id)?.title).toBe("Manual Kanna title")
    } finally {
      ctx.cleanup()
    }
  })

  test("re-import with unchanged file is skipped (hash match)", async () => {
    const ctx = fresh()
    try {
      seedSession(ctx.homeDir, ctx.realProj, "sess-hash-1")
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const first = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(first.imported).toBe(1)

      const second = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(second.imported).toBe(0)
      expect(second.updated).toBe(0)
      expect(second.skipped).toBe(1)
    } finally {
      ctx.cleanup()
    }
  })

  test("re-import after JSONL grows appends new messages and counts as updated", async () => {
    const ctx = fresh()
    try {
      const folderName = ctx.realProj.replace(/\//g, "-")
      const projDir = path.join(ctx.homeDir, ".claude", "projects", folderName)
      mkdirSync(projDir, { recursive: true })
      const jsonlPath = path.join(projDir, "sess-grow.jsonl")

      const line1 = JSON.stringify({
        type: "user", uuid: "u1", sessionId: "sess-grow", cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:00.000Z",
        message: { role: "user", content: "first" },
      })
      const line2 = JSON.stringify({
        type: "assistant", uuid: "a1", sessionId: "sess-grow", cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:01.000Z",
        message: { role: "assistant", id: "m1", content: [{ type: "text", text: "hello" }] },
      })
      writeFileSync(jsonlPath, `${line1}\n${line2}\n`, "utf8")

      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const first = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(first.imported).toBe(1)
      const chats = [...store.state.chatsById.values()].filter((c) => !c.deletedAt)
      expect(chats.length).toBe(1)
      expect(store.getMessages(chats[0].id).length).toBe(2)

      // append a new turn
      const line3 = JSON.stringify({
        type: "user", uuid: "u2", sessionId: "sess-grow", cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:02.000Z",
        message: { role: "user", content: "second" },
      })
      const line4 = JSON.stringify({
        type: "assistant", uuid: "a2", sessionId: "sess-grow", cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:03.000Z",
        message: { role: "assistant", id: "m2", content: [{ type: "text", text: "world" }] },
      })
      writeFileSync(jsonlPath, `${line1}\n${line2}\n${line3}\n${line4}\n`, "utf8")

      const second = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(second.imported).toBe(0)
      expect(second.updated).toBe(1)
      expect(second.skipped).toBe(0)
      expect(store.getMessages(chats[0].id).length).toBe(4)
    } finally {
      ctx.cleanup()
    }
  })
})

describe("importSessionsByIds", () => {
  test("imports exactly one session and leaves siblings untouched", async () => {
    const ctx = fresh()
    try {
      const realProjB = mkdtempSync(path.join(tmpdir(), "kanna-proj-b-"))
      const SESSION_A_ID = "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"
      const SESSION_B_ID = "0f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"
      seedSession(ctx.homeDir, ctx.realProj, SESSION_A_ID)
      seedSession(ctx.homeDir, realProjB, SESSION_B_ID)
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const result = await importSessionsByIds({ store, homeDir: ctx.homeDir, sessionIds: [SESSION_A_ID] })
      expect(result.results).toEqual([
        expect.objectContaining({ sessionId: SESSION_A_ID, status: "created", chatId: expect.any(String) }),
      ])

      const tokens = [...store.state.chatsById.values()].map((c) => c.sessionTokensByProvider.claude)
      expect(tokens).toContain(SESSION_A_ID)
      expect(tokens).not.toContain(SESSION_B_ID)
      rmSync(realProjB, { recursive: true, force: true })
    } finally {
      ctx.cleanup()
    }
  })

  test("unknown id → not_found; garbage id → invalid_id", async () => {
    const ctx = fresh()
    try {
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const result = await importSessionsByIds({
        store,
        homeDir: ctx.homeDir,
        sessionIds: ["00000000-0000-4000-8000-000000000000", "garbage"],
      })
      expect(result.results[0]).toMatchObject({ status: "failed", error: "not_found" })
      expect(result.results[1]).toMatchObject({ status: "failed", error: "invalid_id" })
    } finally {
      ctx.cleanup()
    }
  })

  test("re-import unchanged → skipped with same chatId", async () => {
    const ctx = fresh()
    try {
      const SESSION_ID = "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"
      seedSession(ctx.homeDir, ctx.realProj, SESSION_ID)
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const first = await importSessionsByIds({ store, homeDir: ctx.homeDir, sessionIds: [SESSION_ID] })
      const again = await importSessionsByIds({ store, homeDir: ctx.homeDir, sessionIds: [SESSION_ID] })
      expect(again.results[0]).toMatchObject({ status: "skipped", chatId: first.results[0].chatId })
    } finally {
      ctx.cleanup()
    }
  })

  test("grown file → updated and fires onSessionImported with source path", async () => {
    const ctx = fresh()
    try {
      const SESSION_ID = "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"
      const folderName = ctx.realProj.replace(/\//g, "-")
      const projDir = path.join(ctx.homeDir, ".claude", "projects", folderName)
      const jsonlPath = path.join(projDir, `${SESSION_ID}.jsonl`)
      seedSession(ctx.homeDir, ctx.realProj, SESSION_ID)
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      await importSessionsByIds({ store, homeDir: ctx.homeDir, sessionIds: [SESSION_ID] })

      const line3 = JSON.stringify({
        type: "user", uuid: "u2", sessionId: SESSION_ID, cwd: ctx.realProj,
        timestamp: "2026-04-20T10:00:02.000Z",
        message: { role: "user", content: "second" },
      })
      const existing = readFileSync(jsonlPath, "utf8")
      writeFileSync(jsonlPath, `${existing}${line3}\n`, "utf8")

      const seen: SessionImportedInfo[] = []
      const result = await importSessionsByIds({
        store,
        homeDir: ctx.homeDir,
        sessionIds: [SESSION_ID],
        onSessionImported: (i) => seen.push(i),
      })
      expect(result.results[0].status).toBe("updated")
      expect(seen[0]).toMatchObject({ sessionId: SESSION_ID, sourcePath: jsonlPath })
    } finally {
      ctx.cleanup()
    }
  })

  // The user-visible defect: a real codex session id pasted into the import
  // dialog answered `not_found`, so ~1200 rollouts under `~/.codex/sessions`
  // were unreachable while claude ids imported fine.
  test("a codex session id resolves to a codex chat", async () => {
    const ctx = fresh()
    try {
      const CODEX_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
      seedCodexSession(ctx.homeDir, ctx.realProj, CODEX_ID)
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const result = await importSessionsByIds({
        store,
        homeDir: ctx.homeDir,
        sessionIds: [CODEX_ID],
      })

      expect(result.results[0]).toMatchObject({ sessionId: CODEX_ID, status: "created" })
      const chatId = result.results[0].chatId
      expect(chatId).toBeDefined()
      const chat = chatId ? store.state.chatsById.get(chatId) : undefined
      expect(chat?.provider).toBe("codex")
      expect(chat?.sessionTokensByProvider.codex).toBe(CODEX_ID)
    } finally {
      ctx.cleanup()
    }
  })

  // Documented precedence: `createSessionSources` is ordered claude-first and the
  // first source that LOCATES the id owns it. The two files are unrelated
  // sessions that merely share a uuid; claude wins because that is what every
  // id resolved to before codex was registered.
  test("an id present under both providers resolves to claude", async () => {
    const ctx = fresh()
    try {
      const SHARED_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"
      seedSession(ctx.homeDir, ctx.realProj, SHARED_ID)
      seedCodexSession(ctx.homeDir, ctx.realProj, SHARED_ID)
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const result = await importSessionsByIds({
        store,
        homeDir: ctx.homeDir,
        sessionIds: [SHARED_ID],
      })

      expect(result.results[0].status).toBe("created")
      const chatId = result.results[0].chatId
      const chat = chatId ? store.state.chatsById.get(chatId) : undefined
      expect(chat?.provider).toBe("claude")
      expect(chat?.sessionTokensByProvider.claude).toBe(SHARED_ID)
      expect(chat?.sessionTokensByProvider.codex).toBeFalsy()
    } finally {
      ctx.cleanup()
    }
  })
})

describe("codex session import", () => {
  // The crossover the provider-erased dedup has to get right: dedup is keyed on
  // `sessionTokensByProvider[provider]`, so one uuid living under BOTH providers
  // is two unrelated sessions and must become two chats. The SECOND run is the
  // half that actually catches a dedupe regression — a scan that re-imports
  // would double every transcript with no error anywhere.
  test("the same uuid under both providers imports as two chats, idempotently", async () => {
    const ctx = fresh()
    try {
      const SHARED_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e"
      seedSession(ctx.homeDir, ctx.realProj, SHARED_ID)
      seedCodexSession(ctx.homeDir, ctx.realProj, SHARED_ID)
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const first = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(first.imported).toBe(2)

      const chats = [...store.state.chatsById.values()].filter((c) => !c.deletedAt)
      expect(chats.length).toBe(2)

      const claudeChat = chats.find((c) => c.provider === "claude")
      const codexChat = chats.find((c) => c.provider === "codex")
      expect(claudeChat?.sessionTokensByProvider.claude).toBe(SHARED_ID)
      expect(claudeChat?.sessionTokensByProvider.codex).toBeFalsy()
      expect(codexChat?.sessionTokensByProvider.codex).toBe(SHARED_ID)
      expect(codexChat?.sessionTokensByProvider.claude).toBeFalsy()

      const claudeCount = store.getMessages(claudeChat!.id).length
      const codexCount = store.getMessages(codexChat!.id).length
      expect(claudeCount).toBeGreaterThan(0)
      expect(codexCount).toBeGreaterThan(0)
      // Different transcripts, not one file imported twice.
      expect(codexCount).not.toBe(claudeCount)

      const second = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(second.imported).toBe(0)
      expect([...store.state.chatsById.values()].filter((c) => !c.deletedAt).length).toBe(2)
      expect(store.getMessages(claudeChat!.id).length).toBe(claudeCount)
      expect(store.getMessages(codexChat!.id).length).toBe(codexCount)
    } finally {
      ctx.cleanup()
    }
  })

  // `too_large` must not read as `parse_failed`: the file is fine, the cap is
  // the thing the user can change. `maxBytes` is injected rather than read from
  // the environment so this needs no 32 MiB fixture.
  test("a rollout over the size cap fails too_large, not parse_failed", async () => {
    const ctx = fresh()
    try {
      const CODEX_ID = "4d5e6f7a-8b9c-4d0e-8f1a-2b3c4d5e6f7a"
      seedCodexSession(ctx.homeDir, ctx.realProj, CODEX_ID)
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const result = await importSessionsByIds({
        store,
        homeDir: ctx.homeDir,
        sessionIds: [CODEX_ID],
        maxBytes: 16,
      })

      expect(result.results[0]).toMatchObject({ status: "failed", error: "too_large" })
      expect([...store.state.chatsById.values()].filter((c) => !c.deletedAt).length).toBe(0)
    } finally {
      ctx.cleanup()
    }
  })

  // The append-storm gate. `codexRecordKey` is the physical line index and
  // `codexRecordKeyFromEntryId` its inverse; if the two drift, every already
  // imported record reads as new and a live-tail tick re-appends the whole
  // transcript. Two appended records must produce exactly two entries, and a
  // re-run over an unchanged file exactly zero.
  test("live-tail delta appends only the new records", async () => {
    const ctx = fresh()
    try {
      const CODEX_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f"
      const fixture = seedCodexSession(ctx.homeDir, ctx.realProj, CODEX_ID)
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const parseRollout = () => {
        const parsed = codexSessionSource.parse(fixture.rolloutPath)
        if (parsed.kind !== "parsed") throw new Error(`expected parsed, got ${parsed.kind}`)
        return parsed.session
      }

      const created = await importOneSession(store, parseRollout())
      expect(created.status).toBe("created")
      const chatId = created.status === "created" ? created.chatId : ""
      const baseline = store.getMessages(chatId).length
      expect(baseline).toBeGreaterThan(0)

      fixture.appendLine({
        timestamp: "2026-06-07T06:00:20.000Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "one more thing" }] },
      })
      fixture.appendLine({
        timestamp: "2026-06-07T06:00:21.000Z",
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
      })

      const grown = await importOneSession(store, parseRollout())
      expect(grown.status).toBe("updated")
      expect(store.getMessages(chatId).length).toBe(baseline + 2)

      const again = await importOneSession(store, parseRollout())
      expect(again.status).toBe("skipped")
      expect(store.getMessages(chatId).length).toBe(baseline + 2)
    } finally {
      ctx.cleanup()
    }
  })
})

describe("rejection reasons reach the user", () => {
  // The sharpest of the five collapsed reasons: 99 of 534 reference rollouts
  // are subagent/forked, so this is the refusal a user is most likely to hit.
  // Reported as `parse_failed` it reads as corruption and they retry forever;
  // it is a permanent, deliberate v1 refusal.
  test("a subagent rollout fails `subagent`, not `parse_failed`", async () => {
    const ctx = fresh()
    try {
      const CODEX_ID = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b"
      seedCodexSubagentSession(ctx.homeDir, ctx.realProj, CODEX_ID)
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const result = await importSessionsByIds({
        store,
        homeDir: ctx.homeDir,
        sessionIds: [CODEX_ID],
      })

      expect(result.results[0]).toMatchObject({ status: "failed", error: "subagent" })
    } finally {
      ctx.cleanup()
    }
  })

  // "Import all" used to drop every refused file BEFORE `importOneSession`, so a
  // user with 99 subagent rollouts saw "imported 0, failed 0" and could not
  // learn that anything had been refused, let alone why.
  test("`import all` counts a refused rollout as failed", async () => {
    const ctx = fresh()
    try {
      seedCodexSubagentSession(ctx.homeDir, ctx.realProj, "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c")
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const result = await importAllSessions({ store, homeDir: ctx.homeDir })

      expect(result.imported).toBe(0)
      expect(result.failed).toBe(1)
    } finally {
      ctx.cleanup()
    }
  })

  // Over-cap files land in the same blind spot: `tooLarge` is dropped by the
  // scan, so the whole rollout set vanishes from every counter.
  test("`import all` counts an over-cap rollout as failed", async () => {
    const ctx = fresh()
    try {
      seedCodexSession(ctx.homeDir, ctx.realProj, "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d")
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const result = await importAllSessions({ store, homeDir: ctx.homeDir, maxBytes: 16 })

      expect(result.imported).toBe(0)
      expect(result.failed).toBe(1)
    } finally {
      ctx.cleanup()
    }
  })
})

describe("cross-provider sourceHash collision", () => {
  // `ChatRecord.sourceHash` is ONE field while dedup is per-provider, so a chat
  // imported from claude and later given a codex token is the import target of
  // both. The hashes then never match, `applyDelta` runs, and NO existing entry
  // is keyable by the codex codec (they are claude ids) — an EMPTY `seen` over a
  // non-empty transcript, which reads as "everything is new" and re-appends the
  // whole rollout on top of the transcript the user already watched, forever.
  test("a codex rollout never re-appends over a claude transcript", async () => {
    const ctx = fresh()
    try {
      const CLAUDE_ID = "8b9c0d1e-2f3a-4b4c-8d5e-6f7a8b9c0d1e"
      const CODEX_ID = "9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f"
      seedSession(ctx.homeDir, ctx.realProj, CLAUDE_ID)
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const first = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(first.imported).toBe(1)
      const chat = [...store.state.chatsById.values()].find((c) => !c.deletedAt)
      const chatId = chat?.id ?? ""
      const claudeEntryCount = store.getMessages(chatId).length
      expect(claudeEntryCount).toBeGreaterThan(0)

      // The user switches the chat to codex and runs a turn: codex writes a
      // rollout and the chat gains a codex session token.
      seedCodexSession(ctx.homeDir, ctx.realProj, CODEX_ID)
      await store.setChatProvider(chatId, "codex")
      await store.setSessionTokenForProvider(chatId, "codex", CODEX_ID)

      const second = await importAllSessions({ store, homeDir: ctx.homeDir })

      expect(store.getMessages(chatId).length).toBe(claudeEntryCount)
      expect(second.failed).toBe(1)
      expect(second.updated).toBe(0)

      // And it must not oscillate: a second pass changes nothing either.
      const third = await importAllSessions({ store, homeDir: ctx.homeDir })
      expect(store.getMessages(chatId).length).toBe(claudeEntryCount)
      expect(third.failed).toBe(1)
    } finally {
      ctx.cleanup()
    }
  })
})
