/**
 * Tests for the extracted loop-orchestration command handlers.
 *
 * Each test builds a minimal `LoopOrchCommandDeps` fake and asserts the
 * correct behaviour of the function under test. No real IO or OS calls.
 */

import { describe, test, expect } from "bun:test"
import type { AutoContinueEvent } from "./auto-continue/events"
import { AUTO_CONTINUE_EVENT_VERSION } from "./auto-continue/events"
import type { TranscriptEntry } from "../shared/types"
import type { OrchRunConfig, OrchTaskSpec, OrchRunSnapshot, OrchPhaseSpec } from "../shared/orchestration-types"
import type { ClaudeSessionState } from "./claude-session-state"
import type { EnsureTrackingFileArgs, EnsureTrackingFileResult } from "./loop-template-io.adapter"
import type { ProviderRunStart, BackgroundRunOutcome } from "./subagent-orchestrator"
import type { WorkerSpawnArgs } from "./orchestration-queue"
import type { Subagent } from "../shared/types"
import {
  isLoopArmed,
  listLiveSchedules,
  getOrchRunDetail,
  cancelOrchRun,
  buildOrchRunContext,
  runOrchestration,
  clearClaudeSessionContext,
  deliverSubagentToMain,
  stopLoop,
  buildOrchWorker,
  type LoopOrchCommandDeps,
} from "./claude-loop-orch-commands"

// ---------------------------------------------------------------------------
// Fake store builder
// ---------------------------------------------------------------------------

interface FakeStore {
  events: AutoContinueEvent[]
  messages: { chatId: string; entry: TranscriptEntry }[]
  chats: Map<string, { id: string; projectId: string }>
  projects: Map<string, { id: string; localPath: string }>
  orchRuns: Map<string, OrchRunSnapshot>
  sessionTokensSet: { chatId: string; provider: string; token: string | null }[]
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
  getChat(chatId: string): { id: string; projectId: string } | null
  getProject(projectId: string): { id: string; localPath: string } | null
  getOrchRun(runId: string): OrchRunSnapshot | null
  setSessionTokenForProvider(chatId: string, provider: "claude", token: string | null): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
}

function makeStore(overrides: Partial<FakeStore> = {}): FakeStore {
  const store: FakeStore = {
    events: [],
    messages: [],
    chats: new Map([["chat-1", { id: "chat-1", projectId: "proj-1" }]]),
    projects: new Map([["proj-1", { id: "proj-1", localPath: "/repo" }]]),
    orchRuns: new Map(),
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
    getOrchRun(runId) {
      return store.orchRuns.get(runId) ?? null
    },
    async setSessionTokenForProvider(chatId, provider, token) {
      store.sessionTokensSet.push({ chatId, provider, token })
    },
    async appendMessage(chatId, entry) {
      store.messages.push({ chatId, entry })
    },
    ...overrides,
  }
  return store
}

// ---------------------------------------------------------------------------
// Fake orchestration queue
// ---------------------------------------------------------------------------

interface FakeOrchQueue {
  created: { config: OrchRunConfig; tasks: OrchTaskSpec[] }[]
  cancelled: string[]
  runIdToReturn: string
  createRun(config: OrchRunConfig, tasks: OrchTaskSpec[]): Promise<string>
  cancelRun(runId: string): Promise<void>
}

function makeOrchQueue(overrides: Partial<FakeOrchQueue> = {}): FakeOrchQueue {
  const q: FakeOrchQueue = {
    created: [],
    cancelled: [],
    runIdToReturn: "run-1",
    async createRun(config, tasks) {
      q.created.push({ config, tasks })
      return q.runIdToReturn
    },
    async cancelRun(runId) {
      q.cancelled.push(runId)
    },
    ...overrides,
  }
  return q
}

