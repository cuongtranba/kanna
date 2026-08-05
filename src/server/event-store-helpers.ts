/**
 * Pure helper functions extracted from event-store.ts.
 * No EventStore class dependencies. No IO side effects.
 */
import { log } from "../shared/log"
import type { ChatHistorySnapshot, TranscriptEntry } from "../shared/types"
import { cloneTranscriptEntries } from "./events"
import type { StoreEvent } from "./events"

export interface TranscriptPageResult {
  entries: TranscriptEntry[]
  hasOlder: boolean
  olderCursor: string | null
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

export function logSendToStartingProfile(stage: string, details?: Record<string, unknown>): void {
  if (!isSendToStartingProfilingEnabled()) {
    return
  }

  log.info("[kanna/send->starting][server]", JSON.stringify({
    stage,
    ...details,
  }))
}

/**
 * Event types that shipped in an earlier version and have since been retired.
 *
 * `STORE_VERSION` is deliberately NOT bumped when an event is retired — a
 * version mismatch is fail-closed and wipes the user's entire history — so an
 * existing `turns.jsonl` keeps carrying these lines until the next compaction.
 * They apply as no-ops (the apply switch simply has no case for them); listing
 * them here prices them at their historical bucket and keeps them off the
 * unknown-type warning, which is reserved for genuine version drift.
 *
 * - `session_commands_loaded`: the `/` picker's catalog, once persisted per
 *   chat, now derived per project and never stored.
 */
const RETIRED_EVENT_TYPES = new Set<string>(["session_commands_loaded"])

/**
 * Sort bucket for an event type this binary does not know.
 *
 * A replayed log can always carry a type from a DIFFERENT code version — a
 * branch that was run locally and never landed, or a downgrade after a newer
 * build wrote the log. `applyStoreEvent` has no `default` case, so such an
 * event is a no-op on apply regardless of where it sorts; the only job here is
 * to keep the comparator a total order. Priced last so an unknown event never
 * displaces a known one at the same timestamp.
 */
export const UNKNOWN_EVENT_PRIORITY = 99

export function getReplayEventPriority(event: StoreEvent): number {
  const discriminator = "type" in event ? event.type : event.kind
  if (RETIRED_EVENT_TYPES.has(discriminator)) return 6
  switch (discriminator) {
    case "project_opened":
    case "project_removed":
    case "sidebar_project_order_set":
    case "project_star_set":
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
      return 11
    case "stack_added":
    case "stack_removed":
    case "stack_renamed":
    case "stack_project_added":
    case "stack_project_removed":
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
    // tool_request_put shares priority 5 with subagent_* events; sourceIndex
    // tie-break orders them (tool-requests has sourceIndex 7, turns has 5).
    case "tool_request_put":
      return 5
    case "tool_request_resolved":
      return 6
    // Compile-time exhaustiveness is preserved: adding a member to the
    // StoreEvent union without a case above widens `discriminator` past
    // `never` and fails the type check. At RUNTIME this branch is only
    // reachable for a type outside the union — i.e. data written by another
    // code version — so it warns and prices the event instead of throwing.
    // Throwing here bricked boot on a single ignorable row (a stray
    // `turn_resume_attempted` from unmerged PR #493), and it protected
    // nothing: `applyStoreEvent` no-ops on unknown types anyway.
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

// `context_window_updated` entries are token-readout noise emitted once per
// stream tick — only the latest value matters. A single turn can emit hundreds
// of them, and the bounded live window (getMessagesPageFromEntries) counts each
// 1:1 against the limit, so a flood evicts real turns (e.g. the user_prompt)
// out of the snapshot the client renders. Collapsing each maximal run of
// consecutive cwu entries to its last entry keeps the latest readout while
// freeing window budget for real turns. Applied only on the live-window read
// path (not getMessages), so getLatestContextWindowUsage / full-transcript
// export / importer still observe every persisted cwu.
export function coalesceContextWindowUpdates(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  const result: TranscriptEntry[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const next = entries[index + 1]
    if (entry.kind === "context_window_updated" && next?.kind === "context_window_updated") {
      // Drop this cwu; the last of the run survives.
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

/**
 * Slice a page of transcript entries from a flat array.
 *
 * - `limit` controls page size; `beforeIndex` (from a cursor) is the
 *   exclusive upper bound of the window (undefined = latest page).
 * - Returns stable `TranscriptPageResult` with cloned entries so
 *   callers cannot mutate the in-memory transcript.
 */
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
