import type { JsonObject, JsonValue } from "../../shared/json"
import type { FollowResult } from "./send-and-wait"
import { WAITING_FOR_USER } from "./send-and-wait"
import { toJsonValue } from "../json-boundary"

export const DEFAULT_WAIT_SECONDS = 45
export const MAX_WAIT_SECONDS = 600
export const SILENT_WAIT_CAP_SECONDS = 100

export interface WaitChannel {
  era: "legacy" | "modern"
  streaming: boolean
}

export interface WaitClamp {
  requestedSeconds: number
  appliedSeconds: number
  reason: string
}

export interface WaitLimit {
  seconds: number
  clamp?: WaitClamp
}

export function resolveWaitLimit(requestedSeconds: number | undefined, channel: WaitChannel): WaitLimit {
  const requested = Math.min(requestedSeconds ?? DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS)
  const keepsConnectionAlive = channel.era === "legacy" || channel.streaming
  const ceiling = keepsConnectionAlive ? MAX_WAIT_SECONDS : SILENT_WAIT_CAP_SECONDS
  if (requested <= ceiling) return { seconds: requested }
  return {
    seconds: ceiling,
    clamp: {
      requestedSeconds: requested,
      appliedSeconds: ceiling,
      reason: "This connection cannot stream progress, so one call may wait at most this long before the proxy closes it. Call wait_for_chat again to keep following.",
    },
  }
}

export type DuplicateVia = "idempotencyKey" | "fingerprint"

function nextStep(result: FollowResult, duplicateVia: DuplicateVia | null): string {
  const follow = `Call wait_for_chat with chatId "${result.chatId}" and cursor ${result.cursor}`
  const duplicate = duplicateVia === null
    ? ""
    : "Kanna is already working on this exact request (duplicate suppressed; no new work was started). "
  if (result.stalledQueue) {
    return `${duplicate}The previous turn ended (status ${result.status ?? "unknown"}) and Kanna has not started your queued message, so it will not run by itself. Remove it with kanna_command message.dequeue (chatId "${result.chatId}", queuedMessageId "${result.queuedMessageId ?? ""}"), then call send_message once more if you still want it run.`
  }
  if (result.queued) {
    return `${duplicate}The message is queued behind a running turn and has not started. Do NOT send it again — that queues a duplicate. ${follow} to keep following, or cancel_chat to stop the running turn.`
  }
  if (result.status === WAITING_FOR_USER) {
    return `${duplicate}The chat is waiting for input. Call list_pending_tool_requests, answer with answer_tool_request (kind tool_request) or respond_tool (kind interactive_tool), then ${follow.toLowerCase()} to continue.`
  }
  if (!result.done) {
    return `${duplicate}Kanna is still working on this turn. Do NOT call send_message again for this request — that starts duplicate work. ${follow} to keep following it, or cancel_chat to stop it.`
  }
  if (result.status === "failed") {
    return `${duplicate}The turn ended with status failed. Read activity or get_chat for the reason. Send a new message to chatId "${result.chatId}" only if you want to retry.`
  }
  return `${duplicate}The turn is finished and assistantText holds the reply. Reply to the user, or continue the conversation with send_message using chatId "${result.chatId}".`
}

export function followReport(result: FollowResult, extras: { duplicateVia?: DuplicateVia | null; clamp?: WaitClamp } = {}): JsonObject {
  const duplicateVia = extras.duplicateVia ?? null
  const report: Record<string, JsonValue> = {
    chatId: result.chatId,
    status: result.status ?? null,
    busy: result.busy,
    done: result.done,
    ...(result.queuedMessageId ? { queued: result.queued, queuedMessageId: result.queuedMessageId } : {}),
    assistantText: result.assistantText,
    activity: toJsonValue(result.activity),
    pendingToolRequests: toJsonValue(result.pendingToolRequests),
    cursor: result.cursor,
    timedOut: result.timedOut,
    waitedSeconds: Math.round(result.waitedMs / 100) / 10,
    ...(duplicateVia === null ? {} : { duplicate: true, duplicateOf: result.chatId, duplicateVia }),
    ...(extras.clamp ? { timeoutClamp: toJsonValue(extras.clamp) } : {}),
    next: nextStep(result, duplicateVia),
  }
  return report
}
