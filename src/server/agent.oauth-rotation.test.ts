import { describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import type { HarnessEvent } from "./harness-types"
import type { OAuthTokenEntry, SlashCommand, TranscriptEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import { AsyncEventQueue } from "./test-helpers/async-event-queue"
import { waitFor } from "./test-helpers/wait-for"

// ── Helpers (minimal copies from agent.test.ts — do NOT modify agent.test.ts) ──

function createFakeStore() {
  const chat = {
    id: "chat-1",
    projectId: "project-1",
    title: "New Chat",
    provider: null as "claude" | "codex" | null,
    planMode: false,
    sessionToken: null as string | null,
    slashCommands: undefined as SlashCommand[] | undefined,
    pendingForkSessionToken: null as string | null,
  }
  const project = {
    id: "project-1",
    localPath: "/tmp/project",
  }
  return {
    chat,
    turnFinishedCount: 0,
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
    commandsLoaded: [] as Array<{ chatId: string; commands: SlashCommand[] }>,
    async recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]) {
      this.commandsLoaded.push({ chatId, commands })
      chat.slashCommands = commands
    },
    requireChat(chatId: string) {
      expect(chatId).toBe("chat-1")
      return chat
    },
    getChat(chatId: string) {
      if (chatId !== "chat-1") return null
      return chat
    },
    getProject(projectId: string) {
      expect(projectId).toBe("project-1")
      return project
    },
    getMessages() {
      return this.messages
    },
    async setChatProvider(_chatId: string, provider: "claude" | "codex") {
      chat.provider = provider
    },
    async setPlanMode(_chatId: string, planMode: boolean) {
      chat.planMode = planMode
    },
    async renameChat(_chatId: string, title: string) {
      chat.title = title
    },
    async appendMessage(_chatId: string, entry: TranscriptEntry) {
      this.messages.push(entry)
    },
    async recordTurnStarted() {},
    async recordTurnFinished() {
      this.turnFinishedCount += 1
    },
    turnFailedCount: 0,
    turnFailures: [] as Array<{ chatId: string; reason: string }>,
    async recordTurnFailed(chatId: string, reason: string) {
      this.turnFailedCount += 1
      this.turnFailures.push({ chatId, reason })
    },
    async recordTurnCancelled() {},
    autoContinueEvents: [] as AutoContinueEvent[],
    async appendAutoContinueEvent(event: AutoContinueEvent) {
      this.autoContinueEvents.push(event)
    },
    getAutoContinueEvents(chatId: string) {
      return this.autoContinueEvents.filter((e) => e.chatId === chatId)
    },
    listAutoContinueChats() {
      return [...new Set(this.autoContinueEvents.map((e) => e.chatId))]
    },
    async setSessionToken(_chatId: string, sessionToken: string | null) {
      chat.sessionToken = sessionToken
    },
    async setPendingForkSessionToken(_chatId: string, pendingForkSessionToken: string | null) {
      chat.pendingForkSessionToken = pendingForkSessionToken
    },
    async createChat() {
      return chat
    },
    async forkChat() {
      return {
        ...chat,
        id: "chat-fork-1",
        title: "Fork: New Chat",
        sessionToken: null,
        pendingForkSessionToken: chat.sessionToken ?? chat.pendingForkSessionToken,
      }
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
    getQueuedMessage(_chatId: string, queuedMessageId: string) {
      return this.queuedMessages.find((entry) => entry.id === queuedMessageId) ?? null
    },
    async removeQueuedMessage(_chatId: string, queuedMessageId: string) {
      this.queuedMessages = this.queuedMessages.filter((entry) => entry.id !== queuedMessageId)
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
  const err = Object.assign(
    new Error(JSON.stringify({ error: { type: "rate_limit_error" } })),
    {
      status: 429,
      headers: {
        "anthropic-ratelimit-unified-reset": new Date(resetAt).toISOString(),
      },
    }
  )
  return err
}

// ── Tests ──

describe("AgentCoordinator OAuth rotation", () => {
  test(
    "rate-limit marks the active token limited and emits a token_rotation event",
    async () => {
      let tokens: OAuthTokenEntry[] = [makeToken("a"), makeToken("b")]
      const writeStatusCalls: Array<{ id: string; patch: unknown }> = []

      const pool = new OAuthTokenPool(
        () => tokens,
        (id, patch) => {
          writeStatusCalls.push({ id, patch })
          tokens = tokens.map((t) => (t.id === id ? { ...t, ...patch } : t))
        },
      )

      const capturedOauthTokens: Array<string | null> = []
      const events = new AsyncEventQueue<never>()
      const limitErr = makeRateLimitError()

      const store = createFakeStore()
      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        startClaudeSession: async (args) => {
          capturedOauthTokens.push(args.oauthToken)
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
              // Throw the rate-limit error from the stream once sendPrompt is called.
              // activeTurns is already set at this point by startTurnForChat.
              events.throw(limitErr)
            },
          }
        },
        oauthPool: pool,
      })

      await coordinator.send({
        type: "chat.send",
        chatId: "chat-1",
        provider: "claude",
        content: "test",
        model: "claude-opus-4-7",
      })

      // Wait for the rate-limit to be detected and the auto-continue event to land.
      await waitFor(
        () =>
          writeStatusCalls.some(
            (c) => (c.patch as { status?: string }).status === "limited"
          ) && store.autoContinueEvents.some((e) => e.kind === "auto_continue_accepted"),
        4000,
        "token marked limited + auto_continue_accepted event written",
      )

      // The first (and only) oauth token used should be from token "a".
      expect(capturedOauthTokens[0]).toBe("sk-ant-a")

      // writeStatus should have been called to mark "a" as limited.
      const limitedCall = writeStatusCalls.find(
        (c) => (c.patch as { status?: string }).status === "limited",
      )
      expect(limitedCall).toBeDefined()
      expect(limitedCall!.id).toBe("a")

      // Exactly one auto_continue_accepted event with source "token_rotation".
      const acceptedEvents = store.getAutoContinueEvents("chat-1").filter(
        (e) => e.kind === "auto_continue_accepted",
      )
      expect(acceptedEvents).toHaveLength(1)
      if (acceptedEvents[0]?.kind === "auto_continue_accepted") {
        expect(acceptedEvents[0].source).toBe("token_rotation")
      } else {
        throw new Error("Expected auto_continue_accepted event")
      }
    },
    10_000,
  )

  test(
    "SDK rate_limit_event in stream triggers rotation without error throw",
    async () => {
      let tokens: OAuthTokenEntry[] = [makeToken("a"), makeToken("b")]
      const writeStatusCalls: Array<{ id: string; patch: unknown }> = []

      const pool = new OAuthTokenPool(
        () => tokens,
        (id, patch) => {
          writeStatusCalls.push({ id, patch })
          tokens = tokens.map((t) => (t.id === id ? { ...t, ...patch } : t))
        },
      )

      const events = new AsyncEventQueue<HarnessEvent>()
      const resetAt = Date.now() + 60_000

      const store = createFakeStore()
      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        startClaudeSession: async () => ({
          provider: "claude",
          stream: events,
          getAccountInfo: async () => null,
          interrupt: async () => {},
          close: () => {},
          setModel: async () => {},
          setPermissionMode: async () => {},
          getSupportedCommands: async () => [],
          sendPrompt: async () => {
            // Emit the SDK rate-limit event into the harness stream.
            events.push({
              type: "rate_limit",
              rateLimit: { resetAt, tz: "system" },
            })
          },
        }),
        oauthPool: pool,
      })

      await coordinator.send({
        type: "chat.send",
        chatId: "chat-1",
        provider: "claude",
        content: "test",
        model: "claude-opus-4-7",
      })

      await waitFor(
        () =>
          writeStatusCalls.some((c) => (c.patch as { status?: string }).status === "limited")
          && store.autoContinueEvents.some((e) => e.kind === "auto_continue_accepted"),
        4000,
        "rate_limit event in stream marks token limited + emits auto_continue_accepted",
      )

      const limitedCall = writeStatusCalls.find(
        (c) => (c.patch as { status?: string }).status === "limited",
      )
      expect(limitedCall!.id).toBe("a")
      expect((limitedCall!.patch as { limitedUntil?: number }).limitedUntil).toBe(resetAt)

      const accepted = store.getAutoContinueEvents("chat-1").find(
        (e) => e.kind === "auto_continue_accepted",
      )
      if (accepted?.kind === "auto_continue_accepted") {
        expect(accepted.source).toBe("token_rotation")
      } else {
        throw new Error("Expected auto_continue_accepted event")
      }
    },
    10_000,
  )

  test(
    "fireAutoContinue after rotation spawns a fresh session bound to the rotated token",
    async () => {
      let tokens: OAuthTokenEntry[] = [makeToken("a"), makeToken("b")]
      const writeStatusCalls: Array<{ id: string; patch: unknown }> = []

      const pool = new OAuthTokenPool(
        () => tokens,
        (id, patch) => {
          writeStatusCalls.push({ id, patch })
          tokens = tokens.map((t) => (t.id === id ? { ...t, ...patch } : t))
        },
      )

      const capturedOauthTokens: Array<string | null> = []
      const closeCalls: number[] = []
      let sessionCounter = 0
      const resetAt = Date.now() + 60_000

      const store = createFakeStore()
      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        startClaudeSession: async (args) => {
          capturedOauthTokens.push(args.oauthToken)
          const events = new AsyncEventQueue<HarnessEvent>()
          const sessionIndex = sessionCounter++
          return {
            provider: "claude",
            stream: events,
            getAccountInfo: async () => null,
            interrupt: async () => {},
            close: () => { closeCalls.push(sessionIndex) },
            setModel: async () => {},
            setPermissionMode: async () => {},
            getSupportedCommands: async () => [],
            sendPrompt: async () => {
              if (sessionIndex === 0) {
                events.push({
                  type: "rate_limit",
                  rateLimit: { resetAt, tz: "system" },
                })
              }
            },
          }
        },
        oauthPool: pool,
      })

      await coordinator.send({
        type: "chat.send",
        chatId: "chat-1",
        provider: "claude",
        content: "test",
        model: "claude-opus-4-7",
      })

      await waitFor(
        () => store.autoContinueEvents.some((e) => e.kind === "auto_continue_accepted"),
        4000,
        "auto_continue_accepted emitted",
      )

      const accepted = store.getAutoContinueEvents("chat-1").find(
        (e) => e.kind === "auto_continue_accepted",
      )
      if (accepted?.kind !== "auto_continue_accepted") {
        throw new Error("Expected auto_continue_accepted event")
      }

      await coordinator.fireAutoContinue("chat-1", accepted.scheduleId)

      await waitFor(
        () => capturedOauthTokens.length >= 2,
        4000,
        "second session started after rotation",
      )

      expect(capturedOauthTokens[0]).toBe("sk-ant-a")
      expect(capturedOauthTokens[1]).toBe("sk-ant-b")
      expect(closeCalls).toContain(0)
    },
    10_000,
  )
})
