import type { HydratedTranscriptMessage, KannaStatus } from "../../shared/types"
import type { ProcessedToolCall } from "../components/messages/types"
import { isLiveChatStatus } from "../lib/chatStatusIndicator"

function isProcessedToolCall(m: HydratedTranscriptMessage): m is ProcessedToolCall {
  return m.kind === "tool"
}

const SPECIAL_TOOL_NAMES = ["AskUserQuestion", "ExitPlanMode", "TodoWrite"] as const
const RESOLVED_TOOL_NAMES = new Set<string>(["TodoWrite"])

function findLatestUnresolvedToolId(messages: HydratedTranscriptMessage[], toolName: string): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isProcessedToolCall(message)) continue
    if (message.toolName === toolName && !message.result) {
      return message.id
    }
  }
  return null
}

function findLatestToolId(messages: HydratedTranscriptMessage[], toolName: string): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isProcessedToolCall(message)) continue
    if (message.toolName === toolName) {
      return message.id
    }
  }
  return null
}

export function getLatestToolIds(messages: HydratedTranscriptMessage[]) {
  const ids: Record<string, string | null> = {}
  for (const toolName of SPECIAL_TOOL_NAMES) {
    ids[toolName] = RESOLVED_TOOL_NAMES.has(toolName)
      ? findLatestToolId(messages, toolName)
      : findLatestUnresolvedToolId(messages, toolName)
  }
  return ids
}

/**
 * Returns true only when `chatId` matches the route chatId (`activeChatId`).
 *
 * Gate all route-affecting side effects (navigation bounce, setSelectedProjectId,
 * chat.markRead) behind this predicate so that background tabs — instances whose
 * own chatId differs from the current URL route — never yank the app to a
 * different route or steal push focus.
 *
 * In the current single-tab world both arguments are the same value, so the
 * predicate is always true for non-null chatIds (no behaviour change). Once
 * multiple `useKannaState` instances run in parallel (one per open tab), the
 * first argument becomes each instance's own chatId while the second remains the
 * route chatId, and only the primary instance passes the gate.
 */
export function isPrimaryChatInstance(chatId: string | null, activeChatId: string | null): boolean {
  return chatId !== null && chatId === activeChatId
}

/**
 * Narrows a wire-shaped status string to the union, so the predicates below can
 * delegate to `isLiveChatStatus` without a cast. It enumerates the status NAMES
 * (a parse), never which of them are live — that answer has exactly one home.
 */
function toKannaStatus(status: string | undefined): KannaStatus | null {
  switch (status) {
    case "idle":
    case "starting":
    case "running":
    case "waiting_for_user":
    case "failed":
      return status
    default:
      return null
  }
}

function isLiveStatusName(status?: string): boolean {
  const parsed = toKannaStatus(status)
  return parsed !== null && isLiveChatStatus(parsed)
}

export function canCancelStatus(status?: string) {
  return isLiveStatusName(status)
}

export function isProcessingStatus(status?: string) {
  return isLiveStatusName(status)
}
