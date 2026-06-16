import { describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import type { HarnessEvent } from "./harness-types"
import type { AccountInfo, OAuthTokenEntry, SlashCommand, TranscriptEntry } from "../shared/types"
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
    sessionTokensByProvider: {} as Partial<Record<"claude" | "codex", string | null>>,
    slashCommands: undefined as SlashCommand[] | undefined,
    pendingForkSessionToken: null as { provider: "claude" | "codex"; token: string } | null,
  }
  const project = { id: "project-1", localPath: "/tmp/project" }
  return {
    chat,
    turnFinishedCount: 0,
    messages: [] as TranscriptEntry[],
    queuedMessages: [] as Array<{ id: string; content: string }>,
    commandsLoaded: [] as Array<{ chatId: string; commands: SlashCommand[] }>,
    async recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]) {
      this.commandsLoaded.push({ chatId, commands })
      chat.slashCommands = commands
    },
    requireChat() {
      return chat
    },
    getChat(chatId: string) {
      if (chatId !== "chat-1") return null
      return chat
    },
    getProject() {
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
    async recordTurnFailed() {
      this.turnFailedCount += 1
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
    async setSessionTokenForProvider(_chatId: string, provider: "claude" | "codex", sessionToken: string | null) {
      chat.sessionTokensByProvider = { ...chat.sessionTokensByProvider, [provider]: sessionToken }
      chat.sessionToken = sessionToken
    },
    async setPendingForkSessionToken(_chatId: string, value: { provider: "claude" | "codex"; token: string } | null) {
      chat.pendingForkSessionToken = value
    },
    async createChat() {
      return chat
    },
    async enqueueMessage() {
      return { id: crypto.randomUUID(), content: "" }
    },
    getQueuedMessages() {
      return [...this.queuedMessages]
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

function accountInfoEntry(messages: TranscriptEntry[]): AccountInfo | null {
  const entry = messages.find((m) => m.kind === "account_info")
  if (!entry || entry.kind !== "account_info") return null
  return entry.accountInfo
}

describe("AgentCoordinator SDK OAuth-pool account info parity", () => {
  test(
    "augments SDK account_info with the pool token name and kanna-oauth-pool source",
    async () => {
      const tokens: OAuthTokenEntry[] = [makeToken("tok1", { label: "Primary Pool Key" })]
      const pool = new OAuthTokenPool(() => tokens, () => {})

      const events = new AsyncEventQueue<HarnessEvent>()
      const store = createFakeStore()
      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        startClaudeSession: async () => ({
          provider: "claude",
          stream: events,
          // SDK-reported account info knows nothing about the kanna pool name.
          getAccountInfo: async (): Promise<AccountInfo> => ({
            tokenSource: "CLAUDE_CODE_OAUTH_TOKEN",
            email: "user@example.com",
            subscriptionType: "Max",
          }),
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
                durationMs: 0,
                result: "done",
              } as never,
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
        () => accountInfoEntry(store.messages) !== null,
        4000,
        "account_info entry appended",
      )

      const info = accountInfoEntry(store.messages)!
      // Name (PTY mirror): pool token label surfaces as organization.
      expect(info.organization).toBe("Primary Pool Key")
      // Source (PTY mirror): kanna-oauth-pool → UI renders "Pool token".
      expect(info.tokenSource).toBe("kanna-oauth-pool")
      // Masked key still attached.
      expect(info.oauthKeyMasked).toBeTruthy()
      // SDK-reported extras preserved (PTY lacks these).
      expect(info.email).toBe("user@example.com")
      expect(info.subscriptionType).toBe("Max")
    },
    10_000,
  )

  test(
    "leaves SDK account_info untouched when no pool token was picked",
    async () => {
      const events = new AsyncEventQueue<HarnessEvent>()
      const store = createFakeStore()
      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        startClaudeSession: async () => ({
          provider: "claude",
          stream: events,
          getAccountInfo: async (): Promise<AccountInfo> => ({
            tokenSource: "CLAUDE_CODE_OAUTH_TOKEN",
            organization: "Real Org",
          }),
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
                durationMs: 0,
                result: "done",
              } as never,
            })
          },
        }),
        // No oauthPool → no picked token.
      })

      await coordinator.send({
        type: "chat.send",
        chatId: "chat-1",
        provider: "claude",
        content: "test",
        model: "claude-opus-4-7",
      })

      await waitFor(
        () => accountInfoEntry(store.messages) !== null,
        4000,
        "account_info entry appended",
      )

      const info = accountInfoEntry(store.messages)!
      expect(info.tokenSource).toBe("CLAUDE_CODE_OAUTH_TOKEN")
      expect(info.organization).toBe("Real Org")
    },
    10_000,
  )
})