// ---------------------------------------------------------------------------
// Fake dep builder
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<LoopOrchCommandDeps> = {}): LoopOrchCommandDeps {
  const store = makeStore()
  const orchQueue = makeOrchQueue()
  const emittedEvents: AutoContinueEvent[] = []
  const closedSessions: string[] = []

  return {
    store,
    orchestrationQueue: orchQueue,
    claudeSessions: new Map<string, ClaudeSessionState>(),
    activeTurns: new Map<string, unknown>(),
    getSubagents: () => [],
    getAppSettingsSnapshot: () => ({}),
    buildSubagentProviderRunForChat: () => {
      throw new Error("not implemented")
    },
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
    // isLoopArmed MUST follow the spread: Partial<...> widens it to T|undefined,
    // placing it after with ?? fallback ensures TS7 always sees a concrete function.
    isLoopArmed: overrides.isLoopArmed ?? ((_chatId: string) => null),
  }
}

// ---------------------------------------------------------------------------
// isLoopArmed
// ---------------------------------------------------------------------------

describe("isLoopArmed", () => {
  test("returns null when no events", () => {
    const deps = makeDeps()
    expect(isLoopArmed(deps, "chat-1")).toBeNull()
  })

  test("returns LoopState when loop_armed event is present", () => {
    const deps = makeDeps()
    const armEvent: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_armed",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      subagentId: "agent-1",
      prompt: "Read PROGRESS.md",
    }
    deps.store.getAutoContinueEvents = () => [armEvent]
    const result = isLoopArmed(deps, "chat-1")
    expect(result).not.toBeNull()
    expect(result?.prompt).toBe("Read PROGRESS.md")
  })

  test("returns null after loop_disarmed event", () => {
    const deps = makeDeps()
    const now = Date.now()
    const events: AutoContinueEvent[] = [
      {
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "loop_armed",
        timestamp: now,
        chatId: "chat-1",
        scheduleId: "sched-1",
        subagentId: "agent-1",
        prompt: "Read PROGRESS.md",
      },
      {
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "loop_disarmed",
        timestamp: now + 1,
        chatId: "chat-1",
        scheduleId: "sched-2",
        reason: "goal_met",
      },
    ]
    deps.store.getAutoContinueEvents = () => events
    expect(isLoopArmed(deps, "chat-1")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// listLiveSchedules
// ---------------------------------------------------------------------------

describe("listLiveSchedules", () => {
  test("returns empty array when no events", () => {
    const deps = makeDeps()
    expect(listLiveSchedules(deps, "chat-1")).toEqual([])
  })

  test("returns scheduleIds for proposed/scheduled events", () => {
    const deps = makeDeps()
    const now = Date.now() + 10_000
    const events: AutoContinueEvent[] = [
      {
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "auto_continue_accepted",
        timestamp: Date.now(),
        chatId: "chat-1",
        scheduleId: "sched-a",
        scheduledAt: now,
        tz: "system",
        source: "auto_setting",
        resetAt: now,
        detectedAt: Date.now(),
      },
    ]
    deps.store.getAutoContinueEvents = () => events
    const schedules = listLiveSchedules(deps, "chat-1")
    expect(schedules).toContain("sched-a")
  })
})

// ---------------------------------------------------------------------------
// getOrchRunDetail
// ---------------------------------------------------------------------------

describe("getOrchRunDetail", () => {
  test("returns null when run not found", () => {
    const deps = makeDeps()
    expect(getOrchRunDetail(deps, "missing-run")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// cancelOrchRun
// ---------------------------------------------------------------------------

describe("cancelOrchRun", () => {
  test("delegates to orchestrationQueue.cancelRun", async () => {
    const queue = makeOrchQueue()
    const deps = makeDeps({ orchestrationQueue: queue })
    await cancelOrchRun(deps, "run-42")
    expect(queue.cancelled).toContain("run-42")
  })
})

// ---------------------------------------------------------------------------
// buildOrchRunContext
// ---------------------------------------------------------------------------

describe("buildOrchRunContext", () => {
  test("returns null for unknown chat", () => {
    const deps = makeDeps()
    expect(buildOrchRunContext(deps, "unknown-chat")).toBeNull()
  })

  test("returns null when project not found", () => {
    const store = makeStore()
    store.chats.set("chat-1", { id: "chat-1", projectId: "missing-proj" })
    const deps = makeDeps({ store })
    expect(buildOrchRunContext(deps, "chat-1")).toBeNull()
  })

  test("returns context for known chat+project", () => {
    const subagent: Subagent = {
      id: "agent-1",
      name: "Agent 1",
      provider: "claude",
      model: "claude-opus-4-5",
      modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
      systemPrompt: "You are helpful",
      contextScope: "full-transcript",
      triggerMode: "manual",
      createdAt: 0,
      updatedAt: 0,
    }
    const deps = makeDeps({ getSubagents: () => [subagent] })
    const ctx = buildOrchRunContext(deps, "chat-1")
    expect(ctx).not.toBeNull()
    expect(ctx?.chatId).toBe("chat-1")
    expect(ctx?.repoRoot).toBe("/repo")
    expect(ctx?.roster).toEqual([{ id: "agent-1", name: "Agent 1" }])
  })
})

// ---------------------------------------------------------------------------
// runOrchestration
// ---------------------------------------------------------------------------

describe("runOrchestration", () => {
  test("returns error when chat not found", async () => {
    const deps = makeDeps()
    const result = await runOrchestration(deps, "unknown-chat", { tasks: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("unknown-chat"))).toBe(true)
    }
  })

  test("returns error when validation fails (empty tasks)", async () => {
    // No subagents → roster is empty → validation will fail on subagentId
    const deps = makeDeps()
    // Empty tasks → should fail validation
    const result = await runOrchestration(deps, "chat-1", { tasks: [] })
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// clearClaudeSessionContext
// ---------------------------------------------------------------------------

describe("clearClaudeSessionContext", () => {
  test("sets session token to null", async () => {
    const store = makeStore()
    const deps = makeDeps({ store })
    await clearClaudeSessionContext(deps, "chat-1")
    expect(store.sessionTokensSet.some((e) => e.chatId === "chat-1" && e.token === null)).toBe(true)
  })

  test("sets suppressSessionTokenPersist on live session when no active turn", async () => {
    const store = makeStore()
    const fakeSession = {
      chatId: "chat-1",
      suppressSessionTokenPersist: false,
    } as unknown as ClaudeSessionState
    const claudeSessions = new Map<string, ClaudeSessionState>([["chat-1", fakeSession]])
    const activeTurns = new Map<string, unknown>() // no active turn

    let closed = false
    const deps = makeDeps({
      store,
      claudeSessions,
      activeTurns,
      closeClaudeSession: () => {
        closed = true
      },
    })
    await clearClaudeSessionContext(deps, "chat-1")
    expect(fakeSession.suppressSessionTokenPersist).toBe(true)
    expect(closed).toBe(true)
  })

  test("does not close session when active turn exists", async () => {
    const store = makeStore()
    const fakeSession = {
      chatId: "chat-1",
      suppressSessionTokenPersist: false,
    } as unknown as ClaudeSessionState
    const claudeSessions = new Map<string, ClaudeSessionState>([["chat-1", fakeSession]])
    const activeTurns = new Map<string, unknown>([["chat-1", {}]])

    let closed = false
    const deps = makeDeps({
      store,
      claudeSessions,
      activeTurns,
      closeClaudeSession: () => {
        closed = true
      },
    })
    await clearClaudeSessionContext(deps, "chat-1")
    expect(fakeSession.suppressSessionTokenPersist).toBe(true)
    expect(closed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// stopLoop
// ---------------------------------------------------------------------------

describe("stopLoop", () => {
  test("is a no-op when loop is not armed", async () => {
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      emitAutoContinueEvent: async (event) => {
        emitted.push(event)
      },
    })
    await stopLoop(deps, "chat-1", "goal_met")
    expect(emitted).toHaveLength(0)
  })

  test("emits loop_disarmed when loop is armed", async () => {
    const emitted: AutoContinueEvent[] = []
    const armEvent: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_armed",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      subagentId: "agent-1",
      prompt: "Read PROGRESS.md",
    }
    const deps = makeDeps({
      emitAutoContinueEvent: async (event) => {
        emitted.push(event)
      },
    })
    deps.store.getAutoContinueEvents = () => [armEvent]
    await stopLoop(deps, "chat-1", "goal_met")
    expect(emitted.some((e) => e.kind === "loop_disarmed")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// deliverSubagentToMain
// ---------------------------------------------------------------------------

describe("deliverSubagentToMain", () => {
  test("no-ops when chat not found", async () => {
    const store = makeStore()
    store.chats.clear()
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (event) => { emitted.push(event) },
    })
    const outcome: BackgroundRunOutcome = { status: "completed", runId: "run-1", text: "done" }
    await deliverSubagentToMain(deps, "unknown-chat", "run-1", outcome)
    expect(emitted).toHaveLength(0)
  })

  test("emits auto_continue_accepted on completed outcome", async () => {
    const emitted: AutoContinueEvent[] = []
    const store = makeStore()
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (event) => {
        emitted.push(event)
        store.events.push(event)
      },
    })
    const outcome: BackgroundRunOutcome = { status: "completed", runId: "run-1", text: "done" }
    await deliverSubagentToMain(deps, "chat-1", "run-1", outcome)
    expect(emitted.some((e) => e.kind === "auto_continue_accepted")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buildOrchWorker
// ---------------------------------------------------------------------------

describe("buildOrchWorker", () => {
  const fakePhase: OrchPhaseSpec = {
    name: "implement",
    kind: "implement",
    parallel: 1,
    promptTemplate: "{{TASK}}",
  }

  function makeSpawnArgs(): WorkerSpawnArgs {
    return {
      runId: "run-1",
      workerId: "wt-0",
      taskId: "task-1",
      phase: fakePhase,
      phaseIndex: 0,
      prompt: "Do the work",
      cwd: "/worktree",
      abortSignal: new AbortController().signal,
    }
  }

  test("returns failed when run not found", async () => {
    const deps = makeDeps()
    const result = await buildOrchWorker(deps, makeSpawnArgs())
    expect(result.kind).toBe("failed")
    if (result.kind === "failed") {
      expect(result.error).toContain("originChatId")
    }
  })

  test("returns failed when subagent not found", async () => {
    const store = makeStore()
    const orchRun: OrchRunSnapshot = {
      runId: "run-1",
      config: {
        title: "Test run",
        repoRoot: "/repo",
        baseBranch: "main",
        maxParallelTasks: 1,
        worktreePoolSize: 1,
        maxAttempts: 3,
        phases: [],
        gates: [],
        contextPrompt: null,
        verify: null,
        init: null,
        workerSubagentId: "missing-agent",
        originChatId: "chat-1",
      },
      tasks: [],
      worktrees: [],
      status: "running",
      createdAt: 0,
      updatedAt: 0,
    }
    store.orchRuns.set("run-1", orchRun)
    const deps = makeDeps({ store, getSubagents: () => [] })
    const result = await buildOrchWorker(deps, makeSpawnArgs())
    expect(result.kind).toBe("failed")
    if (result.kind === "failed") {
      expect(result.error).toContain("missing-agent")
    }
  })

  test("returns completed on successful provider run", async () => {
    const store = makeStore()
    const subagent: Subagent = {
      id: "agent-1",
      name: "Agent 1",
      provider: "claude",
      model: "claude-opus-4-5",
      modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
      systemPrompt: "You are helpful",
      contextScope: "full-transcript",
      triggerMode: "manual",
      createdAt: 0,
      updatedAt: 0,
    }
    const orchRun: OrchRunSnapshot = {
      runId: "run-1",
      config: {
        title: "Test run",
        repoRoot: "/repo",
        baseBranch: "main",
        maxParallelTasks: 1,
        worktreePoolSize: 1,
        maxAttempts: 3,
        phases: [],
        gates: [],
        contextPrompt: null,
        verify: null,
        init: null,
        workerSubagentId: "agent-1",
        originChatId: "chat-1",
      },
      tasks: [],
      worktrees: [],
      status: "running",
      createdAt: 0,
      updatedAt: 0,
    }
    store.orchRuns.set("run-1", orchRun)

    const fakeProviderRun: ProviderRunStart = {
      provider: "claude",
      model: "claude-opus-4-5",
      systemPrompt: "",
      preamble: null,
      authReady: async () => true,
      start: async () => ({ text: "Worker output" }),
    }

    const deps = makeDeps({
      store,
      getSubagents: () => [subagent],
      buildSubagentProviderRunForChat: () => fakeProviderRun,
    })
    const result = await buildOrchWorker(deps, makeSpawnArgs())
    expect(result.kind).toBe("completed")
    if (result.kind === "completed") {
      expect(result.text).toBe("Worker output")
    }
  })
})
