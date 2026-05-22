import { describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import type { OAuthTokenEntry, SlashCommand, TranscriptEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import { AsyncEventQueue } from "./test-helpers/async-event-queue"
import { waitFor } from "./test-helpers/wait-for"

// Multi-chat fake store keyed by chatId. The companion fixture in
// agent.oauth-rotation.test.ts hard-codes chat-1; this version supports any
// number of chats so we can exercise the cap-sharing path
// (adr-20260522-oauth-token-share-cap).
function createMultiChatStore(chatIds: string[]) {
  const chats = new Map<string, {
    id: string
    projectId: string
    title: string
    provider: "claude" | "codex" | null
    planMode: boolean
    sessionToken: string | null
    sessionTokensByProvider: Partial<Record<"claude" | "codex", string | null>>
    slashCommands: SlashCommand[] | undefined
    pendingForkSessionToken: { provider: "claude" | "codex"; token: string } | null
  }>()
  for (const id of chatIds) {
    chats.set(id, {
      id,
      projectId: "project-1",
      title: `Chat ${id}`,
      provider: null,
      planMode: false,
      sessionToken: null,
      sessionTokensByProvider: {},
      slashCommands: undefined,
      pendingForkSessionToken: null,
    })
  }
  const project = { id: "project-1", localPath: "/tmp/project" }
  return {
    chats,
    messages: [] as TranscriptEntry[],
    queuedMessages: [] as Array<{
      id: string
      content: string
      attachments: unknown[]
      createdAt: number
      provider?: string
      model?: string
      modelOptions?: unknown
      planMode?: boolean
      autoContinue?: unknown
    }>,
    autoContinueEvents: [] as AutoContinueEvent[],
    turnFinishedCount: 0,
    turnFailedCount: 0,
    turnFailures: [] as Array<{ chatId: string; reason: string }>,
    commandsLoaded: [] as Array<{ chatId: string; commands: SlashCommand[] }>,
    async recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]) {
      this.commandsLoaded.push({ chatId, commands })
      const c = chats.get(chatId)
      if (c) c.slashCommands = commands
    },
    requireChat(chatId: string) {
      const c = chats.get(chatId)
      if (!c) throw new Error(`unknown chat ${chatId}`)
      return c
    },
    getChat(chatId: string) {
      return chats.get(chatId) ?? null
    },
    getProject(_projectId: string) {
      return project
    },
    getMessages() {
      return this.messages
    },
    async setChatProvider(chatId: string, provider: "claude" | "codex") {
      const c = chats.get(chatId); if (c) c.provider = provider
    },
    async setPlanMode(chatId: string, planMode: boolean) {
      const c = chats.get(chatId); if (c) c.planMode = planMode
    },
    async renameChat(chatId: string, title: string) {
      const c = chats.get(chatId); if (c) c.title = title
    },
    async appendMessage(_chatId: string, entry: TranscriptEntry) {
      this.messages.push(entry)
    },
    async recordTurnStarted() {},
    async recordTurnFinished() {
      this.turnFinishedCount += 1
    },
    async recordTurnFailed(chatId: string, reason: string) {
      this.turnFailedCount += 1
      this.turnFailures.push({ chatId, reason })
    },
    async recordTurnCancelled() {},
    async appendAutoContinueEvent(event: AutoContinueEvent) {
      this.autoContinueEvents.push(event)
    },
    getAutoContinueEvents(chatId: string) {
      return this.autoContinueEvents.filter((e) => e.chatId === chatId)
    },
    listAutoContinueChats() {
      return [...new Set(this.autoContinueEvents.map((e) => e.chatId))]
    },
    async setSessionToken(chatId: string, sessionToken: string | null) {
      const c = chats.get(chatId); if (c) c.sessionToken = sessionToken
    },
    async setSessionTokenForProvider(chatId: string, provider: "claude" | "codex", sessionToken: string | null) {
      const c = chats.get(chatId)
      if (!c) return
      c.sessionTokensByProvider = { ...c.sessionTokensByProvider, [provider]: sessionToken }
      c.sessionToken = sessionToken
    },
    async setPendingForkSessionToken(chatId: string, value: { provider: "claude" | "codex"; token: string } | null) {
      const c = chats.get(chatId); if (c) c.pendingForkSessionToken = value
    },
    async createChat() {
      return chats.get(chatIds[0])!
    },
    async forkChat() {
      const src = chats.get(chatIds[0])!
      return { ...src, id: `${src.id}-fork`, sessionTokensByProvider: {} }
    },
    async enqueueMessage(_chatId: string, message: {
      content: string
      attachments?: unknown[]
      provider?: string
      model?: string
      modelOptions?: unknown
      planMode?: boolean
      autoContinue?: unknown
    }) {
      const queuedMessage = {
        id: crypto.randomUUID(),
        content: message.content,
        attachments: message.attachments ?? [],
        createdAt: Date.now(),
        provider: message.provider,
        model: message.model,
        modelOptions: message.modelOptions,
        planMode: message.planMode,
        autoContinue: message.autoContinue,
      }
      this.queuedMessages.push(queuedMessage)
      return queuedMessage
    },
    getQueuedMessages() {
      return [...this.queuedMessages]
    },
    getQueuedMessage(_chatId: string, id: string) {
      return this.queuedMessages.find((m) => m.id === id) ?? null
    },
    async removeQueuedMessage(_chatId: string, id: string) {
      this.queuedMessages = this.queuedMessages.filter((m) => m.id !== id)
    },
    *runningSubagentRuns() {
      // Empty — no subagent runs in this fixture.
    },
  }
}

