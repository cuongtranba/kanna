import { describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import type { AutoContinueEvent } from "./auto-continue/events"
import type { TranscriptEntry, SlashCommand } from "../shared/types"

function createLoopStore() {
  const chat = {
    id: "chat-loop",
    projectId: "project-1",
    title: "loop",
    provider: null as "claude" | "codex" | null,
    planMode: false,
    sessionToken: null as string | null,
    sessionTokensByProvider: {} as Partial<Record<"claude" | "codex", string | null>>,
    slashCommands: undefined as SlashCommand[] | undefined,
    pendingForkSessionToken: null as { provider: "claude" | "codex"; token: string } | null,
    compactFailureCount: 0,
  }
  return {
    chat,
    messages: [] as TranscriptEntry[],
    autoContinueEvents: [] as AutoContinueEvent[],
    getChat: (chatId: string) => (chatId === "chat-loop" ? chat : null),
    requireChat: (chatId: string) => {
      if (chatId !== "chat-loop") throw new Error("Chat not found")
      return chat
    },
    getProject: () => ({ id: "project-1", localPath: "/tmp/loop" }),
    getMessages () { return this.messages },
    getLastUserMessageId(_chatId: string) {
      const last = [...this.messages].reverse().find((e) => e.kind === "user_prompt")
      return last?._id ?? null
    },
    getRecentRawEntries(_chatId: string, limit: number) {
      return this.messages.slice(-limit)
    },
    getLatestClaudeCumulativeCostUsd(_chatId: string): number | undefined {
      return undefined
    },
    async appendMessage(_chatId: string, entry: TranscriptEntry) {
      this.messages.push(entry)
    },
    async setSessionTokenForProvider(
      _chatId: string,
      provider: "claude" | "codex",
      sessionToken: string | null,
    ) {
      chat.sessionTokensByProvider = { ...chat.sessionTokensByProvider, [provider]: sessionToken }
      chat.sessionToken = sessionToken
    },
    async setSessionToken(_chatId: string, sessionToken: string | null) {
      chat.sessionToken = sessionToken
    },
    async setChatProvider(_chatId: string, provider: "claude" | "codex") {
      chat.provider = provider
    },
    async setPlanMode() {},
    async setCompactFailureCount(_chatId: string, count: number) {
      chat.compactFailureCount = count
    },
    async renameChat() {},
    async recordTurnStarted() {},
    async recordTurnFinished() {},
    async recordTurnFailed() {},
    async recordTurnCancelled() {},
    async appendAutoContinueEvent(event: AutoContinueEvent) {
      this.autoContinueEvents.push(event)
    },
    getAutoContinueEvents (chatId: string) {
      return this.autoContinueEvents.filter((e) => e.chatId === chatId)
    },
    listAutoContinueChats () {
      return [...new Set(this.autoContinueEvents.map((e) => e.chatId))]
    },
    async enqueueMessage() {},
    getQueuedMessages: () => [],
    getQueuedMessage: () => null,
    async removeQueuedMessage() {},
    async appendSubagentEvent() {},
    getSubagentEvents: () => [],
    listSubagentRunsForChat: () => [],
    getSubagentRun: () => null,
    async setPendingForkSessionToken() {},
    async createChat() { return chat },
    async forkChat() { return chat },
    async recordSessionCommandsLoaded() {},
    *runningSubagentRuns() {
    },
  }
}

describe("notification-driven delivery without an armed loop", () => {
  test("50 consecutive subagent_background deliveries never clear main; every wake carries its result", async () => {
    const store = createLoopStore()
    const coordinator = new AgentCoordinator({
      store: store as never,
      onStateChange: () => {},
      startClaudeSession: async () => { throw new Error("not needed in this scenario") },
    })

    type DeliverFn = (
      chatId: string,
      runId: string,
      outcome:
        | { status: "completed"; runId: string; text: string }
        | { status: "failed"; runId: string; errorCode: string; errorMessage: string },
    ) => Promise<void>
    const deliver = (coordinator as unknown as { deliverSubagentToMain: DeliverFn }).deliverSubagentToMain
      .bind(coordinator)

    await store.setSessionTokenForProvider("chat-loop", "claude", "conversation-session")

    const N = 50
    for (let i = 1; i <= N; i += 1) {
      await deliver("chat-loop", `run-${i}`, {
        status: "completed",
        runId: `run-${i}`,
        text: `iteration ${i} of the loop is done`,
      })

      expect(store.chat.sessionTokensByProvider.claude).toBe("conversation-session")
    }

    expect(store.messages.filter((m) => m.kind === "context_cleared")).toHaveLength(0)

    const events = store.getAutoContinueEvents("chat-loop")
    expect(events).toHaveLength(N)
    for (let i = 0; i < N; i += 1) {
      const ev = events[i]
      expect(ev.kind).toBe("auto_continue_accepted")
      if (ev.kind === "auto_continue_accepted") {
        expect(ev.source).toBe("subagent_background")
        expect(ev.prompt).toContain("<task-notification>")
        expect(ev.prompt).toContain(`<task-id>run-${i + 1}</task-id>`)
        expect(ev.prompt).toContain("<status>completed</status>")
        expect(ev.prompt).toContain(`<result>iteration ${i + 1} of the loop is done</result>`)
        expect(ev.prompt).not.toContain("context has been cleared")
      }
    }
  })
})
