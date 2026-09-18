import { isJsonObject, type JsonObject, type JsonValue } from "../json"
import type { NormalizedToolCall } from "../tool-call-types"
import {
  CHAT_TASK_EVENT_VERSION,
  nativeTaskId,
  type ChatTaskEvent,
  type ChatTaskNativeRow,
  type ChatTaskPatch,
} from "./types"

export const MIRRORED_NATIVE_TOOL_KINDS: readonly NormalizedToolCall["toolKind"][] = [
  "task_create",
  "task_update",
  "task_list",
]

export function isMirroredNativeToolKind(kind: NormalizedToolCall["toolKind"]): boolean {
  return MIRRORED_NATIVE_TOOL_KINDS.includes(kind)
}

export interface NativeMirrorInput {
  readonly chatId: string
  readonly timestamp: number
  readonly tool: NormalizedToolCall
  readonly raw: JsonValue
  readonly isError: boolean
  readonly toolUseId: string
  readonly originRunId: string | null
  readonly knownTaskIds: ReadonlySet<string>
}

function base(input: NativeMirrorInput): {
  v: typeof CHAT_TASK_EVENT_VERSION
  timestamp: number
  chatId: string
} {
  return { v: CHAT_TASK_EVENT_VERSION, timestamp: input.timestamp, chatId: input.chatId }
}

function readString(bag: JsonObject, key: string): string | null {
  const value = bag[key]
  return typeof value === "string" ? value : null
}

function readCreatedTask(raw: JsonValue): { id: string; subject: string } | null {
  if (!isJsonObject(raw)) return null
  const task = raw.task
  if (!isJsonObject(task)) return null
  const id = readString(task, "id")
  if (id === null || id.length === 0) return null
  return { id, subject: readString(task, "subject") ?? "" }
}

function readUpdateAck(raw: JsonValue): { success: boolean; taskId: string } | null {
  if (!isJsonObject(raw)) return null
  if (!("success" in raw)) return null
  return { success: raw.success !== false, taskId: readString(raw, "taskId") ?? "" }
}

function readListedRows(raw: JsonValue): ChatTaskNativeRow[] {
  if (!isJsonObject(raw)) return []
  const listed = raw.tasks
  if (!Array.isArray(listed)) return []
  const rows: ChatTaskNativeRow[] = []
  for (const entry of listed) {
    if (!isJsonObject(entry)) continue
    const nativeId = readString(entry, "id")
    if (nativeId === null || nativeId.length === 0) continue
    const status = readString(entry, "status")
    rows.push({
      nativeId,
      subject: readString(entry, "subject") ?? "",
      status: status === "in_progress" || status === "completed" ? status : "pending",
    })
  }
  return rows
}

function mirrorCreate(input: NativeMirrorInput): readonly ChatTaskEvent[] {
  if (input.tool.toolKind !== "task_create") return []
  const created = readCreatedTask(input.raw)
  if (!created) return []
  const taskId = nativeTaskId(created.id)
  if (input.knownTaskIds.has(taskId)) return []
  const subject = input.tool.input.subject.length > 0 ? input.tool.input.subject : created.subject
  return [{
    ...base(input),
    type: "chat_task_created",
    taskId,
    subject,
    source: "native",
    sourceToolUseId: input.toolUseId,
    ...(input.tool.input.activeForm ? { activeForm: input.tool.input.activeForm } : {}),
    ...(input.tool.input.description ? { description: input.tool.input.description } : {}),
    ...(input.originRunId !== null ? { originRunId: input.originRunId } : {}),
  }]
}

function mirrorUpdate(input: NativeMirrorInput): readonly ChatTaskEvent[] {
  if (input.tool.toolKind !== "task_update") return []
  const ack = readUpdateAck(input.raw)
  if (ack && !ack.success) return []
  const rawId = input.tool.input.taskId.length > 0 ? input.tool.input.taskId : (ack?.taskId ?? "")
  if (rawId.length === 0) return []
  const taskId = nativeTaskId(rawId)

  if (input.tool.input.status === "deleted") {
    return [{ ...base(input), type: "chat_task_deleted", taskId, sourceToolUseId: input.toolUseId }]
  }

  const patch: ChatTaskPatch = {
    ...(input.tool.input.subject !== undefined ? { subject: input.tool.input.subject } : {}),
    ...(input.tool.input.activeForm !== undefined ? { activeForm: input.tool.input.activeForm } : {}),
    ...(input.tool.input.status !== undefined ? { status: input.tool.input.status } : {}),
  }

  if (!input.knownTaskIds.has(taskId)) {
    return [{
      ...base(input),
      type: "chat_task_created",
      taskId,
      subject: input.tool.input.subject ?? rawId,
      source: "native",
      sourceToolUseId: input.toolUseId,
      ...(input.tool.input.activeForm ? { activeForm: input.tool.input.activeForm } : {}),
      ...(input.originRunId !== null ? { originRunId: input.originRunId } : {}),
    }, {
      ...base(input),
      type: "chat_task_updated",
      taskId,
      patch,
      sourceToolUseId: input.toolUseId,
    }]
  }

  return [{ ...base(input), type: "chat_task_updated", taskId, patch, sourceToolUseId: input.toolUseId }]
}

function mirrorList(input: NativeMirrorInput): readonly ChatTaskEvent[] {
  if (input.tool.toolKind !== "task_list") return []
  const rows = readListedRows(input.raw)
  if (rows.length === 0) return []
  return [{
    ...base(input),
    type: "chat_task_native_synced",
    rows,
    sourceToolUseId: input.toolUseId,
  }]
}

export function mirrorNativeTaskCall(input: NativeMirrorInput): readonly ChatTaskEvent[] {
  if (input.isError) return []
  switch (input.tool.toolKind) {
    case "task_create": return mirrorCreate(input)
    case "task_update": return mirrorUpdate(input)
    case "task_list": return mirrorList(input)
    default: return []
  }
}
