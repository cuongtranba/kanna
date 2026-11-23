import { isJsonObject, type JsonValue } from "../shared/json"
import { timestamped } from "../shared/transcript-entry"
import type { DynamicToolCallRequest, DynamicToolCallResponse, DynamicToolSpec, TurnPlanStep } from "./codex-app-server-protocol"
import { parsePlanSteps } from "./codex-plan-steps"
import { dynamicToolPayload, genericDynamicToolCall } from "./codex-tool-payloads"
import { todoToolCall } from "./codex-transcript-translator"
import type { HarnessEvent } from "./harness-types"

export interface KannaToolOutcome {
  text: string
  isError: boolean
}

export interface CodexKannaTools {
  specs: readonly DynamicToolSpec[]
  call(chatId: string, tool: string, args: JsonValue): Promise<KannaToolOutcome | null>
}

export interface DynamicToolTurn {
  handledDynamicToolIds: Set<string>
  latestPlanSteps: TurnPlanStep[]
  latestPlanExplanation: string | null
  queue: { push(event: HarnessEvent): void }
}

interface DynamicToolCallContext {
  request: DynamicToolCallRequest
  turn: DynamicToolTurn
  chatId: string
  isMainScope: boolean
  kannaTools: CodexKannaTools | undefined
}

function textResponse(text: string, success: boolean) {
  return { contentItems: [{ type: "inputText", text }], success } satisfies DynamicToolCallResponse
}

function pushToolResult(turn: DynamicToolTurn, toolId: string, content: string, isError: boolean): void {
  turn.queue.push({
    type: "transcript",
    entry: timestamped({ kind: "tool_result", toolId, content, ...(isError ? { isError: true } : {}) }),
  })
}

function answerPlanUpdate({ request, turn }: DynamicToolCallContext) {
  const rawArguments = request.params.arguments
  const plan = rawArguments !== undefined && isJsonObject(rawArguments) ? parsePlanSteps(rawArguments) : null
  if (plan !== null) {
    turn.latestPlanSteps = plan.steps
    turn.latestPlanExplanation = plan.explanation ?? turn.latestPlanExplanation
    turn.queue.push({ type: "transcript", entry: todoToolCall(request.params.callId, plan.steps) })
    pushToolResult(turn, request.params.callId, "", false)
  }
  return { contentItems: [], success: true } satisfies DynamicToolCallResponse
}

export async function answerDynamicToolCall(context: DynamicToolCallContext) {
  const { request, turn, chatId, isMainScope, kannaTools } = context
  const { callId, tool, arguments: args } = request.params
  turn.handledDynamicToolIds.add(callId)
  if (tool === "update_plan") return answerPlanUpdate(context)

  turn.queue.push({ type: "transcript", entry: genericDynamicToolCall(callId, tool, dynamicToolPayload(args)) })
  const outcome = isMainScope && kannaTools ? await kannaTools.call(chatId, tool, args ?? null) : null
  if (outcome === null) {
    const unsupported = `Unsupported dynamic tool call: ${tool}`
    pushToolResult(turn, callId, unsupported, true)
    return textResponse(unsupported, false)
  }
  pushToolResult(turn, callId, outcome.text, outcome.isError)
  return textResponse(outcome.text, !outcome.isError)
}
