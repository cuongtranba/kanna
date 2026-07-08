import { describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import type { HarnessEvent } from "./harness-types"
import type { SlashCommand, TranscriptEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import { AsyncEventQueue } from "./test-helpers/async-event-queue"
import { waitFor } from "./test-helpers/wait-for"

// Minimal store (inline copy from agent.openrouter-model.test.ts)
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
    queuedMessages: [] as Array<{ id: string; content: string; advisorModel?: string }>,
    async recordSessionCommandsLoaded(_chatId: string, commands: SlashCommand[]) {
      chat.slashCommands = commands
    },
    requireChat() {
      return chat
    },
    getChat(chatId: string) {
      if (chatId !== "chat-1" && chatId !== "chat-2" && chatId !== "chat-3" && chatId !== "chat-4" && chatId !== "chat-5") return null
      return { ...chat, id: chatId }
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
    async enqueueMessage(_chatId: string, msg: { content: string; advisorModel?: string }) {
      const entry = { id: crypto.randomUUID(), content: msg.content, advisorModel: msg.advisorModel }
      this.queuedMessages.push(entry)
      return entry
    },
    async removeQueuedMessage(_chatId: string, id: string) {
      this.queuedMessages = this.queuedMessages.filter((m) => m.id !== id)
    },
    getQueuedMessages(_chatId?: string) {
      return [...this.queuedMessages]
    },
    *runningSubagentRuns() {},
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

type SpawnCapture = { advisorModel: string | undefined; seen: boolean }

function makeCoordinator(capture: SpawnCapture) {
  const events = new AsyncEventQueue<HarnessEvent>()
  const store = createFakeStore()
  const coordinator = new AgentCoordinator({
    store: store as never,
    onStateChange: () => {},
    startClaudeSession: async (args: { advisorModel?: string }) => {
      capture.advisorModel = args.advisorModel
      capture.seen = true
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
  return { coordinator, events, store }
}

describe("AgentCoordinator advisor tool", () => {
  test("threads advisorModel to the SDK spawn for claude", async () => {
    const capture: SpawnCapture = { advisorModel: undefined, seen: false }
    const { coordinator } = makeCoordinator(capture)
    await coordinator.send({
      type: "chat.send",
      chatId: "chat-1",
      provider: "claude" as never,
      content: "test",
      model: "claude-sonnet-4-6",
      advisorModel: "claude-opus-4-8",
    })
    await waitFor(() => capture.seen, 4000, "session spawned")
    expect(capture.advisorModel).toBe("claude-opus-4-8")
  }, 10_000)

  test("omits advisorModel when none selected", async () => {
    const capture: SpawnCapture = { advisorModel: "SENTINEL", seen: false }
    const { coordinator } = makeCoordinator(capture)
    await coordinator.send({
      type: "chat.send",
      chatId: "chat-2",
      provider: "claude" as never,
      content: "test",
      model: "claude-sonnet-4-6",
    })
    await waitFor(() => capture.seen, 4000, "session spawned")
    expect(capture.advisorModel).toBeUndefined()
  }, 10_000)

  test("persists advisorModel on the queued message", async () => {
    const capture: SpawnCapture = { advisorModel: undefined, seen: false }
    const { coordinator, store } = makeCoordinator(capture)
    // First send starts a turn; second send (same chat, turn active) queues.
    await coordinator.send({
      type: "chat.send",
      chatId: "chat-3",
      provider: "claude" as never,
      content: "first",
      model: "claude-sonnet-4-6",
      advisorModel: "claude-opus-4-8",
    })
    // Wait for the first turn to be underway (session spawned)
    await waitFor(() => capture.seen, 4000, "session spawned")
    // Now send a second message — chat-3 is active so it queues
    await coordinator.send({
      type: "message.enqueue",
      chatId: "chat-3",
      content: "queued",
      model: "claude-sonnet-4-6",
      advisorModel: "claude-opus-4-7",
    } as never)
    // Assert the stored queued message kept advisorModel.
    const stored = store.getQueuedMessages("chat-3")
    expect(stored.some((m) => m.advisorModel === "claude-opus-4-7")).toBe(true)
  }, 10_000)

  test("respawns session when advisorModel changes between turns", async () => {
    const calls: Array<{ advisorModel: string | undefined }> = []
    const events = new AsyncEventQueue<HarnessEvent>()
    const store = createFakeStore()
    const coordinator = new AgentCoordinator({
      store: store as never,
      onStateChange: () => {},
      startClaudeSession: async (args: { advisorModel?: string }) => {
        calls.push({ advisorModel: args.advisorModel })
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

    // Turn 1: with advisor A
    await coordinator.send({
      type: "chat.send",
      chatId: "chat-4",
      provider: "claude" as never,
      content: "turn 1",
      model: "claude-sonnet-4-6",
      advisorModel: "claude-opus-4-8",
    })
    await waitFor(() => calls.length >= 1, 4000, "first session spawned")

    // Let turn 1 complete
    pushResult(events)
    await waitFor(() => store.turnFinishedCount >= 1, 4000, "turn 1 finished")

    // Turn 2: with different advisor — should respawn
    await coordinator.send({
      type: "chat.send",
      chatId: "chat-4",
      provider: "claude" as never,
      content: "turn 2",
      model: "claude-sonnet-4-6",
      advisorModel: "claude-opus-4-7",
    })
    await waitFor(() => calls.length >= 2, 4000, "second session spawned")

    expect(calls[0]?.advisorModel).toBe("claude-opus-4-8")
    expect(calls[1]?.advisorModel).toBe("claude-opus-4-7")
  }, 10_000)
})
