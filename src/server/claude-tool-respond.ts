
import type { TranscriptEntry } from "../shared/types"
import type { JsonValue } from "../shared/json"
import { providerUsesSdkSession } from "../shared/provider-model-types"
import { readPlanDecision } from "./claude-spawn-helpers"
import type { ActiveTurn } from "./claude-session-state"
import { discardedToolResult, type PendingToolSlots } from "./pending-tool-slot"
import { normalizeToolContent } from "./claude-message-normalizer"
import { timestamped } from "../shared/transcript-entry"


interface ToolRespondStore {
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
}

interface ToolRespondActiveTurnsMap {
  get(chatId: string): ActiveTurn | undefined
}


export interface RespondToolCommand {
  type: "chat.respondTool"
  chatId: string
  toolUseId: string
  result: JsonValue
}


export interface ToolRespondDeps {
  activeTurns: ToolRespondActiveTurnsMap

  pendingTools: PendingToolSlots

  store: ToolRespondStore

  emitStateChange(chatId: string): void

  cancel(chatId: string, options: { hideInterrupted: boolean }): Promise<void>

  clearChatContext(chatId: string): Promise<void>

  startApprovedPlanTurn(chatId: string, prompt: string): Promise<void>
}

function approvedPlanPrompt(plan: string, message: string): string {
  const prompt = `Implement the following approved plan.\n\n${plan}`
  return message ? `${prompt}\n\nAdditional guidance: ${message}` : prompt
}

export async function respondTool(
  deps: ToolRespondDeps,
  command: RespondToolCommand,
): Promise<void> {
  const {
    activeTurns,
    pendingTools,
    store,
    emitStateChange,
    cancel,
    clearChatContext,
    startApprovedPlanTurn,
  } = deps

  if (!pendingTools.has(command.chatId)) {
    throw new Error("No pending tool request")
  }
  const pending = pendingTools.take(command.chatId, command.toolUseId)
  if (!pending) {
    throw new Error("Tool response does not match active request")
  }

  await store.appendMessage(
    command.chatId,
    timestamped({
      kind: "tool_result",
      toolId: command.toolUseId,
      content: normalizeToolContent(command.result),
    }),
  )

  const active = activeTurns.get(command.chatId)
  if (active) {
    active.status = "running"
    active.waitStartedAt = null
  }

  const tool = pending.tool
  if (tool.toolKind === "exit_plan_mode") {
    const { confirmed, clearContext, message = "" } = readPlanDecision(command.result)
    const plan = tool.input.plan?.trim()

    if (confirmed && clearContext && plan) {
      pending.resolve(discardedToolResult(tool))
      await cancel(command.chatId, { hideInterrupted: true })
      if (activeTurns.get(command.chatId)) {
        throw new Error("Chat is still running")
      }
      await clearChatContext(command.chatId)
      await startApprovedPlanTurn(command.chatId, approvedPlanPrompt(plan, message))
      emitStateChange(command.chatId)
      return
    }

    if (!providerUsesSdkSession(pending.provider) && active) {
      active.postToolFollowUp = confirmed
        ? {
            content: message
              ? `Proceed with the approved plan. Additional guidance: ${message}`
              : "Proceed with the approved plan.",
            planMode: false,
          }
        : {
            content: message
              ? `Revise the plan using this feedback: ${message}`
              : "Revise the plan using this feedback.",
            planMode: true,
          }
    }
  }

  pending.resolve(command.result)

  emitStateChange(command.chatId)
}
