import { describe, expect, test } from "bun:test"
import type { ClaudeModelOptions, Subagent, TranscriptEntry } from "../shared/types"
import type { HarnessEvent, HarnessTurn, HarnessToolRequest } from "./harness-types"
import type { StartCodexSessionArgs, CodexSessionScope } from "./codex-app-server"
import { buildSubagentProviderRun, type BuildSubagentProviderRunArgs } from "./subagent-provider-run"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSubagent(over: Partial<Subagent> = {}): Subagent {
  const modelOptions: ClaudeModelOptions = { reasoningEffort: "medium", contextWindow: "1m" }
  return {
    id: over.id ?? "sa-1",
    name: over.name ?? "alpha",
    provider: over.provider ?? "claude",
    model: over.model ?? "claude-opus-4-7",
    modelOptions: over.modelOptions ?? modelOptions,
    systemPrompt: over.systemPrompt ?? "You are alpha.",
    contextScope: over.contextScope ?? "previous-assistant-reply",
    createdAt: over.createdAt ?? 1,
    updatedAt: over.updatedAt ?? 1,
    ...(over.description !== undefined ? { description: over.description } : {}),
  }
}

function makeHarnessTurn(events: HarnessEvent[]): HarnessTurn {
  return {
    provider: "claude",
    stream: (async function* () {
      for (const ev of events) yield ev
    })(),
    interrupt: async () => {},
    close: () => {},
  }
}

function makeTextEvent(text: string): HarnessEvent {
  const entry: TranscriptEntry = {
    _id: "entry-1",
    createdAt: Date.now(),
    kind: "assistant_text",
    text,
  } as TranscriptEntry
  return { type: "transcript", entry }
}

function makeResultEvent(costUsd?: number): HarnessEvent {
  const entry: TranscriptEntry = {
    _id: "entry-result",
    createdAt: Date.now(),
    kind: "result",
    subtype: "success",
    isError: false,
    durationMs: 100,
    result: "done",
    costUsd,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 2,
    },
  } as TranscriptEntry
  return { type: "transcript", entry }
}

// ---------------------------------------------------------------------------
// Default fakes
// ---------------------------------------------------------------------------

const noopOnToolRequest = async (_req: HarnessToolRequest): Promise<unknown> => undefined

