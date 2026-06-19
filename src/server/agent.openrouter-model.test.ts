import { describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import type { HarnessEvent } from "./harness-types"
import type { LlmProviderSnapshot, SlashCommand, TranscriptEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import { AsyncEventQueue } from "./test-helpers/async-event-queue"
import { waitFor } from "./test-helpers/wait-for"

// Minimal store (trimmed copy from agent.oauth-account-info.test.ts — do NOT
// modify agent.test.ts).
function createFakeStore() {
  const chat = {
    id: "chat-1",
    projectId: "project-1",
    title: "New Chat",
    provider: null as string | null,
    planMode: false,
    sessionToken: null as string | null,
    sessionTokensByProvider: {} as Record<string, string | null>,
    slashCommands: undefined as SlashCommand[] | undefined,
    pendingForkSessionToken: null as { provider: string; token: string } | null,
  }
  const project = { id: "project-1", localPath: "/tmp/project" }
  return {
    chat,
    turnFinishedCount: 0,
    messages: [] as TranscriptEntry[],
    queuedMessages: [] as Array<{ id: string; content: string }>,
    async recordSessionCommandsLoaded(_chatId: string, commands: SlashCommand[]) {
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
    async setChatProvider(_chatId: string, provider: string) {
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
    async setSessionTokenForProvider(_chatId: string, provider: string, sessionToken: string | null) {
      chat.sessionTokensByProvider = { ...chat.sessionTokensByProvider, [provider]: sessionToken }
      chat.sessionToken = sessionToken
    },
    async setPendingForkSessionToken(_chatId: string, value: { provider: string; token: string } | null) {
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

function openrouterSnapshot(): LlmProviderSnapshot {
  return {
    provider: "openrouter",
    apiKey: "sk-or-v1-abcdef1234567890",
    model: "moonshotai/kimi-k2.5:nitro",
    baseUrl: "",
    resolvedBaseUrl: "https://openrouter.ai/api",
    enabled: true,
    warning: null,
    filePathDisplay: "~/.kanna/llm-provider.json",
  }
}

function pushResult(events: AsyncEventQueue<HarnessEvent>) {
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
}

describe("AgentCoordinator OpenRouter model resolution", () => {
  test(
    "spawns the client-selected OpenRouter model, not the catalog default",
    async () => {
      let spawnedModel = ""
      const events = new AsyncEventQueue<HarnessEvent>()
      const store = createFakeStore()
      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        readLlmProvider: async () => openrouterSnapshot(),
        startClaudeSession: async (args: { model: string }) => {
          spawnedModel = args.model
          return {
            provider: "claude",
            stream: events,
            getAccountInfo: async () => null,
            interrupt: async () => {},
            close: () => {},
            setModel: async () => {},
            setPermissionMode: async () => {},
            getSupportedCommands: async () => [],
            sendPrompt: async () => pushResult(events),
          }
        },
      })

      await coordinator.send({
        type: "chat.send",
        chatId: "chat-1",
        provider: "openrouter" as never,
        content: "test",
        model: "qwen/qwen3.7-plus",
      })

      await waitFor(() => spawnedModel !== "", 4000, "session spawned")

      expect(spawnedModel).toBe("qwen/qwen3.7-plus")
      expect(spawnedModel).not.toBe("moonshotai/kimi-k2.5:nitro")
    },
    10_000,
  )

  test(
    "falls back to the OpenRouter default when no model is selected",
    async () => {
      let spawnedModel = ""
      const events = new AsyncEventQueue<HarnessEvent>()
      const store = createFakeStore()
      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        readLlmProvider: async () => openrouterSnapshot(),
        startClaudeSession: async (args: { model: string }) => {
          spawnedModel = args.model
          return {
            provider: "claude",
            stream: events,
            getAccountInfo: async () => null,
            interrupt: async () => {},
            close: () => {},
            setModel: async () => {},
            setPermissionMode: async () => {},
            getSupportedCommands: async () => [],
            sendPrompt: async () => pushResult(events),
          }
        },
      })

      await coordinator.send({
        type: "chat.send",
        chatId: "chat-1",
        provider: "openrouter" as never,
        content: "test",
        model: "   ",
      })

      await waitFor(() => spawnedModel !== "", 4000, "session spawned")

      expect(spawnedModel).toBe("moonshotai/kimi-k2.5:nitro")
    },
    10_000,
  )
})
