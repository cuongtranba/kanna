
import type { AutoContinueEvent } from "../auto-continue/events"
import type { TranscriptEntry } from "../../shared/types"
import type { ClaudeSessionState } from "../claude-session-state"
import type { EnsureTrackingFileArgs, EnsureTrackingFileResult } from "../loop-template-io.adapter"
import type { LoopCommandDeps } from "../claude-loop-commands"


export interface FakeStore {
  events: AutoContinueEvent[]
  messages: { chatId: string; entry: TranscriptEntry }[]
  chats: Map<string, { id: string; projectId: string }>
  projects: Map<string, { id: string; localPath: string }>
  sessionTokensSet: { chatId: string; provider: string; token: string | null }[]
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
  getChat(chatId: string): { id: string; projectId: string } | null
  getProject(projectId: string): { id: string; localPath: string } | null
  setSessionTokenForProvider(chatId: string, provider: "claude", token: string | null): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  queuedByChat: Map<string, { id: string }[]>
  subagentRunsByChat: Map<string, Record<string, { status: string }>>
  listAutoContinueChats(): string[]
  getQueuedMessages(chatId: string): readonly { id: string }[]
  getSubagentRuns(chatId: string): Record<string, { status: string }>
}

export function makeStore(overrides: Partial<FakeStore> = {}): FakeStore {
  const store: FakeStore = {
    events: [],
    messages: [],
    chats: new Map([["chat-1", { id: "chat-1", projectId: "proj-1" }]]),
    projects: new Map([["proj-1", { id: "proj-1", localPath: "/repo" }]]),
    sessionTokensSet: [],
    getAutoContinueEvents() {
      return store.events
    },
    getChat(chatId) {
      return store.chats.get(chatId) ?? null
    },
    getProject(projectId) {
      return store.projects.get(projectId) ?? null
    },
    async setSessionTokenForProvider(chatId, provider, token) {
      store.sessionTokensSet.push({ chatId, provider, token })
    },
    async appendMessage(chatId, entry) {
      store.messages.push({ chatId, entry })
    },
    queuedByChat: new Map(),
    subagentRunsByChat: new Map(),
    listAutoContinueChats() {
      return [...store.chats.keys()]
    },
    getQueuedMessages(chatId) {
      return store.queuedByChat.get(chatId) ?? []
    },
    getSubagentRuns(chatId) {
      return store.subagentRunsByChat.get(chatId) ?? {}
    },
    ...overrides,
  }
  return store
}


export function makeDeps(overrides: Partial<LoopCommandDeps> = {}): LoopCommandDeps {
  const store = makeStore()
  const emittedEvents: AutoContinueEvent[] = []
  const closedSessions: string[] = []

  return {
    store,
    claudeSessions: new Map<string, ClaudeSessionState>(),
    activeTurns: new Map<string, unknown>(),
    startingTurns: new Map<string, unknown>(),
    getSubagents: () => [],
    getAppSettingsSnapshot: () => ({}),
    closeClaudeSession: (chatId) => {
      closedSessions.push(chatId)
    },
    emitAutoContinueEvent: async (event) => {
      emittedEvents.push(event)
      store.events.push(event)
    },
    ensureTrackingFile: async (_args: EnsureTrackingFileArgs): Promise<EnsureTrackingFileResult> => {
      return { created: true, reconciled: false, actions: [], absPath: _args.absPath }
    },
    ...overrides,
    pendingTools: overrides.pendingTools ?? { has: () => false },
    hasLiveWorkflow: overrides.hasLiveWorkflow ?? (() => false),
    hasPendingBackgroundTask: overrides.hasPendingBackgroundTask ?? (() => false),
    isLoopArmed: overrides.isLoopArmed ?? ((_chatId: string) => null),
    isChatBusy: overrides.isChatBusy ?? ((_chatId: string) => false),
    inspectTrackingFile:
      overrides.inspectTrackingFile
      ?? (async () => ({ exists: false, content: null, gitTracked: false })),
    isWorktreeOfSameRepo: overrides.isWorktreeOfSameRepo ?? (async () => true),
    runVerifyCommand:
      overrides.runVerifyCommand
      ?? (async () => ({ exitCode: 1, output: "not done", timedOut: false, durationMs: 1 })),
    readOracleScript: overrides.readOracleScript ?? (async () => null),
  }
}



export function armedLoop(prompt = "ORCHESTRATOR loop prompt") {
  return {
    subagentId: "sub-1",
    prompt,
    armedAt: 1,
    consecutiveFailures: 0,
    verifyCommand: "sh verify.sh",
    workdirAbs: "/repo",
    trackingFileRel: "PROGRESS.md",
  }
}
