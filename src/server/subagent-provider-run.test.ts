import { describe, expect, test } from "bun:test"
import type { ClaudeModelOptions, Subagent, TranscriptEntry } from "../shared/types"
import type { HarnessEvent, HarnessTurn, HarnessToolRequest } from "./harness-types"
import type { StartCodexSessionArgs, CodexSessionScope } from "./codex-app-server"
import { buildSubagentProviderRun, composeInitialPrompt, composeSubagentSystemPrompt, drainOneTurn, type BuildSubagentProviderRunArgs } from "./subagent-provider-run"
import type { StartCodexTurnArgs } from "./codex-app-server"

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
    userInstruction: null,
    runId: "run-abc",
    abortSignal: new AbortController().signal,
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
// composeInitialPrompt
// ---------------------------------------------------------------------------

describe("composeInitialPrompt", () => {
  const subagent = makeSubagent({ name: "reviewer" })

  test("instruction + primer → instruction rendered above primer", () => {
    const prompt = composeInitialPrompt(subagent, "Previous reply text", "review my code")
    expect(prompt).toBe("User asked: review my code\n\nPrevious reply text")
  })

  test("instruction only → no primer block", () => {
    const prompt = composeInitialPrompt(subagent, null, "review my code")
    expect(prompt).toBe("User asked: review my code")
  })

  test("primer only → preserved (legacy behaviour)", () => {
    const prompt = composeInitialPrompt(subagent, "Previous reply text", null)
    expect(prompt).toBe("Previous reply text")
  })

  test("neither → fallback hint mentions subagent name", () => {
    const prompt = composeInitialPrompt(subagent, null, null)
    expect(prompt).toContain("@agent/reviewer")
  })

  test("whitespace-only instruction treated as missing", () => {
    const prompt = composeInitialPrompt(subagent, "primer", "   \n\t  ")
    expect(prompt).toBe("primer")
  })
})

// ---------------------------------------------------------------------------
// composeSubagentSystemPrompt
// ---------------------------------------------------------------------------

