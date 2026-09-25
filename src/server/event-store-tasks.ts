import { compactChatTaskEvents } from "../shared/chat-tasks/compact"
import {
  isMirroredNativeToolKind,
  mirrorNativeTaskCall,
} from "../shared/chat-tasks/native-mirror"
import { deriveChatTasks, type ChatTaskProjection } from "../shared/chat-tasks/read-model"
import type { ChatTaskScheduleContext } from "../shared/chat-tasks/schedule"
import { CHAT_TASK_EVENT_VERSION, type ChatTaskEvent } from "../shared/chat-tasks/types"
import { isJsonObject, type JsonValue } from "../shared/json"
import type { NormalizedToolCall } from "../shared/tool-call-types"
import type { TranscriptEntry } from "../shared/types"

const MAX_PENDING_NATIVE_TASK_CALLS = 64

export function applyChatTaskEvent(
  chatTasksByChatId: Map<string, ChatTaskEvent[]>,
  event: ChatTaskEvent,
): void {
  const existing = chatTasksByChatId.get(event.chatId) ?? []
  existing.push(event)
  chatTasksByChatId.set(event.chatId, compactChatTaskEvents(existing))
}

export function projectChatTasks(
  chatTasksByChatId: Map<string, ChatTaskEvent[]>,
  chatId: string,
  ctx: ChatTaskScheduleContext,
): ChatTaskProjection {
  return deriveChatTasks(chatTasksByChatId.get(chatId) ?? [], ctx)
}

export type PendingNativeTaskCalls = Map<string, NormalizedToolCall>

function rememberPendingCall(pending: PendingNativeTaskCalls, tool: NormalizedToolCall): void {
  pending.set(tool.toolId, tool)
  while (pending.size > MAX_PENDING_NATIVE_TASK_CALLS) {
    const oldest = pending.keys().next()
    if (oldest.done === true) break
    pending.delete(oldest.value)
  }
}

interface NativeResultFrame {
  readonly raw: JsonValue
  readonly scope: string | null
}

function parseDebugRaw(debugRaw: string | undefined): JsonValue {
  if (debugRaw === undefined) return null
  try {
    const parsed: JsonValue = JSON.parse(debugRaw)
    return parsed
  } catch {
    return null
  }
}

function nativeResultFrameOf(entry: Extract<TranscriptEntry, { kind: "tool_result" }>): NativeResultFrame {
  const frame = parseDebugRaw(entry.debugRaw)
  if (!isJsonObject(frame)) return { raw: entry.content ?? null, scope: null }
  const parent = frame.parent_tool_use_id
  return {
    raw: frame.tool_use_result !== undefined ? frame.tool_use_result : (entry.content ?? null),
    scope: typeof parent === "string" && parent.length > 0 ? parent : null,
  }
}

export interface MirrorTranscriptEntryArgs {
  readonly pending: PendingNativeTaskCalls
  readonly chatTasksByChatId: Map<string, ChatTaskEvent[]>
  readonly chatId: string
  readonly entry: TranscriptEntry
  readonly now: number
}

export function mirrorTranscriptEntry(args: MirrorTranscriptEntryArgs): readonly ChatTaskEvent[] {
  const { entry } = args

  if (entry.kind === "context_cleared") {
    const events = args.chatTasksByChatId.get(args.chatId) ?? []
    if (events.length === 0) return []
    const current = deriveChatTasks(events, { now: args.now })
    return [{
      v: CHAT_TASK_EVENT_VERSION,
      timestamp: args.now,
      chatId: args.chatId,
      type: "chat_task_epoch_advanced",
      epoch: current.epoch + 1,
    }]
  }

  if (entry.kind === "tool_call") {
    if (isMirroredNativeToolKind(entry.tool.toolKind)) rememberPendingCall(args.pending, entry.tool)
    return []
  }

  if (entry.kind !== "tool_result") return []
  const tool = args.pending.get(entry.toolId)
  if (!tool) return []
  args.pending.delete(entry.toolId)

  const projection = projectChatTasks(args.chatTasksByChatId, args.chatId, { now: args.now })
  const frame = nativeResultFrameOf(entry)
  return mirrorNativeTaskCall({
    chatId: args.chatId,
    timestamp: args.now,
    tool,
    raw: frame.raw,
    isError: entry.isError === true,
    toolUseId: entry.toolId,
    originRunId: null,
    scope: frame.scope,
    knownTaskIds: new Set(projection.tasks.map((task) => task.id)),
  })
}