function makeToken(id: string, overrides: Partial<OAuthTokenEntry> = {}): OAuthTokenEntry {
  return {
    id,
    label: id,
    token: `sk-ant-${id}`,
    status: "active",
    limitedUntil: null,
    lastUsedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    addedAt: 0,
    ...overrides,
  }
}

function makeRateLimitError(resetAt = Date.now() + 60_000) {
  return Object.assign(
    new Error(JSON.stringify({ error: { type: "rate_limit_error" } })),
    {
      status: 429,
      headers: { "anthropic-ratelimit-unified-reset": new Date(resetAt).toISOString() },
    },
  )
}

describe("AgentCoordinator OAuth share-cap smoke (adr-20260522-oauth-token-share-cap)", () => {
  test(
    "cap=2 on one token: two chats turn concurrently; force 429; both rotate; respawns staggered",
    async () => {
      // Pool: ONE shared token "a" with cap=2 (both chats land here at pick
      // time) plus a rotation target "b" that is initially disabled so the
      // pool's spread-load tiebreaker does not send chat-2 to b. We enable
      // b inside the first chat's sendPrompt — right before throwing 429 —
      // so the rotation pickActive that follows finds it as a target.
      let tokens: OAuthTokenEntry[] = [
        makeToken("a", { maxConcurrent: 2 }),
        makeToken("b", { status: "disabled", maxConcurrent: 2 }),
      ]
      const writeStatusCalls: Array<{ id: string; patch: { status?: string } }> = []
      const pool = new OAuthTokenPool(
        () => tokens,
        (id, patch) => {
          writeStatusCalls.push({ id, patch: patch as { status?: string } })
          tokens = tokens.map((t) => (t.id === id ? { ...t, ...patch } : t))
        },
      )

      // Spawn telemetry: which token id was handed to which chat, and when.
      const spawns: Array<{ chatId: string; tokenId: string | null; at: number }> = []
      // Per-chat event queues so each chat has its own stream.
      const eventQueues = new Map<string, AsyncEventQueue<never>>()

      const store = createMultiChatStore(["chat-1", "chat-2"])
      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        startClaudeSession: async (args) => {
          const tokenId = tokens.find((t) => t.token === args.oauthToken)?.id ?? null
          const chatId = args.chatId ?? "unknown"
          spawns.push({ chatId, tokenId, at: Date.now() })
          const events = new AsyncEventQueue<never>()
          eventQueues.set(chatId, events)
          return {
            provider: "claude",
            stream: events,
            getAccountInfo: async () => null,
            interrupt: async () => {},
            close: () => {},
            setModel: async () => {},
            setPermissionMode: async () => {},
            getSupportedCommands: async () => [],
            sendPrompt: async () => {
              if (tokenId === "a") {
                // Enable rotation target right before throwing so the
                // rotation pickActive that follows finds "b" active.
                // Idempotent across both chats.
                tokens = tokens.map((t) => (
                  t.id === "b" ? { ...t, status: "active", maxConcurrent: 2 } : t
                ))
                events.throw(makeRateLimitError())
              }
              // Subsequent spawns (on "b" after rotation) — silent: do not
              // throw, do not emit a result. Test asserts only the rotation
              // bookkeeping, not the second turn.
            },
          }
        },
        oauthPool: pool,
      })

      // Fire two chats concurrently. With cap=2 on "a" both should land on "a".
      await Promise.all([
        coordinator.send({
          type: "chat.send",
          chatId: "chat-1",
          provider: "claude",
          content: "hello from 1",
          model: "claude-opus-4-7",
        }),
        coordinator.send({
          type: "chat.send",
          chatId: "chat-2",
          provider: "claude",
          content: "hello from 2",
          model: "claude-opus-4-7",
        }),
      ])

      // Wait for both rotations to land.
      await waitFor(
        () =>
          store.getAutoContinueEvents("chat-1").some((e) => e.kind === "auto_continue_accepted")
          && store.getAutoContinueEvents("chat-2").some((e) => e.kind === "auto_continue_accepted"),
        6000,
        "both chats received auto_continue_accepted rotation events",
      )

      // ── Assertion 1: both chats initially spawned on the shared token "a".
      const initialSpawns = spawns.filter((s) => s.tokenId === "a")
      expect(initialSpawns.map((s) => s.chatId).sort()).toEqual(["chat-1", "chat-2"])

      // ── Assertion 2: dedupe — exactly one writeStatus marked "a" as limited,
      // even though two chats independently detected the 429.
      const limitedCalls = writeStatusCalls.filter(
        (c) => c.id === "a" && c.patch.status === "limited",
      )
      expect(limitedCalls).toHaveLength(1)

      // ── Assertion 3: both chats received a token_rotation auto-continue
      // event (every shared owner rotates, none drops on the floor).
      for (const chatId of ["chat-1", "chat-2"]) {
        const accepted = store.getAutoContinueEvents(chatId).filter(
          (e) => e.kind === "auto_continue_accepted",
        )
        expect(accepted).toHaveLength(1)
        const ev = accepted[0]
        if (ev.kind !== "auto_continue_accepted") throw new Error("unreachable")
        expect(ev.source).toBe("token_rotation")
      }

      // ── Assertion 4: respawns are staggered — the two rotation events'
      // scheduledAt timestamps must differ by at least
      // TOKEN_ROTATION_HERD_STAGGER_MS (250) so the second cold-boot lands
      // after the first instead of stampeding. The dedupe slot in
      // acquireRotationSlot() applies extra delay only to the SECOND+ caller
      // per token within the 5s window, so the gap is exactly one stagger.
      const scheduledAts = store.autoContinueEvents
        .filter((e) => e.kind === "auto_continue_accepted")
        .map((e) => (e as { scheduledAt: number }).scheduledAt)
        .sort((a, b) => a - b)
      expect(scheduledAts).toHaveLength(2)
      const gap = scheduledAts[1] - scheduledAts[0]
      expect(gap).toBeGreaterThanOrEqual(250)
    },
    15_000,
  )
})
