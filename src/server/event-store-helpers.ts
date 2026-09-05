import type { JsonObject } from "../shared/json"
import { log } from "../shared/log"
import type { ChatHistorySnapshot, TranscriptEntry } from "../shared/types"
import { cloneTranscriptEntries } from "./events"
import type { StoreEvent } from "./events"

export interface TranscriptPageResult {
  entries: TranscriptEntry[]
  hasOlder: boolean
  olderCursor: string | null
}

export const RECENT_PAGE_BYTE_BUDGET = 1024 * 1024

export const MIN_RECENT_PAGE_ENTRIES = 10

export function fitLimitToByteBudget(
  entries: readonly TranscriptEntry[],
  limit: number,
  byteBudget: number = RECENT_PAGE_BYTE_BUDGET,
  minEntries: number = MIN_RECENT_PAGE_ENTRIES,
): number {
  if (limit <= 0 || entries.length === 0 || byteBudget <= 0) return limit

  const windowSize = Math.min(limit, entries.length)
  const floor = Math.min(minEntries, windowSize)
  let used = 0
  let kept = 0

  for (let index = entries.length - 1; index >= entries.length - windowSize; index -= 1) {
    const entry = entries[index]
    if (entry === undefined) break
    const size = JSON.stringify(entry).length
    if (kept >= floor && used + size > byteBudget) break
    used += size
    kept += 1
  }

  return kept
}

export function normalizeSidebarProjectOrder<T>(value: T): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const projectIds: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") continue
    const projectId = entry.trim()
    if (!projectId || seen.has(projectId)) continue
    seen.add(projectId)
    projectIds.push(projectId)
  }

  return projectIds
}

export function isSendToStartingProfilingEnabled(): boolean {
  return process.env.KANNA_PROFILE_SEND_TO_STARTING === "1"
}

export function logSendToStartingProfile(stage: string, details?: JsonObject): void {
  if (!isSendToStartingProfilingEnabled()) {
    return
  }

  log.info("[kanna/send->starting][server]", JSON.stringify({
    stage,
    ...details,
  }))
}

const RETIRED_EVENT_TYPES = new Set<string>(["session_commands_loaded"])

export const UNKNOWN_EVENT_PRIORITY = 99

export function getReplayEventPriority(event: StoreEvent): number {
  const discriminator = "type" in event ? event.type : event.kind
  if (RETIRED_EVENT_TYPES.has(discriminator)) return 6
  switch (discriminator) {
    case "project_opened":
    case "project_removed":
    case "sidebar_project_order_set":
    case "project_star_set":
    case "project_instructions_set":
      return 0
    case "chat_created":
      return 1
    case "chat_renamed":
    case "chat_provider_set":
    case "chat_plan_mode_set":
      return 2
    case "message_appended":
      return 3
    case "queued_message_enqueued":
    case "queued_message_removed":
      return 4
    case "turn_started":
      return 5
    case "session_token_set":
      return 6
    case "pending_fork_session_token_set":
      return 6
    case "turn_cancelled":
      return 7
    case "turn_finished":
    case "turn_failed":
      return 8
    case "chat_read_state_set":
    case "chat_source_hash_set":
    case "chat_policy_override_set":
    case "chat_compact_failures_set":
      return 9
    case "chat_deleted":
    case "chat_archived":
    case "chat_unarchived":
      return 10
    case "auto_continue_proposed":
    case "auto_continue_accepted":
    case "auto_continue_rescheduled":
    case "auto_continue_cancelled":
    case "auto_continue_fired":
    case "loop_armed":
    case "loop_disarmed":
    case "loop_run_outcome":
    case "cron_armed":
    case "cron_disarmed":
    case "cron_paused":
    case "cron_resumed":
    case "cron_run_started":
    case "cron_run_outcome":
    case "cron_run_skipped":
      return 11
    case "stack_added":
    case "stack_removed":
    case "stack_renamed":
    case "stack_project_added":
    case "stack_project_removed":
    case "stack_instructions_set":
      return 0
    case "subagent_run_started":
    case "subagent_message_delta":
    case "subagent_entry_appended":
    case "subagent_run_completed":
    case "subagent_run_failed":
    case "subagent_run_cancelled":
    case "subagent_tool_pending":
    case "subagent_tool_resolved":
      return 5
    case "tool_request_put":
      return 5
    case "tool_request_resolved":
      return 6
    default: {
      const _exhaustive: never = discriminator
      log.warn(
        "[kanna/event-store] Skipping unknown replay event type (written by a different version):",
        String(_exhaustive),
      )
      return UNKNOWN_EVENT_PRIORITY
    }
  }
}

export function encodeHistoryCursor(index: number): string {
  return `idx:${index}`
}

export function decodeCursor(cursor: string): number {
  if (cursor.startsWith("idx:")) {
    const value = Number.parseInt(cursor.slice("idx:".length), 10)
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("Invalid history cursor")
    }
    return value
  }

  throw new Error("Invalid history cursor")
}

export function coalesceContextWindowUpdates(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  const result: TranscriptEntry[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const next = entries[index + 1]
    if (entry.kind === "context_window_updated" && next?.kind === "context_window_updated") {
      continue
    }
    result.push(entry)
  }
  return result
}

export function getHistorySnapshot(page: TranscriptPageResult, recentLimit: number): ChatHistorySnapshot {
  return {
    hasOlder: page.hasOlder,
    olderCursor: page.olderCursor,
    recentLimit,
  }
}

export function getForkedChatTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return "Fork: New Chat"
  return trimmed.startsWith("Fork: ") ? trimmed : `Fork: ${trimmed}`
}

export function getMessagesPageFromEntries(
  entries: TranscriptEntry[],
  limit: number,
  beforeIndex?: number,
): TranscriptPageResult {
  if (entries.length === 0) {
    return { entries: [], hasOlder: false, olderCursor: null }
  }
  const endIndex =
    beforeIndex === undefined
      ? entries.length
      : Math.max(0, Math.min(beforeIndex, entries.length))
  const startIndex = Math.max(0, endIndex - limit)
  return {
    entries: cloneTranscriptEntries(entries.slice(startIndex, endIndex)),
    hasOlder: startIndex > 0,
    olderCursor: startIndex > 0 ? encodeHistoryCursor(startIndex) : null,
  }
}
