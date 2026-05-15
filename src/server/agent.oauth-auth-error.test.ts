import { describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import type { HarnessEvent } from "./harness-types"
import type { OAuthTokenEntry, SlashCommand, TranscriptEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import { AsyncEventQueue } from "./test-helpers/async-event-queue"
import { waitFor } from "./test-helpers/wait-for"

// Mirrors the minimal fake store from agent.oauth-rotation.test.ts. Kept
// independent so a change there cannot silently change auth-error behaviour.

function createFakeStore() {
  const chat = {
    id: "chat-1",
    projectId: "project-1",
    title: "New Chat",
    provider: null as "claude" | "codex" | null,
    planMode: false,
    sessionToken: null as string | null,
    sessionTokensByProvider: {} as Partial<Record<"claude" | "codex", string | null>>,
    slashCommands: undefined as SlashCommand[] | undefined,
    pendingForkSessionToken: null as { provider: "claude" | "codex"; token: string } | null,
  }
  const project = { id: "project-1", localPath: "/tmp/project" }
  return {
    chat,
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
    turnFailures: [] as Array<{ chatId: string; reason: string }>,
    autoContinueEvents: [] as AutoContinueEvent[],
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
    getMessages() { return this.messages },
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
    async recordTurnFinished() {},
    async recordTurnFailed(chatId: string, reason: string) {
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
    async setSessionToken(_chatId: string, sessionToken: string | null) {
      chat.sessionToken = sessionToken
    },
    async setSessionTokenForProvider(_chatId: string, provider: "claude" | "codex", sessionToken: string | null) {
      chat.sessionTokensByProvider = { ...chat.sessionTokensByProvider, [provider]: sessionToken }
      chat.sessionToken = sessionToken
    },
    async setPendingForkSessionToken(_chatId: string, value: { provider: "claude" | "codex"; token: string } | null) {
      chat.pendingForkSessionToken = value
    },
    async createChat() { return chat },
    async forkChat() { return chat },
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
    getQueuedMessages() { return [...this.queuedMessages] },
    getQueuedMessage(_chatId: string, queuedMessageId: string) {
      return this.queuedMessages.find((entry) => entry.id === queuedMessageId) ?? null
    },
    async removeQueuedMessage(_chatId: string, queuedMessageId: string) {
      this.queuedMessages = this.queuedMessages.filter((entry) => entry.id !== queuedMessageId)
    },
    *runningSubagentRuns() {},
  }
}

function makeToken(id: string, overrides: Partial<OAuthTokenEntry> = {}): OAuthTokenEntry {
  return {
    id, label: id, token: `sk-ant-${id}`,
    status: "active", limitedUntil: null,
    lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null,
    addedAt: 0, ...overrides,
  }
}

function timestamped<T extends Omit<TranscriptEntry, "_id" | "createdAt">>(entry: T): TranscriptEntry {
  return { _id: crypto.randomUUID(), createdAt: Date.now(), ...entry } as TranscriptEntry
}

describe("AgentCoordinator OAuth auth-error rotation (401)", () => {
  test(
    "401 result text marks the active token error and rotates to the next active token via token_rotation event",
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
      const capturedOauthTokens: Array<string | null> = []

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
              events.push({
                type: "transcript",
                entry: timestamped({
                  kind: "system_init",
                  provider: "claude",
                  model: "claude-opus-4-7",
                  tools: [],
                  agents: [],
                  slashCommands: [],
                  mcpServers: [],
                }),
              })
              events.push({
                type: "transcript",
                entry: timestamped({
                  kind: "result",
                  subtype: "error",
                  isError: true,
                  durationMs: 0,
                  result: "Failed to authenticate. API Error: 401 Invalid authentication credentials",
                }),
              })
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
        () => writeStatusCalls.some((c) => (c.patch as { status?: string }).status === "error")
          && store.autoContinueEvents.some((e) => e.kind === "auto_continue_accepted"),
        4000,
        "token marked error + auto_continue_accepted event written",
      )

      // First spawn picked token "a".
      expect(capturedOauthTokens[0]).toBe("sk-ant-a")

      // Token "a" was marked error with the 401 message preserved.
      const erroredCall = writeStatusCalls.find(
        (c) => (c.patch as { status?: string }).status === "error",
      )
      expect(erroredCall).toBeDefined()
      expect(erroredCall!.id).toBe("a")
      expect((erroredCall!.patch as { lastErrorMessage?: string }).lastErrorMessage)
        .toContain("Invalid authentication credentials")

      // Auto-continue rotation event emitted with source token_rotation.
      const accepted = store.getAutoContinueEvents("chat-1").filter(
        (e) => e.kind === "auto_continue_accepted",
      )
      expect(accepted).toHaveLength(1)
      if (accepted[0]?.kind === "auto_continue_accepted") {
        expect(accepted[0].source).toBe("token_rotation")
      }

      // Turn fail reason is "auth_error", not "rate_limit" — semantic distinction.
      expect(store.turnFailures.some((f) => f.reason === "auth_error")).toBe(true)
      expect(store.turnFailures.some((f) => f.reason === "rate_limit")).toBe(false)
    },
    10_000,
  )

  test(
    "401 with no other usable token tears down session but does NOT propose auto-continue",
    async () => {
      let tokens: OAuthTokenEntry[] = [makeToken("a")]
      const writeStatusCalls: Array<{ id: string; patch: unknown }> = []
      const pool = new OAuthTokenPool(
        () => tokens,
        (id, patch) => {
          writeStatusCalls.push({ id, patch })
          tokens = tokens.map((t) => (t.id === id ? { ...t, ...patch } : t))
        },
      )

      const events = new AsyncEventQueue<HarnessEvent>()
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
            events.push({
              type: "transcript",
              entry: timestamped({
                kind: "system_init",
                provider: "claude",
                model: "claude-opus-4-7",
                tools: [],
                agents: [],
                slashCommands: [],
                mcpServers: [],
              }),
            })
            events.push({
              type: "transcript",
              entry: timestamped({
                kind: "result",
                subtype: "error",
                isError: true,
                durationMs: 0,
                result: "Failed to authenticate. API Error: 401 Invalid authentication credentials",
              }),
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

      // Wait long enough for the result to be processed.
      await waitFor(
        () => writeStatusCalls.some((c) => (c.patch as { status?: string }).status === "error"),
        4000,
        "single token marked error",
      )

      // No rotation candidate available, so no auto_continue_accepted is emitted.
      const accepted = store.getAutoContinueEvents("chat-1").filter(
        (e) => e.kind === "auto_continue_accepted",
      )
      expect(accepted).toHaveLength(0)
    },
    10_000,
  )
})
