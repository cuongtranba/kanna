import { describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import type { OAuthTokenEntry, SlashCommand, TranscriptEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import { AsyncEventQueue } from "./test-helpers/async-event-queue"
import { waitFor } from "./test-helpers/wait-for"

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
    getRecentRawEntries(_chatId: string, limit: number) {
      return this.messages.slice(-limit)
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

      const spawns: Array<{ chatId: string; tokenId: string | null; at: number }> = []
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
            closed: Promise.resolve(),
            setModel: async () => {},
            setPermissionMode: async () => {},
            getSupportedCommands: async () => [],
            sendPrompt: async () => {
              if (tokenId === "a") {
                tokens = tokens.map((t) => (
                  t.id === "b" ? { ...t, status: "active", maxConcurrent: 2 } : t
                ))
                events.throw(makeRateLimitError())
              }
            },
          }
        },
        oauthPool: pool,
      })

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

      await waitFor(
        () =>
          store.getAutoContinueEvents("chat-1").some((e) => e.kind === "auto_continue_accepted")
          && store.getAutoContinueEvents("chat-2").some((e) => e.kind === "auto_continue_accepted"),
        6000,
        "both chats received auto_continue_accepted rotation events",
      )

      const initialSpawns = spawns.filter((s) => s.tokenId === "a")
      expect(initialSpawns.map((s) => s.chatId).sort()).toEqual(["chat-1", "chat-2"])

      const limitedCalls = writeStatusCalls.filter(
        (c) => c.id === "a" && c.patch.status === "limited",
      )
      expect(limitedCalls).toHaveLength(1)

      for (const chatId of ["chat-1", "chat-2"]) {
        const accepted = store.getAutoContinueEvents(chatId).filter(
          (e) => e.kind === "auto_continue_accepted",
        )
        expect(accepted).toHaveLength(1)
        const ev = accepted[0]
        if (ev.kind !== "auto_continue_accepted") throw new Error("unreachable")
        expect(ev.source).toBe("token_rotation")
      }

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
