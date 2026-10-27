import {
  CLAUDE_ASK_USER_QUESTION_TOOL_NAME,
  CLAUDE_EXIT_PLAN_MODE_TOOL_NAME,
  CLAUDE_TODO_WRITE_TOOL_NAME,
} from "../../shared/tools"
import type { HydratedTranscriptMessage, HydratedToolCall } from "../../shared/types"

function isProcessedToolCall(m: HydratedTranscriptMessage): m is HydratedToolCall {
  return m.kind === "tool"
}

export const SPECIAL_TRANSCRIPT_TOOL_NAMES = {
  askUserQuestion: CLAUDE_ASK_USER_QUESTION_TOOL_NAME,
  exitPlanMode: CLAUDE_EXIT_PLAN_MODE_TOOL_NAME,
  todoWrite: CLAUDE_TODO_WRITE_TOOL_NAME,
} as const

export interface LatestToolIds {
  askUserQuestion: string | null
  exitPlanMode: string | null
  todoWrite: string | null
}

export const NO_LATEST_TOOL_IDS: LatestToolIds = {
  askUserQuestion: null,
  exitPlanMode: null,
  todoWrite: null,
}

function findLatestToolId(
  messages: HydratedTranscriptMessage[],
  toolName: string,
  includeResolved: boolean,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isProcessedToolCall(message)) continue
    if (message.toolName === toolName && (includeResolved || !message.result)) {
      return message.id
    }
  }
  return null
}

export function getLatestToolIds(messages: HydratedTranscriptMessage[]): LatestToolIds {
  return {
    askUserQuestion: findLatestToolId(messages, SPECIAL_TRANSCRIPT_TOOL_NAMES.askUserQuestion, false),
    exitPlanMode: findLatestToolId(messages, SPECIAL_TRANSCRIPT_TOOL_NAMES.exitPlanMode, false),
    todoWrite: findLatestToolId(messages, SPECIAL_TRANSCRIPT_TOOL_NAMES.todoWrite, true),
  }
}

export function isPrimaryChatInstance(chatId: string | null, activeChatId: string | null): boolean {
  return chatId !== null && chatId === activeChatId
}

export function canCancelStatus(status?: string) {
  return status === "starting" || status === "running" || status === "waiting_for_user"
}

export function isProcessingStatus(status?: string) {
  return status === "starting" || status === "running" || status === "waiting_for_user"
}
