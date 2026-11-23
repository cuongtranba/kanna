import { describe, it, expect, vi } from "vite-plus/test"
import {
  respondTool,
  type RespondToolCommand,
  type ToolRespondDeps,
} from "./claude-tool-respond"
import type { ActiveTurn } from "./claude-session-state"
import { PendingToolSlots, type ParkedTool } from "./pending-tool-slot"
import type { JsonValue } from "../shared/json"
import type { AgentProvider, AskUserQuestionToolCall, ExitPlanModeToolCall } from "../shared/types"


function askUserQuestionTool(toolId: string): AskUserQuestionToolCall {
  return {
    kind: "tool",
    toolKind: "ask_user_question",
    toolName: "ask_user_question",
    toolId,
    input: { questions: [] },
  }
}

function exitPlanModeTool(toolId: string, plan?: string): ExitPlanModeToolCall {
  return {
    kind: "tool",
    toolKind: "exit_plan_mode",
    toolName: "exit_plan_mode",
    toolId,
    input: plan === undefined ? {} : { plan },
  }
}


function makeActiveTurn(overrides: Partial<ActiveTurn> = {}): ActiveTurn {
  return {
    chatId: "chat-1",
    provider: "claude",
    turn: {} as ActiveTurn["turn"],
    startedAt: Date.now(),
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

function makeDeps(
  activeTurns: Map<string, ActiveTurn>,
  pendingTools: PendingToolSlots,
  appendMessage = vi.fn(async (_chatId: string, _entry: unknown) => {}),
  emitStateChange = vi.fn((_chatId: string) => {}),
  overrides: Partial<ToolRespondDeps> = {},
): ToolRespondDeps {
  return {
    activeTurns,
    pendingTools,
    store: {
      appendMessage: appendMessage as unknown as AppendMessageFn,
    },
    emitStateChange,
    cancel: async () => {},
    clearChatContext: async () => {},
    startApprovedPlanTurn: async () => {},
    ...overrides,
  }
}

function makeCommand(
  overrides: Partial<RespondToolCommand> = {},
): RespondToolCommand {
  return {
    type: "chat.respondTool",
    chatId: "chat-1",
    toolUseId: "tool-abc",
    result: { confirmed: true },
    ...overrides,
  }
}

function parkTool(
  slots: PendingToolSlots,
  chatId: string,
  tool: ParkedTool["tool"],
  resolve: (v: JsonValue) => void,
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
    const resolve = vi.fn((_v: JsonValue) => {})
    parkTool(slots, "chat-1", askUserQuestionTool("tool-xyz"), resolve)
    const deps = makeDeps(new Map([["chat-1", makeActiveTurn()]]), slots)

    await expect(
      respondTool(deps, makeCommand({ toolUseId: "tool-DIFFERENT" })),
    ).rejects.toThrow("Tool response does not match active request")
    expect(slots.has("chat-1")).toBe(true)
  })

  it("resolves an ask_user_question tool and updates active turn state", async () => {
    const slots = new PendingToolSlots()
    const resolve = vi.fn((_v: JsonValue) => {})
    const appendMessage = vi.fn(async (_chatId: string, _entry: unknown) => {})
    const emitStateChange = vi.fn((_chatId: string) => {})
    const result: JsonValue = { answer: "yes" }

    parkTool(slots, "chat-1", askUserQuestionTool("tool-abc"), resolve)
    const active = makeActiveTurn({
      status: "waiting_for_user",
      waitStartedAt: 12345,
    })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns, slots, appendMessage, emitStateChange)

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
    const resolve = vi.fn((_v: JsonValue) => {})
    const appendMessage = vi.fn(async (_chatId: string, _entry: unknown) => {})
    const result: JsonValue = { answers: { q1: "option-a" } }

    parkTool(slots, "chat-1", askUserQuestionTool("tool-abc"), resolve)
    const deps = makeDeps(new Map(), slots, appendMessage)

    await respondTool(deps, makeCommand({ result }))

    expect(slots.has("chat-1")).toBe(false)
    expect(resolve).toHaveBeenCalledWith(result)
    expect(appendMessage).toHaveBeenCalledTimes(1)
  })

  it("ends the turn, clears context, then starts a fresh turn with the plan when exit_plan_mode is approved with clearContext", async () => {
    const slots = new PendingToolSlots()
    const resolved: JsonValue[] = []
    const calls: string[] = []
    const prompts: string[] = []

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc", "## Plan\n\n- ship"), (v) => resolved.push(v))
    const active = makeActiveTurn({ provider: "codex" })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns, slots, undefined, undefined, {
      cancel: async (chatId) => {
        calls.push("cancel")
        turns.delete(chatId)
      },
      clearChatContext: async () => { calls.push("clear") },
      startApprovedPlanTurn: async (_chatId, prompt) => {
        calls.push("start")
        prompts.push(prompt)
      },
    })

    await respondTool(
      deps,
      makeCommand({ result: { confirmed: true, clearContext: true, message: "go fast" } }),
    )

    expect(calls).toEqual(["cancel", "clear", "start"])
    expect(prompts).toEqual([
      "Implement the following approved plan.\n\n## Plan\n\n- ship\n\nAdditional guidance: go fast",
    ])
    expect(resolved).toEqual([{ discarded: true }])
    expect(active.postToolFollowUp).toBeNull()
  })

  it("approves without clearing when clearContext is requested but the plan text is missing", async () => {
    const slots = new PendingToolSlots()
    const resolved: JsonValue[] = []
    const calls: string[] = []

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc"), (v) => resolved.push(v))
    const deps = makeDeps(new Map([["chat-1", makeActiveTurn()]]), slots, undefined, undefined, {
      cancel: async () => { calls.push("cancel") },
      clearChatContext: async () => { calls.push("clear") },
      startApprovedPlanTurn: async () => { calls.push("start") },
    })

    const result: JsonValue = { confirmed: true, clearContext: true }
    await respondTool(deps, makeCommand({ result }))

    expect(calls).toEqual([])
    expect(resolved).toEqual([result])
  })

  it("does NOT clear context when confirmed=false even if clearContext=true", async () => {
    const slots = new PendingToolSlots()
    const resolve = vi.fn((_v: JsonValue) => {})
    const calls: string[] = []

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc", "plan"), resolve)
    const turns = new Map([["chat-1", makeActiveTurn({ provider: "claude" })]])
    const deps = makeDeps(turns, slots, undefined, undefined, {
      cancel: async () => { calls.push("cancel") },
      clearChatContext: async () => { calls.push("clear") },
      startApprovedPlanTurn: async () => { calls.push("start") },
    })

    await respondTool(
      deps,
      makeCommand({ result: { confirmed: false, clearContext: true } }),
    )

    expect(calls).toEqual([])
  })

  it("sets postToolFollowUp on codex provider when exit_plan_mode confirmed", async () => {
    const slots = new PendingToolSlots()
    const resolve = vi.fn((_v: JsonValue) => {})

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc"), resolve, "codex")
    const active = makeActiveTurn({ provider: "codex" })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns, slots)

    await respondTool(
      deps,
      makeCommand({
        result: { confirmed: true, clearContext: false, message: "great plan" },
      }),
    )

    expect(active.postToolFollowUp).toEqual({
      content: "Proceed with the approved plan. Additional guidance: great plan",
      planMode: false,
    })
  })

  it("sets postToolFollowUp on codex provider when exit_plan_mode rejected", async () => {
    const slots = new PendingToolSlots()
    const resolve = vi.fn((_v: JsonValue) => {})

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc"), resolve, "codex")
    const active = makeActiveTurn({ provider: "codex" })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns, slots)

    await respondTool(
      deps,
      makeCommand({
        result: { confirmed: false, clearContext: false, message: "needs work" },
      }),
    )

    expect(active.postToolFollowUp).toEqual({
      content: "Revise the plan using this feedback: needs work",
      planMode: true,
    })
  })

  it("continues an approved antigravity plan with a follow-up turn", async () => {
    const slots = new PendingToolSlots()

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc"), () => {}, "antigravity")
    const active = makeActiveTurn({ provider: "antigravity" })
    const deps = makeDeps(new Map([["chat-1", active]]), slots)

    await respondTool(deps, makeCommand({ result: { confirmed: true, clearContext: false } }))

    expect(active.postToolFollowUp).toEqual({ content: "Proceed with the approved plan.", planMode: false })
  })

  it("uses default messages when message field is empty", async () => {
    const slots = new PendingToolSlots()
    const resolve = vi.fn((_v: JsonValue) => {})

    parkTool(slots, "chat-1", exitPlanModeTool("tool-abc"), resolve, "codex")
    const active = makeActiveTurn({ provider: "codex" })
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps(turns, slots)

    await respondTool(
      deps,
      makeCommand({
        result: { confirmed: true, clearContext: false, message: "" },
      }),
    )

    expect(active.postToolFollowUp).toEqual({
      content: "Proceed with the approved plan.",
      planMode: false,
    })
  })
})
