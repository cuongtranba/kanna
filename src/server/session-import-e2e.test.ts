import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { importOneSession, importSessionsByIds } from "./claude-session-importer.adapter"
import { createFollowedSessionRegistry } from "./followed-session-registry"
import { statSessionFile } from "./followed-session-io.adapter"
import { claudeSessionSource } from "./session-source-registry"
import { writeTribeSessionFixture } from "./__fixtures__/tribe-session-fixture"
import { createTestEventStore } from "./storage/test-helpers"

const SESSION_ID = "9f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"

describe("session import E2E (Tribe-shaped fixture)", () => {
  test(
    "import by uuid creates a chat with entries, then a live-tail tick appends the delta idempotently",
    async () => {
      const tmpHome = mkdtempSync(join(tmpdir(), "kanna-e2e-home-"))
      const cwd = mkdtempSync(join(tmpdir(), "kanna-cwd-"))
      const dataDir = mkdtempSync(join(tmpdir(), "kanna-data-"))

      const projectsRoot = join(tmpHome, ".claude", "projects", "some-encoded-name")
      const fixture = writeTribeSessionFixture(projectsRoot, { sessionId: SESSION_ID, cwd })

      const store = createTestEventStore(dataDir)
      const seen: { chatId: string; sessionId: string; sourcePath: string; sourceMtimeMs: number }[] = []
      const result = await importSessionsByIds({
        store,
        homeDir: tmpHome,
        sessionIds: [SESSION_ID],
        onSessionImported: (info) => seen.push(info),
      })

      expect(result.results[0]).toMatchObject({ sessionId: SESSION_ID, status: "created" })
      const chatId = result.results[0].chatId!
      const before = store.getMessages(chatId)
      expect(before.length).toBeGreaterThan(0)
      expect(seen[0]).toMatchObject({ chatId, sessionId: SESSION_ID, sourcePath: fixture.mainJsonlPath })

      const registry = createFollowedSessionRegistry({
        statFile: statSessionFile,
        runDelta: async (cid, sourcePath) => {
          const parsed = claudeSessionSource.parse(sourcePath)
          if (parsed.kind === "parsed") await importOneSession(store, parsed.session)
        },
        isTurnActive: () => false,
        now: () => Date.now(),
        onChange: () => {},
        activeWindowMs: 600_000,
        idleMs: 600_000,
      })
      registry.consider(seen[0])

      fixture.appendLine({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "turn 2" }] },
      })
      await registry.tick()

      const after = store.getMessages(chatId)
      expect(after.length).toBeGreaterThan(before.length)

      // Second tick with no further file growth: the delta path must be
      // idempotent (uuid-dedupe means re-parsing the same file never
      // re-appends already-seen rows), not just "always re-import everything".
      await registry.tick()
      expect(store.getMessages(chatId).length).toBe(after.length)
    },
    15_000,
  )
})
