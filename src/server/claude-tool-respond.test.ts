/**
 * Tests for claude-tool-respond.ts — the extracted respondTool handler.
 */
import { describe, it, expect, mock } from "bun:test"
import {
  respondTool,
  type RespondToolCommand,
  type ToolRespondDeps,
} from "./claude-tool-respond"
import type { PendingToolRequest, ActiveTurn } from "./claude-session-state"
import type { AnyValue } from "../shared/errors"
import type { AskUserQuestionToolCall, ExitPlanModeToolCall } from "../shared/types"

// ---------------------------------------------------------------------------
// Minimal tool call stubs that satisfy the PendingToolRequest.tool type
// ---------------------------------------------------------------------------

function askUserQuestionTool(toolId: string): AskUserQuestionToolCall {
  return {
    kind: "tool",
    toolKind: "ask_user_question",
    toolName: "ask_user_question",
    toolId,
    input: { questions: [] },
  }
}

function exitPlanModeTool(toolId: string): ExitPlanModeToolCall {
  return {
    kind: "tool",
    toolKind: "exit_plan_mode",
    toolName: "exit_plan_mode",
    toolId,
    input: {},
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActiveTurn(overrides: Partial<ActiveTurn> = {}): ActiveTurn {
  return {
    chatId: "chat-1",
    provider: "claude",
    turn: {} as ActiveTurn["turn"],
    model: "claude-opus-4-5",
    planMode: true,
    status: "waiting_for_user",
    pendingTool: null,
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    waitStartedAt: Date.now(),
    userMessageId: null,
    ...overrides,
  }
}

type AppendMessageFn = (chatId: string, entry: { kind: string }) => Promise<void>
type SetSessionTokenFn = (
  chatId: string,
  provider: string,
  token: string | null,
) => Promise<void>

function makeDeps(
  activeTurns: Map<string, ActiveTurn>,
  appendMessage = mock(async (_chatId: string, _entry: unknown) => {}),
  setSessionTokenForProvider = mock(
    async (_chatId: string, _provider: string, _token: string | null) => {},
  ),
  emitStateChange = mock((_chatId: string) => {}),
): ToolRespondDeps {
  return {
    activeTurns,
    store: {
      appendMessage: appendMessage as unknown as AppendMessageFn,
      setSessionTokenForProvider: setSessionTokenForProvider as unknown as SetSessionTokenFn,
    },
    emitStateChange,
  }
}

function makeCommand(
  overrides: Partial<RespondToolCommand> = {},
): RespondToolCommand {
  return {
    type: "chat.respondTool",
    chatId: "chat-1",
    toolUseId: "tool-abc",
    result: { confirmed: true } as AnyValue,
    ...overrides,
  }
}

function makePendingTool(
  toolUseId: string,
  tool: PendingToolRequest["tool"],
  resolve: (v: AnyValue) => void,
): PendingToolRequest {
  return { toolUseId, tool, resolve }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("respondTool", () => {
  it("throws when there is no active turn for the chat", async () => {
    const deps = makeDeps(new Map())
    await expect(respondTool(deps, makeCommand())).rejects.toThrow(
      "No pending tool request",
    )
  })

  it("throws when the active turn has no pending tool", async () => {
    const active = makeActiveTurn({ pendingTool: null })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns)
    await expect(respondTool(deps, makeCommand())).rejects.toThrow(
      "No pending tool request",
    )
  })

  it("throws when toolUseId does not match the pending request", async () => {
    const resolve = mock((_v: AnyValue) => {})
    const pending = makePendingTool(
      "tool-xyz",
      askUserQuestionTool("tool-xyz"),
      resolve,
    )
    const active = makeActiveTurn({ pendingTool: pending })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns)

    await expect(
      respondTool(deps, makeCommand({ toolUseId: "tool-DIFFERENT" })),
    ).rejects.toThrow("Tool response does not match active request")
  })

  it("resolves an ask_user_question tool and updates active turn state", async () => {
    const resolve = mock((_v: AnyValue) => {})
    const appendMessage = mock(async (_chatId: string, _entry: unknown) => {})
    const emitStateChange = mock((_chatId: string) => {})
    const result: AnyValue = { answer: "yes" }

    const pending = makePendingTool(
      "tool-abc",
      askUserQuestionTool("tool-abc"),
      resolve,
    )
    const active = makeActiveTurn({
      status: "waiting_for_user",
      waitStartedAt: 12345,
      pendingTool: pending,
    })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(
      turns,
      appendMessage,
      mock(async (_chatId: string, _provider: string, _token: string | null) => {}),
      emitStateChange,
    )

    await respondTool(deps, makeCommand({ result }))

    // tool_result appended
    expect(appendMessage).toHaveBeenCalledTimes(1)
    const callArgs = appendMessage.mock.calls[0] as unknown as [
      string,
      { kind: string },
    ]
    expect(callArgs[1].kind).toBe("tool_result")

    // active turn state updated
    expect(active.pendingTool).toBeNull()
    expect(active.status).toBe("running")
    expect(active.waitStartedAt).toBeNull()

    // promise resolved
    expect(resolve).toHaveBeenCalledWith(result)

    // state change emitted
    expect(emitStateChange).toHaveBeenCalledWith("chat-1")
  })

  it("clears session token and appends context_cleared when exit_plan_mode confirmed+clearContext", async () => {
    const resolve = mock((_v: AnyValue) => {})
    const appendMessage = mock(async (_chatId: string, _entry: unknown) => {})
    const setSessionTokenForProvider = mock(
      async (_chatId: string, _provider: string, _token: string | null) => {},
    )
    const emitStateChange = mock((_chatId: string) => {})

    const pending = makePendingTool(
      "tool-abc",
      exitPlanModeTool("tool-abc"),
      resolve,
    )
    const active = makeActiveTurn({ provider: "claude", pendingTool: pending })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns, appendMessage, setSessionTokenForProvider, emitStateChange)

    await respondTool(
      deps,
      makeCommand({
        result: { confirmed: true, clearContext: true, message: "" } as AnyValue,
      }),
    )

    expect(setSessionTokenForProvider).toHaveBeenCalledWith("chat-1", "claude", null)

    // appendMessage: tool_result + context_cleared
    expect(appendMessage).toHaveBeenCalledTimes(2)
    const call2 = appendMessage.mock.calls[1] as unknown as [string, { kind: string }]
    expect(call2[1].kind).toBe("context_cleared")
  })

  it("does NOT clear context when confirmed=false even if clearContext=true", async () => {
    const resolve = mock((_v: AnyValue) => {})
    const appendMessage = mock(async (_chatId: string, _entry: unknown) => {})
    const setSessionTokenForProvider = mock(
      async (_chatId: string, _provider: string, _token: string | null) => {},
    )

    const pending = makePendingTool(
      "tool-abc",
      exitPlanModeTool("tool-abc"),
      resolve,
    )
    const active = makeActiveTurn({ provider: "claude", pendingTool: pending })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns, appendMessage, setSessionTokenForProvider)

    await respondTool(
      deps,
      makeCommand({ result: { confirmed: false, clearContext: true } as AnyValue }),
    )

    expect(setSessionTokenForProvider).not.toHaveBeenCalled()
    // only tool_result appended (no context_cleared)
    expect(appendMessage).toHaveBeenCalledTimes(1)
  })

  it("sets postToolFollowUp on codex provider when exit_plan_mode confirmed", async () => {
    const resolve = mock((_v: AnyValue) => {})

    const pending = makePendingTool(
      "tool-abc",
      exitPlanModeTool("tool-abc"),
      resolve,
    )
    const active = makeActiveTurn({ provider: "codex", pendingTool: pending })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns)

    await respondTool(
      deps,
      makeCommand({
        result: { confirmed: true, clearContext: false, message: "great plan" } as AnyValue,
      }),
    )

    expect(active.postToolFollowUp).toEqual({
      content: "Proceed with the approved plan. Additional guidance: great plan",
      planMode: false,
    })
  })

  it("sets postToolFollowUp on codex provider when exit_plan_mode rejected", async () => {
    const resolve = mock((_v: AnyValue) => {})

    const pending = makePendingTool(
      "tool-abc",
      exitPlanModeTool("tool-abc"),
      resolve,
    )
    const active = makeActiveTurn({ provider: "codex", pendingTool: pending })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns)

    await respondTool(
      deps,
      makeCommand({
        result: { confirmed: false, clearContext: false, message: "needs work" } as AnyValue,
      }),
    )

    expect(active.postToolFollowUp).toEqual({
      content: "Revise the plan using this feedback: needs work",
      planMode: true,
    })
  })

  it("uses default messages when message field is empty", async () => {
    const resolve = mock((_v: AnyValue) => {})

    const pending = makePendingTool(
      "tool-abc",
      exitPlanModeTool("tool-abc"),
      resolve,
    )
    const active = makeActiveTurn({ provider: "codex", pendingTool: pending })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns)

    await respondTool(
      deps,
      makeCommand({
        result: { confirmed: true, clearContext: false, message: "" } as AnyValue,
      }),
    )

    expect(active.postToolFollowUp).toEqual({
      content: "Proceed with the approved plan.",
      planMode: false,
    })
  })
})