describe("composeSubagentSystemPrompt", () => {
  test("returns the subagent prompt unchanged when no global text", () => {
    expect(composeSubagentSystemPrompt("You are alpha.")).toBe("You are alpha.")
  })

  test("returns the subagent prompt unchanged when global text is whitespace", () => {
    expect(composeSubagentSystemPrompt("You are alpha.", "   \n  ")).toBe("You are alpha.")
  })

  test("appends a Project instructions block after the subagent prompt", () => {
    const out = composeSubagentSystemPrompt("You are alpha.", "Always TDD.")
    expect(out).toBe("You are alpha.\n\n## Project instructions\n\nAlways TDD.")
  })

  test("emits only the project block when subagent prompt is empty", () => {
    const out = composeSubagentSystemPrompt("", "Always TDD.")
    expect(out).toBe("## Project instructions\n\nAlways TDD.")
  })
})

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

  test("composes globalPromptAppend into systemPromptOverride", async () => {
    let captured: { systemPromptOverride?: string } | undefined
    const args = makeArgs({
      globalPromptAppend: "Always TDD.",
      startClaudeSession: async (sessionArgs) => {
        captured = sessionArgs
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
    expect(captured?.systemPromptOverride).toBe("You are alpha.\n\n## Project instructions\n\nAlways TDD.")
  })

  test("leaves systemPromptOverride untouched when no globalPromptAppend", async () => {
    let captured: { systemPromptOverride?: string } | undefined
    const args = makeArgs({
      startClaudeSession: async (sessionArgs) => {
        captured = sessionArgs
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
    expect(captured?.systemPromptOverride).toBe("You are alpha.")
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

  test("passes globalPromptAppend through as developer_instructions when set", async () => {
    let captured: StartCodexTurnArgs | undefined
    const args = makeArgs({
      subagent: makeSubagent({ provider: "codex", model: "gpt-5.5" }),
      runId: "run-di",
      globalPromptAppend: "Be terse.",
      codexManager: {
        startSession: async () => {},
        startTurn: async (turnArgs: StartCodexTurnArgs) => {
          captured = turnArgs
          return makeHarnessTurn([makeTextEvent("ok")])
        },
        stopSession: () => {},
      } as unknown as BuildSubagentProviderRunArgs["codexManager"],
    })
    const run = buildSubagentProviderRun(args)
    await run.start(() => {}, () => {})
    expect(captured?.developerInstructions).toBe("Be terse.")
  })

  test("omits developer_instructions when globalPromptAppend missing", async () => {
    let captured: StartCodexTurnArgs | undefined
    const args = makeArgs({
      subagent: makeSubagent({ provider: "codex", model: "gpt-5.5" }),
      runId: "run-no-di",
      codexManager: {
        startSession: async () => {},
        startTurn: async (turnArgs: StartCodexTurnArgs) => {
          captured = turnArgs
          return makeHarnessTurn([makeTextEvent("ok")])
        },
        stopSession: () => {},
      } as unknown as BuildSubagentProviderRunArgs["codexManager"],
    })
    const run = buildSubagentProviderRun(args)
    await run.start(() => {}, () => {})
    expect(captured?.developerInstructions).toBeUndefined()
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

// ---------------------------------------------------------------------------
// keep-alive / LiveTurnSource
// ---------------------------------------------------------------------------

describe("buildSubagentProviderRun – keep-alive Claude", () => {
  test("keep-alive claude run returns a live source that drives turn 2", async () => {
    // A simple push-queue that lets the test feed events into the stream
    // in sync with what the implementation requests.
    const queue: Array<{ resolve: (r: IteratorResult<HarnessEvent>) => void }> = []
    const pending: HarnessEvent[] = []
    let done = false

    async function nextFromQueue(): Promise<IteratorResult<HarnessEvent>> {
      if (pending.length > 0) {
        return { value: pending.shift()!, done: false }
      }
      if (done) return { value: undefined as never, done: true }
      return new Promise<IteratorResult<HarnessEvent>>((resolve) => {
        queue.push({ resolve })
      })
    }

    function pushEvent(ev: HarnessEvent) {
      if (queue.length > 0) {
        queue.shift()!.resolve({ value: ev, done: false })
      } else {
        pending.push(ev)
      }
    }

    const feedableStream: AsyncIterable<HarnessEvent> = {
      [Symbol.asyncIterator]() {
        return { next: nextFromQueue }
      },
    }

    const pushed: string[] = []
    let closed = false

    const args = makeArgs({
      startClaudeSession: async () => ({
        provider: "claude" as const,
        stream: feedableStream,
        interrupt: async () => {},
        close: () => { closed = true },
        sendPrompt: async () => {},
        setModel: async () => {},
        setPermissionMode: async () => {},
        getSupportedCommands: async () => [],
        pushChannelPrompt: async (text: string) => {
          pushed.push(text)
          // Feed a reply for this prompt and then a result
          pushEvent(makeTextEvent(`r:${text}`))
          pushEvent(makeResultEvent())
        },
      }),
    })

    // Pre-feed turn-1 events BEFORE calling start so the iterator sees them
    pushEvent(makeTextEvent("t1"))
    pushEvent(makeResultEvent())

    const run = buildSubagentProviderRun(args)
    const first = await run.start(() => {}, () => {}, { keepAlive: true })

    expect(first.text).toBe("t1")
    expect(first.live).toBeDefined()

    const second = await first.live!.runTurn("hi", () => {}, () => {})
    expect(pushed).toEqual(["hi"])
    expect(second.text).toBe("r:hi")

    await first.live!.close()
    expect(closed).toBe(true)
  })

  test("keepAlive:true is forwarded to startClaudeSession", async () => {
    const capturedKeepAlive: Array<boolean | undefined> = []

    const args = makeArgs({
      startClaudeSession: async (sessionArgs) => {
        capturedKeepAlive.push(sessionArgs.keepAlive)
        return {
          provider: "claude" as const,
          stream: makeHarnessTurn([makeTextEvent("t1"), makeResultEvent()]).stream,
          interrupt: async () => {},
          close: () => {},
          sendPrompt: async () => {},
          setModel: async () => {},
          setPermissionMode: async () => {},
          getSupportedCommands: async () => [],
          pushChannelPrompt: async (_text: string) => {},
        }
      },
    })

    const run = buildSubagentProviderRun(args)
    await run.start(() => {}, () => {}, { keepAlive: true })
    expect(capturedKeepAlive[0]).toBe(true)
  })

  test("keep-alive without pushChannelPrompt fails closed and closes session", async () => {
    let sessionClosed = false

    const args = makeArgs({
      startClaudeSession: async () => ({
        provider: "claude" as const,
        stream: makeHarnessTurn([makeTextEvent("t1"), makeResultEvent()]).stream,
        interrupt: async () => {},
        close: () => { sessionClosed = true },
        sendPrompt: async () => {},
        setModel: async () => {},
        setPermissionMode: async () => {},
        getSupportedCommands: async () => [],
        // no pushChannelPrompt — keep-alive must fail closed
      }),
    })

    const run = buildSubagentProviderRun(args)
    let err: unknown = null
    try {
      await run.start(() => {}, () => {}, { keepAlive: true })
    } catch (e) {
      err = e
    }
    expect((err as Error)?.message).toContain("pushChannelPrompt missing")
    expect(sessionClosed).toBe(true)
  })

  test("keepAlive:false preserves one-shot semantics (session closed after run)", async () => {
    let sessionClosed = false

    const args = makeArgs({
      startClaudeSession: async () => ({
        provider: "claude" as const,
        stream: makeHarnessTurn([makeTextEvent("one-shot"), makeResultEvent()]).stream,
        interrupt: async () => {},
        close: () => { sessionClosed = true },
        sendPrompt: async () => {},
        setModel: async () => {},
        setPermissionMode: async () => {},
        getSupportedCommands: async () => [],
      }),
    })

    const run = buildSubagentProviderRun(args)
    const result = await run.start(() => {}, () => {}, { keepAlive: false })
    expect(result.text).toBe("one-shot")
    expect(result.live).toBeUndefined()
    expect(sessionClosed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// drainOneTurn
// ---------------------------------------------------------------------------

describe("drainOneTurn", () => {
  /** Returns a single AsyncIterator that advances through events on each next() call. */
  function makeIterator(events: HarnessEvent[]): AsyncIterator<HarnessEvent> {
    let i = 0
    return {
      async next() {
        if (i < events.length) return { value: events[i++] as HarnessEvent, done: false }
        return { value: undefined as never, done: true }
      },
    }
  }

  test("returns text at first result and leaves iterator open", async () => {
    // Build minimally-valid TranscriptEntry fixtures via cast (test file is lint-exempt)
    const events: HarnessEvent[] = [
      {
        type: "transcript",
        entry: { _id: "e1", createdAt: 1, kind: "assistant_text", text: "hello " } as TranscriptEntry,
      },
      {
        type: "transcript",
        entry: { _id: "e2", createdAt: 2, kind: "assistant_text", text: "world" } as TranscriptEntry,
      },
      {
        type: "transcript",
        entry: {
          _id: "e3",
          createdAt: 3,
          kind: "result",
          subtype: "success",
          isError: false,
          durationMs: 10,
          result: "done",
        } as TranscriptEntry,
      },
      // This event belongs to a second turn — drainOneTurn must NOT consume it
      {
        type: "transcript",
        entry: { _id: "e4", createdAt: 4, kind: "assistant_text", text: "TURN2" } as TranscriptEntry,
      },
    ]

    const it = makeIterator(events)
    const chunks: string[] = []
    const entries: TranscriptEntry[] = []
    const out = await drainOneTurn(it, (c) => chunks.push(c), (e) => entries.push(e))

    expect(out.text).toBe("hello world")
    expect(chunks).toEqual(["hello ", "world"])
    expect(out.sawResult).toBe(true)
    expect(out.sawError).toBe(false)

    // Iterator is still open — TURN2 event must still be consumable.
    // makeIterator returns the same object, so .next() resumes from where drain stopped.
    const next = await it.next()
    expect((next.value as HarnessEvent).entry?.kind).toBe("assistant_text")
    expect(
      ((next.value as HarnessEvent).entry as { kind: "assistant_text"; text: string } & TranscriptEntry).text,
    ).toBe("TURN2")
  })

  test("propagates usage fields from result entry", async () => {
    const it = makeIterator([
      {
        type: "transcript",
        entry: {
          _id: "r1",
          createdAt: 1,
          kind: "result",
          subtype: "success",
          isError: false,
          durationMs: 50,
          result: "ok",
          costUsd: 0.042,
          usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2 },
        } as TranscriptEntry,
      },
    ])
    const out = await drainOneTurn(it, () => {}, () => {})
    expect(out.usage?.inputTokens).toBe(10)
    expect(out.usage?.outputTokens).toBe(5)
    expect(out.usage?.cachedInputTokens).toBe(2)
    expect(out.usage?.costUsd).toBe(0.042)
    expect(out.sawResult).toBe(true)
  })

  test("sets sawError when api_error entry is received", async () => {
    const it = makeIterator([
      {
        type: "transcript",
        entry: {
          _id: "ae1",
          createdAt: 1,
          kind: "api_error",
          status: 500,
          text: "internal server error",
        } as TranscriptEntry,
      },
      {
        type: "transcript",
        entry: {
          _id: "r2",
          createdAt: 2,
          kind: "result",
          subtype: "error",
          isError: true,
          durationMs: 10,
          result: "failed",
        } as TranscriptEntry,
      },
    ])
    const out = await drainOneTurn(it, () => {}, () => {})
    expect(out.sawError).toBe(true)
    expect(out.sawResult).toBe(true)
  })

  test("skips non-transcript events", async () => {
    const it = makeIterator([
      { type: "session_token", sessionToken: "tok123" },
      {
        type: "transcript",
        entry: { _id: "t1", createdAt: 1, kind: "assistant_text", text: "hi" } as TranscriptEntry,
      },
      {
        type: "transcript",
        entry: {
          _id: "r3",
          createdAt: 2,
          kind: "result",
          subtype: "success",
          isError: false,
          durationMs: 5,
          result: "ok",
        } as TranscriptEntry,
      },
    ])
    const chunks: string[] = []
    const out = await drainOneTurn(it, (c) => chunks.push(c), () => {})
    expect(chunks).toEqual(["hi"])
    expect(out.text).toBe("hi")
    expect(out.sawResult).toBe(true)
  })

  test("empty/premature-close: done before any result → not a successful turn", async () => {
    // An iterator that closes immediately (e.g. driver crashed before sending result).
    // Multi-turn callers depend on sawResult===false to detect this condition.
    const it = makeIterator([])
    const out = await drainOneTurn(it, () => {}, () => {})
    expect(out.text).toBe("")
    expect(out.usage).toBeUndefined()
    expect(out.sawResult).toBe(false)
    expect(out.sawError).toBe(false)
  })

  test("result with isError:true (no preceding api_error) sets sawError via result branch", async () => {
    // PTY-synth error path: the driver synthesises a result entry with isError:true
    // directly, without emitting a separate api_error entry first.
    const it = makeIterator([
      {
        type: "transcript",
        entry: {
          _id: "synth1",
          createdAt: 1,
          kind: "result",
          subtype: "error",
          isError: true,
          durationMs: 0,
          result: "process died",
        } as TranscriptEntry,
      },
    ])
    const out = await drainOneTurn(it, () => {}, () => {})
    expect(out.sawResult).toBe(true)
    expect(out.sawError).toBe(true)
  })
})
