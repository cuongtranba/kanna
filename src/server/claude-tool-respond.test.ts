/**
 * Tests for claude-tool-respond.ts — the extracted respondTool handler.
 *
 * The parked continuation lives in PendingToolSlots (turn-independent); the
 * ActiveTurn only carries UI status. Both shapes are covered: a request
 * parked mid-turn and one parked with NO active turn (SDK self-wake).
 */
import { describe, it, expect, mock } from "bun:test"
import {
  respondTool,
  type RespondToolCommand,
  type ToolRespondDeps,
} from "./claude-tool-respond"
import type { ActiveTurn } from "./claude-session-state"
import { PendingToolSlots, type ParkedTool } from "./pending-tool-slot"
import type { AnyValue } from "../shared/errors"
import type { AgentProvider, AskUserQuestionToolCall, ExitPlanModeToolCall } from "../shared/types"

// ---------------------------------------------------------------------------
// Minimal tool call stubs that satisfy the ParkedTool.tool type
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
  pendingTools: PendingToolSlots,
  appendMessage = mock(async (_chatId: string, _entry: unknown) => {}),
  setSessionTokenForProvider = mock(
    async (_chatId: string, _provider: string, _token: string | null) => {},
  ),
  emitStateChange = mock((_chatId: string) => {}),
): ToolRespondDeps {
  return {
    activeTurns,
    pendingTools,
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

function parkTool(
  slots: PendingToolSlots,
  chatId: string,
  tool: ParkedTool["tool"],
  resolve: (v: AnyValue) => void,
  provider: AgentProvider = "claude",
): ParkedTool {
  return slots.park(chatId, {
    toolUseId: tool.toolId,
    provider,
    tool,
    parkedAt: Date.now(),
    resolve,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("respondTool", () => {
  it("throws when nothing is parked for the chat", async () => {
    const deps = makeDeps(new Map(), new PendingToolSlots())
    await expect(respondTool(deps, makeCommand())).rejects.toThrow(
      "No pending tool request",
    )
  })

  it("throws when an active turn exists but nothing is parked", async () => {
    const turns = new Map([["chat-1", makeActiveTurn()]])
    const deps = makeDeps(turns, new PendingToolSlots())
    await expect(respondTool(deps, makeCommand())).rejects.toThrow(
      "No pending tool request",
    )
  })

  it("throws when toolUseId does not match the parked request", async () => {
    const slots = new PendingToolSlots()
    const resolve = mock((_v: AnyValue) => {})
    parkTool(slots, "chat-1", askUserQuestionTool("tool-xyz"), resolve)
    const deps = makeDeps(new Map([["chat-1", makeActiveTurn()]]), slots)

    await expect(
      respondTool(deps, makeCommand({ toolUseId: "tool-DIFFERENT" })),
    ).rejects.toThrow("Tool response does not match active request")
    expect(slots.has("chat-1")).toBe(true)
  })

  it("resolves an ask_user_question tool and updates active turn state", async () => {
    const slots = new PendingToolSlots()
    const resolve = mock((_v: AnyValue) => {})
    const appendMessage = mock(async (_chatId: string, _entry: unknown) => {})
    const emitStateChange = mock((_chatId: string) => {})
    const result: AnyValue = { answer: "yes" }

    parkTool(slots, "chat-1", askUserQuestionTool("tool-abc"), resolve)
    const active = makeActiveTurn({
      status: "waiting_for_user",
      waitStartedAt: 12345,
    })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(
      turns,
      slots,
      appendMessage,
      mock(async (_chatId: string, _provider: string, _token: string | null) => {}),
      emitStateChange,
    )

    await respondTool(deps, makeCommand({ result }))

    expect(appendMessage).toHaveBeenCalledTimes(1)
    const callArgs = appendMessage.mock.calls[0] as unknown as [
      string,
      { kind: string },
    ]
    expect(callArgs[1].kind).toBe("tool_result")

    expect(slots.has("chat-1")).toBe(false)
    expect(active.status).toBe("running")
    expect(active.waitStartedAt).toBeNull()

    expect(resolve).toHaveBeenCalledWith(result)
    expect(emitStateChange).toHaveBeenCalledWith("chat-1")
  })

  it("resolves a request parked with NO active turn (SDK self-wake)", async () => {
    const slots = new PendingToolSlots()
    const resolve = mock((_v: AnyValue) => {})
    const appendMessage = mock(async (_chatId: string, _entry: unknown) => {})
    const result: AnyValue = { answers: { q1: "option-a" } }

    parkTool(slots, "chat-1", askUserQuestionTool("tool-abc"), resolve)
    const deps = makeDeps(new Map(), slots, appendMessage)

    await respondTool(deps, makeCommand({ result }))

    expect(slots.has("chat-1")).toBe(false)
    expect(resolve).toHaveBeenCalledWith(result)
    expect(appendMessage).toHaveBeenCalledTimes(1)
  })

  it("clears session token and appends context_cleared when exit_plan_mode confirmed+clearContext", async () => {
    const slots = new PendingToolSlots()
    const resolve = mock((_v: AnyValue) => {})
    const appendMessage = mock(async (_chatId: string, _entry: unknown) => {})
    const setSessionTokenForProvider = mock(
      async (_chatId: string, _provider: string, _token: string | null) => {},
    )
    const emitStateChange = mock((_chatId: string) => {})

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc"), resolve)
    const active = makeActiveTurn({ provider: "claude" })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns, slots, appendMessage, setSessionTokenForProvider, emitStateChange)

    await respondTool(
      deps,
      makeCommand({
        result: { confirmed: true, clearContext: true, message: "" } as AnyValue,
      }),
    )

    expect(setSessionTokenForProvider).toHaveBeenCalledWith("chat-1", "claude", null)

    expect(appendMessage).toHaveBeenCalledTimes(2)
    const call2 = appendMessage.mock.calls[1] as unknown as [string, { kind: string }]
    expect(call2[1].kind).toBe("context_cleared")
  })

  it("does NOT clear context when confirmed=false even if clearContext=true", async () => {
    const slots = new PendingToolSlots()
    const resolve = mock((_v: AnyValue) => {})
    const appendMessage = mock(async (_chatId: string, _entry: unknown) => {})
    const setSessionTokenForProvider = mock(
      async (_chatId: string, _provider: string, _token: string | null) => {},
    )

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc"), resolve)
    const turns = new Map([["chat-1", makeActiveTurn({ provider: "claude" })]])
    const deps = makeDeps(turns, slots, appendMessage, setSessionTokenForProvider)

    await respondTool(
      deps,
      makeCommand({ result: { confirmed: false, clearContext: true } as AnyValue }),
    )

    expect(setSessionTokenForProvider).not.toHaveBeenCalled()
    expect(appendMessage).toHaveBeenCalledTimes(1)
  })

  it("sets postToolFollowUp on codex provider when exit_plan_mode confirmed", async () => {
    const slots = new PendingToolSlots()
    const resolve = mock((_v: AnyValue) => {})

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc"), resolve, "codex")
    const active = makeActiveTurn({ provider: "codex" })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns, slots)

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
    const slots = new PendingToolSlots()
    const resolve = mock((_v: AnyValue) => {})

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc"), resolve, "codex")
    const active = makeActiveTurn({ provider: "codex" })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns, slots)

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
    const slots = new PendingToolSlots()
    const resolve = mock((_v: AnyValue) => {})

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc"), resolve, "codex")
    const active = makeActiveTurn({ provider: "codex" })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns, slots)

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
