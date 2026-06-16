import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { AgentCoordinator } from "./agent"
import type { HarnessEvent } from "./harness-types"
import type { SlashCommand, TranscriptEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import type { WorkflowRegistry } from "./workflow-registry"
import { computeWorkflowsDir } from "./claude-pty/jsonl-path.adapter"
import { AsyncEventQueue } from "./test-helpers/async-event-queue"
import { waitFor } from "./test-helpers/wait-for"

// Minimal fake store — pattern mirrors agent.oauth-rotation.test.ts.
function createFakeStore() {
  const chat = {
    id: "chat-sdk-wf-1",
    projectId: "project-sdk-wf-1",
    title: "New Chat",
    provider: null as "claude" | "codex" | null,
    planMode: false,
    sessionToken: null as string | null,
    sessionTokensByProvider: {} as Partial<Record<"claude" | "codex", string | null>>,
    slashCommands: undefined as SlashCommand[] | undefined,
    pendingForkSessionToken: null as { provider: "claude" | "codex"; token: string } | null,
  }
  const project = { id: "project-sdk-wf-1", localPath: LOCAL_PATH }
  return {
    chat,
    messages: [] as TranscriptEntry[],
    queuedMessages: [] as Array<Record<string, unknown>>,
    commandsLoaded: [] as Array<{ chatId: string; commands: SlashCommand[] }>,
    async recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]) {
      this.commandsLoaded.push({ chatId, commands })
      chat.slashCommands = commands
    },
    requireChat(chatId: string) {
      expect(chatId).toBe("chat-sdk-wf-1")
      return chat
    },
    getChat(chatId: string) {
      return chatId === "chat-sdk-wf-1" ? chat : null
    },
    getProject(projectId: string) {
      expect(projectId).toBe("project-sdk-wf-1")
      return project
    },
    getMessages() {
      return this.messages
    },
    async setChatProvider(_c: string, p: "claude" | "codex") {
      chat.provider = p
    },
    async setPlanMode(_c: string, v: boolean) {
      chat.planMode = v
    },
    async renameChat(_c: string, t: string) {
      chat.title = t
    },
    async appendMessage(_c: string, e: TranscriptEntry) {
      this.messages.push(e)
    },
    async recordTurnStarted() {},
    async recordTurnFinished() {},
    turnFailures: [] as Array<{ chatId: string; reason: string }>,
    async recordTurnFailed(chatId: string, reason: string) {
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
    async setSessionToken(_c: string, t: string | null) {
      chat.sessionToken = t
    },
    async setSessionTokenForProvider(_c: string, p: "claude" | "codex", t: string | null) {
      chat.sessionTokensByProvider = { ...chat.sessionTokensByProvider, [p]: t }
      chat.sessionToken = t
    },
    async setPendingForkSessionToken(_c: string, v: { provider: "claude" | "codex"; token: string } | null) {
      chat.pendingForkSessionToken = v
    },
    async createChat() {
      return chat
    },
    async forkChat() {
      const pending = chat.provider
        ? (chat.sessionTokensByProvider[chat.provider] ?? null)
        : null
      return {
        ...chat,
        id: "chat-fork-1",
        title: "Fork: New Chat",
        sessionTokensByProvider: {},
        pendingForkSessionToken:
          pending && chat.provider
            ? { provider: chat.provider, token: pending }
            : chat.pendingForkSessionToken,
      }
    },
    async enqueueMessage(_c: string, m: { content: string }) {
      const q = {
        id: crypto.randomUUID(),
        content: m.content,
        attachments: [],
        createdAt: Date.now(),
      }
      this.queuedMessages.push(q)
      return q
    },
    getQueuedMessages() {
      return [...this.queuedMessages]
    },
    getQueuedMessage() {
      return null
    },
    async removeQueuedMessage() {},
    *runningSubagentRuns() {},
  }
}

/** Minimal fake WorkflowRegistry that records register/unregister calls. */
function createFakeWorkflowRegistry(): WorkflowRegistry & {
  registerCalls: Array<{ chatId: string; dir: string }>
  unregisterCalls: string[]
} {
  const registerCalls: Array<{ chatId: string; dir: string }> = []
  const unregisterCalls: string[] = []
  return {
    registerCalls,
    unregisterCalls,
    register(chatId: string, dir: string) {
      registerCalls.push({ chatId, dir })
    },
    unregister(chatId: string) {
      unregisterCalls.push(chatId)
    },
    snapshot() {
      return []
    },
    getRun() {
      return null
    },
    hasActiveRun() {
      return false
    },
    subscribe() {
      return () => {}
    },
  }
}

const CHAT_ID = "chat-sdk-wf-1"
const SESSION_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
// Use /tmp which is guaranteed to exist; realpathSync resolves it.
// On macOS /tmp → /private/tmp, so we use the resolved real path as the
// project localPath so it matches what computeWorkflowsDir will produce.
const LOCAL_PATH = realpathSync("/tmp")

