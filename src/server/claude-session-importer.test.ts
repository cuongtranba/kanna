import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { importClaudeSessions, importSessionsByIds } from "./claude-session-importer.adapter"
import type { SessionImportedInfo } from "./claude-session-importer.adapter"
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

function md5File(filePath: string) {
  return createHash("md5").update(readFileSync(filePath, "utf8")).digest("hex")
}

describe("importClaudeSessions", () => {
  test("imports a session, creating project + chat + messages", async () => {
    const ctx = fresh()
    try {
      seedSession(ctx.homeDir, ctx.realProj, "sess-aaa")
      const store = createTestEventStore(ctx.dataDir)
      await store.initialize()

      const result = await importClaudeSessions({ store, homeDir: ctx.homeDir })

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

      await importClaudeSessions({ store, homeDir: ctx.homeDir })
      const second = await importClaudeSessions({ store, homeDir: ctx.homeDir })

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

      const result = await importClaudeSessions({ store, homeDir: ctx.homeDir })
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
      const result = await importClaudeSessions({ store, homeDir: ctx.homeDir })
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
      const result = await importClaudeSessions({ store, homeDir: ctx.homeDir })
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
      const result = await importClaudeSessions({ store, homeDir: ctx.homeDir })
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

      const result = await importClaudeSessions({ store, homeDir: ctx.homeDir })
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

      const result = await importClaudeSessions({ store, homeDir: ctx.homeDir })
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

      const first = await importClaudeSessions({ store, homeDir: ctx.homeDir })
      expect(first.imported).toBe(1)

      const second = await importClaudeSessions({ store, homeDir: ctx.homeDir })
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

      const first = await importClaudeSessions({ store, homeDir: ctx.homeDir })
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

      const second = await importClaudeSessions({ store, homeDir: ctx.homeDir })
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
})