function makeArgs(over: Partial<BuildSubagentProviderRunArgs> = {}): BuildSubagentProviderRunArgs {
  return {
    subagent: makeSubagent(),
    chatId: "chat-1",
    primer: "some primer",
    runId: "run-abc",
    cwd: "/tmp/project",
    additionalDirectories: [],
    startClaudeSession: async () => {
      throw new Error("startClaudeSession not configured in this test")
    },
    codexManager: {
      startSession: async () => {},
      startTurn: async () => {
        throw new Error("startTurn not configured in this test")
      },
      stopSession: () => {},
    } as unknown as BuildSubagentProviderRunArgs["codexManager"],
    onToolRequest: noopOnToolRequest,
    authReady: async () => true,
    pickOauthToken: () => null,
    projectId: "proj-1",
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Claude tests
// ---------------------------------------------------------------------------

describe("buildSubagentProviderRun – Claude", () => {
  test("forwards assistant_text chunks and result entry to onChunk + onEntry", async () => {
    const chunks: string[] = []
    const entries: TranscriptEntry[] = []

    const events: HarnessEvent[] = [
      makeTextEvent("Hello "),
      makeTextEvent("world"),
      makeResultEvent(0.001),
    ]

    let sessionClosed = false
    const args = makeArgs({
      startClaudeSession: async () => ({
        provider: "claude" as const,
        stream: makeHarnessTurn(events).stream,
        interrupt: async () => {},
        close: () => { sessionClosed = true },
        sendPrompt: async () => {},
        setModel: async () => {},
        setPermissionMode: async () => {},
        getSupportedCommands: async () => [],
      }),
    })

    const run = buildSubagentProviderRun(args)
    const result = await run.start(
      (chunk) => chunks.push(chunk),
      (entry) => entries.push(entry),
    )

    expect(result.text).toBe("Hello world")
    expect(chunks).toEqual(["Hello ", "world"])
    expect(entries).toHaveLength(3)
    expect(result.usage?.inputTokens).toBe(10)
    expect(result.usage?.outputTokens).toBe(5)
    expect(result.usage?.costUsd).toBe(0.001)
    expect(sessionClosed).toBe(true)
  })

  test("authReady=false causes authReady() to return false (orchestrator gates)", async () => {
    const args = makeArgs({
      authReady: async () => false,
    })

    const run = buildSubagentProviderRun(args)
    const ready = await run.authReady()
    expect(ready).toBe(false)
  })

  test("session.close() runs even if stream throws", async () => {
    let sessionClosed = false

    const args = makeArgs({
      startClaudeSession: async () => ({
        provider: "claude" as const,
        stream: (async function* () {
          yield makeTextEvent("partial")
          throw new Error("stream exploded")
        })(),
        interrupt: async () => {},
        close: () => { sessionClosed = true },
        sendPrompt: async () => {},
        setModel: async () => {},
        setPermissionMode: async () => {},
        getSupportedCommands: async () => [],
      }),
    })

    const run = buildSubagentProviderRun(args)
    let err: unknown = null
    try {
      await run.start(() => {}, () => {})
    } catch (e) { err = e }
    expect((err as Error)?.message).toBe("stream exploded")

    expect(sessionClosed).toBe(true)
  })

  test("forwards onToolRequest into Claude session args", async () => {
    const receivedToolRequests: HarnessToolRequest[] = []
    let capturedOnToolRequest: ((req: HarnessToolRequest) => Promise<unknown>) | null = null

    const toolRequest: HarnessToolRequest = {
      tool: {
        kind: "tool",
        toolKind: "ask_user_question",
        toolId: "tool-1",
        toolName: "AskUserQuestion",
        input: { questions: [{ question: "Are you sure?" }] },
      },
    }

    const args = makeArgs({
      onToolRequest: async (req) => {
        receivedToolRequests.push(req)
        return "yes"
      },
      startClaudeSession: async (sessionArgs) => {
        capturedOnToolRequest = sessionArgs.onToolRequest
        return {
          provider: "claude" as const,
          stream: makeHarnessTurn([]).stream,
          interrupt: async () => {},
          close: () => {},
          sendPrompt: async () => {},
          setModel: async () => {},
          setPermissionMode: async () => {},
          getSupportedCommands: async () => [],
        }
      },
    })

    const run = buildSubagentProviderRun(args)
    await run.start(() => {}, () => {})

    expect(capturedOnToolRequest).not.toBeNull()
    await capturedOnToolRequest!(toolRequest)
    expect(receivedToolRequests).toHaveLength(1)
    expect(receivedToolRequests[0]).toBe(toolRequest)
  })
})

// ---------------------------------------------------------------------------
// Codex tests
// ---------------------------------------------------------------------------

describe("buildSubagentProviderRun – Codex", () => {
  test("starts and stops sub:runId-keyed codex session", async () => {
    const calls: string[] = []
    let startedScope: string | undefined

    const codexTurnEvents: HarnessEvent[] = [
      makeTextEvent("codex reply"),
    ]

    const args = makeArgs({
      subagent: makeSubagent({ provider: "codex", model: "o4-mini" }),
      runId: "run-xyz",
      codexManager: {
        startSession: async (a: StartCodexSessionArgs) => {
          calls.push("startSession")
          startedScope = a.scope as string
        },
        startTurn: async () => {
          calls.push("startTurn")
          return makeHarnessTurn(codexTurnEvents)
        },
        stopSession: (_chatId: string, scope: CodexSessionScope) => {
          calls.push(`stopSession:${scope}`)
        },
      } as unknown as BuildSubagentProviderRunArgs["codexManager"],
    })

    const run = buildSubagentProviderRun(args)
    const result = await run.start(() => {}, () => {})

    expect(result.text).toBe("codex reply")
    expect(startedScope).toBe("sub:run-xyz")
    expect(calls).toEqual(["startSession", "startTurn", "stopSession:sub:run-xyz"])
  })

  test("stopSession runs even when startTurn throws", async () => {
    const calls: string[] = []

    const args = makeArgs({
      subagent: makeSubagent({ provider: "codex", model: "o4-mini" }),
      runId: "run-fail",
      codexManager: {
        startSession: async () => { calls.push("startSession") },
        startTurn: async () => {
          calls.push("startTurn")
          throw new Error("codex start turn failed")
        },
        stopSession: (_chatId: string, scope: CodexSessionScope) => {
          calls.push(`stopSession:${scope}`)
        },
      } as unknown as BuildSubagentProviderRunArgs["codexManager"],
    })

    const run = buildSubagentProviderRun(args)
    let err: unknown = null
    try {
      await run.start(() => {}, () => {})
    } catch (e) { err = e }
    expect((err as Error)?.message).toBe("codex start turn failed")

    expect(calls).toEqual(["startSession", "startTurn", "stopSession:sub:run-fail"])
  })
})
