export const CHAT_TASK_EVENT_VERSION = 3

export const KANNA_TASK_ID_PREFIX = "k:"
export const NATIVE_TASK_ID_PREFIX = "n:"

export const MAX_CHAT_TASKS_PER_CHAT = 200
export const MAX_CHAT_TASK_NOTES = 200
export const MAX_CHAT_TASK_SUBJECT_CHARS = 200
export const MAX_CHAT_TASK_NOTE_CHARS = 1_000

export type ChatTaskStatus = "pending" | "in_progress" | "completed"
export type ChatTaskSource = "kanna" | "native"
export type ChatTaskNoteKind = "progress" | "failed_approach" | "decision"
export type ChatTaskSettleOutcome = "done" | "release" | "reclaimed"
export type ChatTaskSettleReason = "dead_run" | "boot" | "grace" | "worker"

export interface ChatTaskNote {
  readonly id: string
  readonly taskId: string | null
  readonly noteKind: ChatTaskNoteKind
  readonly text: string
  readonly originRunId: string | null
  readonly createdAt: number
}

export interface ChatTaskRecord {
  readonly id: string
  readonly subject: string
  readonly activeForm: string | null
  readonly description: string | null
  readonly status: ChatTaskStatus
  readonly source: ChatTaskSource
  readonly needs: readonly string[]
  readonly worktree: string | null
  readonly branch: string | null
  readonly integrated: boolean
  readonly claimId: string | null
  readonly claimedAt: number | null
  readonly runId: string | null
  readonly epoch: number
  readonly originRunId: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly completedAt: number | null
}

export interface ChatTaskPatch {
  readonly subject?: string
  readonly activeForm?: string | null
  readonly description?: string | null
  readonly status?: ChatTaskStatus
  readonly needs?: readonly string[]
  readonly worktree?: string | null
  readonly branch?: string | null
}

export interface ChatTaskNativeRow {
  readonly nativeId: string
  readonly subject: string
  readonly status: ChatTaskStatus
}

interface ChatTaskEventBase {
  readonly v: typeof CHAT_TASK_EVENT_VERSION
  readonly timestamp: number
  readonly chatId: string
}

export type ChatTaskEvent =
  | (ChatTaskEventBase & {
    readonly type: "chat_task_created"
    readonly taskId: string
    readonly subject: string
    readonly activeForm?: string
    readonly description?: string
    readonly source: ChatTaskSource
    readonly needs?: readonly string[]
    readonly worktree?: string | null
    readonly branch?: string | null
    readonly originRunId?: string | null
    readonly sourceToolUseId?: string
  })
  | (ChatTaskEventBase & {
    readonly type: "chat_task_updated"
    readonly taskId: string
    readonly patch: ChatTaskPatch
    readonly originRunId?: string | null
    readonly sourceToolUseId?: string
  })
  | (ChatTaskEventBase & {
    readonly type: "chat_task_deleted"
    readonly taskId: string
    readonly sourceToolUseId?: string
  })
  | (ChatTaskEventBase & {
    readonly type: "chat_task_claimed"
    readonly taskId: string
    readonly claimId: string
    readonly originRunId?: string | null
  })
  | (ChatTaskEventBase & {
    readonly type: "chat_task_run_bound"
    readonly taskId: string
    readonly claimId: string
    readonly runId: string
  })
  | (ChatTaskEventBase & {
    readonly type: "chat_task_settled"
    readonly taskId: string
    readonly claimId: string
    readonly outcome: ChatTaskSettleOutcome
    readonly reason?: ChatTaskSettleReason
  })
  | (ChatTaskEventBase & {
    readonly type: "chat_task_integrated"
    readonly taskId: string
  })
  | (ChatTaskEventBase & {
    readonly type: "chat_task_note"
    readonly noteId: string
    readonly taskId: string | null
    readonly noteKind: ChatTaskNoteKind
    readonly text: string
    readonly originRunId?: string | null
  })
  | (ChatTaskEventBase & {
    readonly type: "chat_task_epoch_advanced"
    readonly epoch: number
  })
  | (ChatTaskEventBase & {
    readonly type: "chat_task_native_synced"
    readonly rows: readonly ChatTaskNativeRow[]
    readonly scope?: string
    readonly sourceToolUseId?: string
  })

export type ChatTaskEventType = ChatTaskEvent["type"]

export const CHAT_TASK_EVENT_TYPES: readonly ChatTaskEventType[] = [
  "chat_task_created",
  "chat_task_updated",
  "chat_task_deleted",
  "chat_task_claimed",
  "chat_task_run_bound",
  "chat_task_settled",
  "chat_task_integrated",
  "chat_task_note",
  "chat_task_epoch_advanced",
  "chat_task_native_synced",
]

export function isNativeTaskId(taskId: string): boolean {
  return taskId.startsWith(NATIVE_TASK_ID_PREFIX)
}

export function nativeTaskId(nativeId: string, scope: string | null = null): string {
  return scope === null
    ? `${NATIVE_TASK_ID_PREFIX}${nativeId}`
    : `${NATIVE_TASK_ID_PREFIX}${scope}:${nativeId}`
}

export function nativeTaskScope(taskId: string): string | null {
  const nativeId = taskId.slice(NATIVE_TASK_ID_PREFIX.length)
  const separator = nativeId.lastIndexOf(":")
  return separator === -1 ? null : nativeId.slice(0, separator)
}

export function kannaTaskId(seed: string): string {
  return `${KANNA_TASK_ID_PREFIX}${seed}`
}
