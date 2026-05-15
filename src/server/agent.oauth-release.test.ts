import { describe, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import type { HarnessEvent } from "./harness-types"
import type { OAuthTokenEntry, SlashCommand, TranscriptEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import { AsyncEventQueue } from "./test-helpers/async-event-queue"
import { waitFor } from "./test-helpers/wait-for"

// Minimal fake store — same shape as oauth-rotation.test.ts but kept local so
// these reservation-lifetime tests stay independent of rotation-test edits.
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
    requireChat(_chatId: string) { return chat },
    getChat(chatId: string) { return chatId === "chat-1" ? chat : null },
    getProject() { return project },
    getMessages() { return this.messages },
    async setChatProvider(_chatId: string, provider: "claude" | "codex") { chat.provider = provider },
    async setPlanMode(_chatId: string, planMode: boolean) { chat.planMode = planMode },
    async renameChat(_chatId: string, title: string) { chat.title = title },
    async appendMessage(_chatId: string, entry: TranscriptEntry) { this.messages.push(entry) },
    async recordTurnStarted() {},
    async recordTurnFinished() { this.turnFinishedCount += 1 },
    turnFailedCount: 0,
    turnFailures: [] as Array<{ chatId: string; reason: string }>,
    async recordTurnFailed(chatId: string, reason: string) {
      this.turnFailedCount += 1
      this.turnFailures.push({ chatId, reason })
    },
    async recordTurnCancelled() {},
    autoContinueEvents: [] as AutoContinueEvent[],
    async appendAutoContinueEvent(event: AutoContinueEvent) { this.autoContinueEvents.push(event) },
    getAutoContinueEvents(chatId: string) { return this.autoContinueEvents.filter((e) => e.chatId === chatId) },
    listAutoContinueChats() { return [...new Set(this.autoContinueEvents.map((e) => e.chatId))] },
    async setSessionToken(_chatId: string, sessionToken: string | null) { chat.sessionToken = sessionToken },
    async setSessionTokenForProvider(_chatId: string, provider: "claude" | "codex", sessionToken: string | null) {
      chat.sessionTokensByProvider = { ...chat.sessionTokensByProvider, [provider]: sessionToken }
      chat.sessionToken = sessionToken
    },
    async setPendingForkSessionToken(_chatId: string, value: { provider: "claude" | "codex"; token: string } | null) {
      chat.pendingForkSessionToken = value
    },
    async createChat() { return chat },
    async forkChat() { return { ...chat, id: "chat-fork-1", title: "Fork", sessionTokensByProvider: {}, pendingForkSessionToken: null } },
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

describe("OAuth pool reservation lifetime", () => {
  test("reservation released when turn finishes — another chat can claim the same token", async () => {
    // Single-token pool exposes the over-sticky reservation bug: before the
    // fix, chat-1's reservation persists for the entire chat lifetime so a
    // second chat can never claim the same token even when chat-1 is idle.
    let tokens: OAuthTokenEntry[] = [makeToken("a")]
    const pool = new OAuthTokenPool(
      () => tokens,
      (id, patch) => {
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
            entry: {
              _id: "result-1",
              createdAt: Date.now(),
              kind: "result",
              subtype: "success",
              isError: false,
              durationMs: 100,
              result: "",
            } as never,
          })
          events.close()
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
      () => store.turnFinishedCount > 0,
      4000,
      "chat-1 turn finished",
    )

    // Wait for runTurn's finally to drain after the stream closes.
    await waitFor(
      () => pool.pickActive("chat-other")?.id === "a",
      4000,
      "reservation released after turn finished",
    )
  }, 10_000)
})