describe("AgentCoordinator — SDK workflow dir registration", () => {
  let prevDriver: string | undefined

  beforeEach(() => {
    prevDriver = process.env.KANNA_CLAUDE_DRIVER
    // Ensure we are explicitly in SDK mode (default, but make it explicit).
    delete process.env.KANNA_CLAUDE_DRIVER
  })

  afterEach(() => {
    if (prevDriver === undefined) delete process.env.KANNA_CLAUDE_DRIVER
    else process.env.KANNA_CLAUDE_DRIVER = prevDriver
  })

  test(
    "registers workflows dir when SDK session emits session_token",
    async () => {
      const store = createFakeStore()
      const workflowRegistry = createFakeWorkflowRegistry()

      // Build an event queue: emit session_token then close so the session loop ends.
      const events = new AsyncEventQueue<HarnessEvent>()

      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        workflowRegistry,
        startClaudeSession: async () => {
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
              // Emit session_token — the call under test. The stream stays open;
              // waitFor polls until register() is called.
              events.push({ type: "session_token", sessionToken: SESSION_UUID })
            },
          }
        },
        // Disable sweep timer in tests.
        claudeSessionLifecycle: { sweepIntervalMs: 0 },
      })

      await coordinator.send({
        type: "chat.send",
        chatId: CHAT_ID,
        provider: "claude",
        content: "hello",
        model: "claude-sonnet-4-5",
      })

      const expectedDir = computeWorkflowsDir({
        homeDir: homedir(),
        cwd: LOCAL_PATH,
        sessionId: SESSION_UUID,
      })

      await waitFor(
        () => workflowRegistry.registerCalls.length >= 1,
        4000,
        "workflow registry register() called",
      )

      expect(workflowRegistry.registerCalls).toHaveLength(1)
      expect(workflowRegistry.registerCalls[0]!.chatId).toBe(CHAT_ID)
      expect(workflowRegistry.registerCalls[0]!.dir).toBe(expectedDir)
    },
    10_000,
  )

  test(
    "does not call register a second time if session_token is emitted twice",
    async () => {
      const store = createFakeStore()
      const workflowRegistry = createFakeWorkflowRegistry()
      const events = new AsyncEventQueue<HarnessEvent>()

      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        workflowRegistry,
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
            // Emit session_token twice to verify the once-flag prevents double-register.
            events.push({ type: "session_token", sessionToken: SESSION_UUID })
            events.push({ type: "session_token", sessionToken: SESSION_UUID })
          },
        }),
        claudeSessionLifecycle: { sweepIntervalMs: 0 },
      })

      await coordinator.send({
        type: "chat.send",
        chatId: CHAT_ID,
        provider: "claude",
        content: "hello",
        model: "claude-sonnet-4-5",
      })

      await waitFor(
        () => workflowRegistry.registerCalls.length >= 1,
        4000,
        "workflow registry register() called at least once",
      )

      // Allow any stray second call to arrive.
      await new Promise((r) => setTimeout(r, 50))

      expect(workflowRegistry.registerCalls).toHaveLength(1)
    },
    10_000,
  )

  test(
    "does NOT register when KANNA_CLAUDE_DRIVER=pty",
    async () => {
      process.env.KANNA_CLAUDE_DRIVER = "pty"

      const store = createFakeStore()
      const workflowRegistry = createFakeWorkflowRegistry()
      const events = new AsyncEventQueue<HarnessEvent>()

      const coordinator = new AgentCoordinator({
        store: store as never,
        onStateChange: () => {},
        workflowRegistry,
        // Under PTY driver preference the coordinator calls startClaudeSessionPTYFn,
        // not startClaudeSession. We stub both: startClaudeSession must not be
        // called; startClaudeSessionPTY provides the session.
        startClaudeSession: async () => {
          throw new Error("SDK driver must not be used under KANNA_CLAUDE_DRIVER=pty")
        },
        startClaudeSessionPTY: async () => ({
          provider: "claude",
          stream: events,
          getAccountInfo: async () => null,
          interrupt: async () => {},
          close: () => {},
          setModel: async () => {},
          setPermissionMode: async () => {},
          getSupportedCommands: async () => [],
          sendPrompt: async () => {
            // Under PTY the session_token would arrive via the JSONL parser;
            // simulate it the same way to confirm the guard blocks registration.
            events.push({ type: "session_token", sessionToken: SESSION_UUID })
          },
        }),
        claudeSessionLifecycle: { sweepIntervalMs: 0 },
      })

      await coordinator.send({
        type: "chat.send",
        chatId: CHAT_ID,
        provider: "claude",
        content: "hello",
        model: "claude-sonnet-4-5",
      })

      // Give the async session loop time to process the session_token event.
      await new Promise((r) => setTimeout(r, 200))

      // The PTY guard must prevent SDK-side registration.
      expect(workflowRegistry.registerCalls).toHaveLength(0)
    },
    10_000,
  )
})
