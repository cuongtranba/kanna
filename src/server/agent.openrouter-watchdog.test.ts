import { describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import type { HarnessEvent } from "./harness-types"
import type { LlmProviderSnapshot, SlashCommand, TranscriptEntry } from "../shared/types"
import { AsyncEventQueue } from "./test-helpers/async-event-queue"
import { waitFor } from "./test-helpers/wait-for"

// Minimal store (trimmed copy from agent.openrouter-model.test.ts — do NOT
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
    turnFailedCount: 0,
    turnFailedReasons: [] as string[],
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
    async recordTurnFinished() {},
    async recordTurnFailed(_chatId: string, reason: string) {
      this.turnFailedCount += 1
      this.turnFailedReasons.push(reason)
    },
    async recordTurnCancelled() {},
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

describe("AgentCoordinator OpenRouter first-entry watchdog", () => {
  test(
    "fails closed when the OpenRouter stream emits session_token then no entry",
    async () => {
      const events = new AsyncEventQueue<HarnessEvent>()
      const store = createFakeStore()
      let closeCalled = 0
      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        readLlmProvider: async () => openrouterSnapshot(),
        openrouterFirstEntryTimeoutMs: 200,
        startClaudeSession: async () => {
          return {
            provider: "claude",
            stream: events,
            getAccountInfo: async () => null,
            interrupt: async () => {},
            close: () => {
              closeCalled += 1
              events.close()
            },
            setModel: async () => {},
            setPermissionMode: async () => {},
            getSupportedCommands: async () => [],
            // Never emit an entry — reproduces session a71516d4's silent stall
            // where the SDK connected (account_info) but no system_init/result
            // ever arrived.
            sendPrompt: async () => {},
          }
        },
      } as never)

      await coordinator.send({
        type: "chat.send",
        chatId: "chat-1",
        provider: "openrouter" as never,
        content: "tell me about this project",
        model: "qwen/qwen3.7-plus",
      })

      await waitFor(() => store.turnFailedCount > 0, 4000, "turn failed via watchdog")

      expect(store.turnFailedCount).toBeGreaterThan(0)
      expect(closeCalled).toBeGreaterThan(0)
      const errorResult = store.messages.find(
        (m) => m.kind === "result" && (m as { isError?: boolean }).isError === true,
      )
      expect(errorResult).toBeDefined()
      expect((errorResult as { result?: string }).result).toContain("OpenRouter produced no response")
    },
    10_000,
  )

  test(
    "does not fail the turn when the OpenRouter stream emits an entry in time",
    async () => {
      const events = new AsyncEventQueue<HarnessEvent>()
      const store = createFakeStore()
      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        readLlmProvider: async () => openrouterSnapshot(),
        openrouterFirstEntryTimeoutMs: 200,
        startClaudeSession: async () => {
          // Emit a result entry promptly — the watchdog must be cleared and
          // never fire.
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
          return {
            provider: "claude",
            stream: events,
            getAccountInfo: async () => null,
            interrupt: async () => {},
            close: () => events.close(),
            setModel: async () => {},
            setPermissionMode: async () => {},
            getSupportedCommands: async () => [],
            sendPrompt: async () => {},
          }
        },
      } as never)

      await coordinator.send({
        type: "chat.send",
        chatId: "chat-1",
        provider: "openrouter" as never,
        content: "hi",
        model: "moonshotai/kimi-k2.5:nitro",
      })

      // Wait past the watchdog window; the timely entry must keep it disarmed.
      await new Promise((resolve) => setTimeout(resolve, 500))

      expect(store.turnFailedCount).toBe(0)
      const errorResult = store.messages.find(
        (m) => m.kind === "result" && (m as { isError?: boolean }).isError === true,
      )
      expect(errorResult).toBeUndefined()
    },
    10_000,
  )
})

describe("AgentCoordinator OpenRouter SDK-session prompt delivery", () => {
  test(
    "delivers the user prompt to the SDK session for openrouter (regression: prompt-delivery gate)",
    async () => {
      // Regression for the gate that delivered prompts only when
      // `provider === "claude"`. OpenRouter rides the same SDK session but was
      // excluded, so its prompt never reached `sendPrompt` and every turn hung
      // until the watchdog. `providerUsesSdkSession` now covers both.
      const events = new AsyncEventQueue<HarnessEvent>()
      const store = createFakeStore()
      const sentPrompts: string[] = []
      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        readLlmProvider: async () => openrouterSnapshot(),
        openrouterFirstEntryTimeoutMs: 5000,
        startClaudeSession: async () => {
          return {
            provider: "claude",
            stream: events,
            getAccountInfo: async () => null,
            interrupt: async () => {},
            close: () => events.close(),
            setModel: async () => {},
            setPermissionMode: async () => {},
            getSupportedCommands: async () => [],
            sendPrompt: async (content: string) => {
              sentPrompts.push(content)
              // A real upstream would now stream a turn; emit a success result
              // so the turn completes cleanly and the watchdog never fires.
              events.push({
                type: "transcript",
                entry: {
                  _id: "result-1",
                  createdAt: Date.now(),
                  kind: "result",
                  subtype: "success",
                  isError: false,
                  durationMs: 0,
                  result: "ok",
                } as never,
              })
            },
          }
        },
      } as never)

      await coordinator.send({
        type: "chat.send",
        chatId: "chat-1",
        provider: "openrouter" as never,
        content: "hello openrouter",
        model: "moonshotai/kimi-k2.5:nitro",
      })

      await waitFor(
        () => sentPrompts.some((p) => p.includes("hello openrouter")),
        4000,
        "openrouter prompt delivered to the SDK session",
      )

      expect(sentPrompts.some((p) => p.includes("hello openrouter"))).toBe(true)
      expect(store.turnFailedCount).toBe(0)
    },
    10_000,
  )
})
