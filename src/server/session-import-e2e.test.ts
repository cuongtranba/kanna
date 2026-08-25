import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { importOneSession, importSessionsByIds, type SessionImportedInfo } from "./claude-session-importer.adapter"
import { createFollowedSessionRegistry, createSessionDeltaRunner } from "./followed-session-registry"
import { statSessionFile } from "./followed-session-io.adapter"
import { sourceForProvider } from "./session-source-registry"
import { writeTribeSessionFixture } from "./__fixtures__/tribe-session-fixture"
import { writeCodexRolloutFixture } from "./__fixtures__/codex-rollout-fixture"
import { createTestEventStore } from "./storage/test-helpers"

const SESSION_ID = "9f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"
const CODEX_SESSION_ID = "3c7a1d2e-5b64-4f8a-9c1d-7e2f3a4b5c6d"

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
        // The REAL routing, as `server.ts` wires it — a claude-only runDelta
        // here reproduces the pre-fix behaviour and proves nothing about which
        // reader a followed chat is actually handed to.
        runDelta: createSessionDeltaRunner({
          providerOf: (cid) => store.state.chatsById.get(cid)?.provider ?? null,
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

/**
 * The routing test the suite did not have.
 *
 * Reverting `runDelta` to a hardcoded claude reader used to leave the WHOLE
 * suite green while every followed codex chat silently stopped receiving
 * deltas: both live-tail integration tests supplied their own claude-only
 * `runDelta`, so they reproduced the pre-fix behaviour rather than catching it.
 * This one goes through `createSessionDeltaRunner` — the same wiring
 * `server.ts` builds — with a CODEX chat, so claude's reader answering
 * `rejected` on a rollout is a failing assertion instead of a silent drop.
 */
describe("codex live-tail (provider routing)", () => {
  test(
    "a followed codex chat is parsed by the codex reader, and its rollout delta lands",
    async () => {
      const tmpHome = mkdtempSync(join(tmpdir(), "kanna-e2e-codex-home-"))
      const cwd = mkdtempSync(join(tmpdir(), "kanna-codex-cwd-"))
      const dataDir = mkdtempSync(join(tmpdir(), "kanna-codex-data-"))
      try {
        const fixture = writeCodexRolloutFixture(
          join(tmpHome, ".codex", "sessions", "2026", "06", "07"),
          { sessionId: CODEX_SESSION_ID, cwd },
        )

        const store = createTestEventStore(dataDir)
        const seen: SessionImportedInfo[] = []
        const result = await importSessionsByIds({
          store,
          homeDir: tmpHome,
          sessionIds: [CODEX_SESSION_ID],
          onSessionImported: (info) => seen.push(info),
        })
        expect(result.results[0]).toMatchObject({ sessionId: CODEX_SESSION_ID, status: "created" })
        const chatId = result.results[0].chatId!
        expect(store.state.chatsById.get(chatId)?.provider).toBe("codex")
        const before = store.getMessages(chatId)
        expect(before.length).toBeGreaterThan(0)
        expect(seen[0]).toMatchObject({ chatId, sourcePath: fixture.rolloutPath })

        const registry = createFollowedSessionRegistry({
          statFile: statSessionFile,
          runDelta: createSessionDeltaRunner({
            providerOf: (cid) => store.state.chatsById.get(cid)?.provider ?? null,
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
        registry.consider(seen[0])
        expect(registry.isFollowing(chatId)).toBe(true)

        fixture.appendLine({
          timestamp: "2026-06-07T06:01:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "codex turn 2" }],
          },
        })
        await registry.tick()

        const after = store.getMessages(chatId)
        expect(after.length).toBeGreaterThan(before.length)
        expect(
          after.some((entry) => entry.kind === "assistant_text" && entry.text.includes("codex turn 2")),
        ).toBe(true)
        // A claude reader would have answered `rejected`, which is a delta
        // FAILURE — the chat must still be followed, not dropped.
        expect(registry.isFollowing(chatId)).toBe(true)

        // Idempotent: no further growth means no further append.
        await registry.tick()
        expect(store.getMessages(chatId).length).toBe(after.length)
      } finally {
        rmSync(tmpHome, { recursive: true, force: true })
        rmSync(cwd, { recursive: true, force: true })
        rmSync(dataDir, { recursive: true, force: true })
      }
    },
    15_000,
  )
})
