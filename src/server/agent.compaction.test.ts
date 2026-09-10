import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import { COMPACTION_STARTED } from "./observability"
import { startMetricRecorder, type MetricRecorder } from "./test-helpers/metric-recorder"
import type { CompactionEvent } from "./claude-session-start"
import type { ClaudeSessionHandle } from "./harness-types"
import type { TranscriptEntry } from "../shared/types"

function fakeHandle(): ClaudeSessionHandle {
  return {
    provider: "claude",
    stream: (async function* () {})(),
    interrupt: async () => {},
    close: () => {},
    closed: Promise.resolve(),
    sendPrompt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
    getSupportedCommands: async () => [],
  }
}

interface CapturedCompaction {
  appended: { chatId: string; entry: TranscriptEntry }[]
  observe: (event: CompactionEvent) => void
}

async function captureCompactionObserver(): Promise<CapturedCompaction> {
  const appended: { chatId: string; entry: TranscriptEntry }[] = []
  let observe: ((event: CompactionEvent) => void) | undefined

  const store = {
    runningSubagentRuns: () => [],
    getAutoContinueEvents: () => [],
    getChat: () => ({ id: "chat-1", provider: "claude" }),
    appendMessage: async (chatId: string, entry: TranscriptEntry) => {
      appended.push({ chatId, entry })
    },
    recordTurnStarted: async () => {},
  }

  const coordinator = new AgentCoordinator({
    store: store as never,
    onStateChange: () => {},
    startClaudeSession: async (args: { onCompaction?: (event: CompactionEvent) => void }) => {
      observe = args.onCompaction
      return fakeHandle()
    },
  } as never)

  await coordinator.startClaudeTurn({
    chatId: "chat-1",
    projectId: "proj-1",
    localPath: "/tmp/project",
    model: "claude-opus-5",
    planMode: false,
    sessionToken: null,
    forkSession: false,
    onToolRequest: async () => null,
    provider: "claude",
  } as never)

  if (!observe) throw new Error("the coordinator did not wire an onCompaction observer")
  return { appended, observe }
}

describe("AgentCoordinator compaction handling", () => {
  let recorder: MetricRecorder | null = null
  let prevDriver: string | undefined

  beforeAll(() => {
    prevDriver = process.env.KANNA_CLAUDE_DRIVER
    process.env.KANNA_CLAUDE_DRIVER = "sdk"
  })

  afterAll(() => {
    if (prevDriver === undefined) delete process.env.KANNA_CLAUDE_DRIVER
    else process.env.KANNA_CLAUDE_DRIVER = prevDriver
  })

  afterEach(async () => {
    await recorder?.dispose()
    recorder = null
  })

  test("PostCompact appends the summary, so the primer can cross the boundary", async () => {
    const { appended, observe } = await captureCompactionObserver()

    observe({
      phase: "post",
      chatId: "chat-1",
      sessionId: "sess-1",
      trigger: "auto",
      summary: "So far: wired the compaction hooks.",
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(appended).toHaveLength(1)
    expect(appended[0]?.chatId).toBe("chat-1")
    const entry = appended[0]?.entry
    if (entry?.kind !== "compact_summary") throw new Error("expected a compact_summary entry")
    expect(entry.summary).toBe("So far: wired the compaction hooks.")
    expect(entry.messageId).toContain("sess-1")
  })

  test("PreCompact records the counter and writes nothing to the transcript", async () => {
    recorder = startMetricRecorder()
    const { appended, observe } = await captureCompactionObserver()

    observe({ phase: "pre", chatId: "chat-1", sessionId: "sess-1", trigger: "manual" })
    await Promise.resolve()

    expect(appended).toEqual([])
    const [started] = await recorder.counter(COMPACTION_STARTED)
    expect(started?.value).toBe(1)
    expect(started?.attributes).toEqual({ provider: "claude", trigger: "manual" })
  })

  test("a PostCompact with no summary appends nothing", async () => {
    const { appended, observe } = await captureCompactionObserver()

    observe({ phase: "post", chatId: "chat-1", sessionId: "sess-1", trigger: "auto" })
    await Promise.resolve()
    await Promise.resolve()

    expect(appended).toEqual([])
  })

  test("a failing append does not throw into the hook", async () => {
    const appended: { chatId: string; entry: TranscriptEntry }[] = []
    let observe: ((event: CompactionEvent) => void) | undefined
    const store = {
      runningSubagentRuns: () => [],
      getAutoContinueEvents: () => [],
      getChat: () => ({ id: "chat-1", provider: "claude" }),
      appendMessage: async () => { throw new Error("Chat not found") },
      recordTurnStarted: async () => {},
    }
    const coordinator = new AgentCoordinator({
      store: store as never,
      onStateChange: () => {},
      startClaudeSession: async (args: { onCompaction?: (event: CompactionEvent) => void }) => {
        observe = args.onCompaction
        return fakeHandle()
      },
    } as never)
    await coordinator.startClaudeTurn({
      chatId: "chat-1",
      projectId: "proj-1",
      localPath: "/tmp/project",
      model: "claude-opus-5",
      planMode: false,
      sessionToken: null,
      forkSession: false,
      onToolRequest: async () => null,
      provider: "claude",
    } as never)

    expect(() => observe?.({
      phase: "post",
      chatId: "chat-1",
      sessionId: "sess-1",
      summary: "x",
    })).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(appended).toEqual([])
  })
})
