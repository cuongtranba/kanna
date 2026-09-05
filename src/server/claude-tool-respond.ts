
import type { AgentProvider, TranscriptEntry } from "../shared/types"
import { isJsonObject, type JsonObject, type JsonValue } from "../shared/json"
import type { ActiveTurn } from "./claude-session-state"
import type { PendingToolSlots } from "./pending-tool-slot"
import { timestamped, normalizeToolContent } from "./claude-message-normalizer"


interface ToolRespondStore {
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  setSessionTokenForProvider(
    chatId: string,
    provider: AgentProvider,
    sessionToken: string | null,
  ): Promise<void>
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
}


export async function respondTool(
  deps: ToolRespondDeps,
  command: RespondToolCommand,
): Promise<void> {
  const { activeTurns, pendingTools, store, emitStateChange } = deps

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

  if (pending.tool.toolKind === "exit_plan_mode") {
    const resultRec: JsonObject = isJsonObject(command.result)
      ? command.result
      : {}
    const confirmed = Boolean(resultRec.confirmed)
    const clearContext = Boolean(resultRec.clearContext)
    const message =
      typeof resultRec.message === "string" ? resultRec.message : ""

    if (confirmed && clearContext) {
      await store.setSessionTokenForProvider(command.chatId, pending.provider, null)
      await store.appendMessage(
        command.chatId,
        timestamped({ kind: "context_cleared" }),
      )
    }

    if (pending.provider === "codex" && active) {
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
