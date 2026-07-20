/**
 * Pure event dispatch — applies any StoreEvent to the in-memory state.
 *
 * Extracted from EventStore.applyEvent() to reduce event-store.ts file size.
 * All functions are pure state mutations — no IO, no side effects
 * (side-effect seal: IO lives in *.adapter.ts files).
 */

import type { AgentProvider, TranscriptEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import type { StoreEvent, StoreState } from "./events"
import {
  applyChatLifecycleEvent,
  applyChatMessageMetadata,
  applyAutoContinueToState,
  applyProjectEvent,
  applyStackEvent,
} from "./event-store-chat-lifecycle"
import { applySubagentEvent } from "./event-store-subagent"
import { applyToolRequestEvent } from "./event-store-tool-requests"
import { applyOrchEvent } from "./event-store-orch"

function isAutoContinueEvent(event: StoreEvent): event is AutoContinueEvent {
  return "kind" in event
}

/**
 * Apply a single StoreEvent to the full in-memory state.
 *
 * @param event               - the event to apply
 * @param state               - full StoreState (mutated in-place)
 * @param legacyMessagesByChatId - legacy transcript store (mutated for `message_appended`)
 * @param replayChatProvider  - provider-replay tracking map
 */
export function applyStoreEvent(
  event: StoreEvent,
  state: StoreState,
  legacyMessagesByChatId: Map<string, TranscriptEntry[]>,
  replayChatProvider: Map<string, AgentProvider | null>,
): void {
  if (isAutoContinueEvent(event)) {
    applyAutoContinueToState(state.autoContinueEventsByChatId, event)
    return
  }
  const e: Exclude<StoreEvent, AutoContinueEvent> = event
  switch (e.type) {
    case "project_opened":
    case "project_removed":
    case "sidebar_project_order_set":
    case "project_star_set": {
      applyProjectEvent(state, e)
      break
    }
    case "chat_created":
    case "chat_renamed":
    case "chat_deleted":
    case "chat_archived":
    case "chat_unarchived":
    case "chat_provider_set":
    case "chat_plan_mode_set":
    case "chat_read_state_set":
    case "chat_source_hash_set":
    case "chat_policy_override_set":
    case "chat_compact_failures_set": {
      applyChatLifecycleEvent(state, replayChatProvider, e)
      break
    }
    case "message_appended": {
      applyChatMessageMetadata(state.chatsById, e.chatId, e.entry)
      const existing = legacyMessagesByChatId.get(e.chatId) ?? []
      existing.push({ ...e.entry })
      legacyMessagesByChatId.set(e.chatId, existing)
      break
    }
    case "queued_message_enqueued":
    case "queued_message_removed":
    case "turn_started":
    case "turn_finished":
    case "turn_failed":
    case "turn_cancelled":
    case "session_token_set":
    case "session_commands_loaded":
    case "pending_fork_session_token_set": {
      applyChatLifecycleEvent(state, replayChatProvider, e)
      break
    }
    case "stack_added":
    case "stack_removed":
    case "stack_renamed":
    case "stack_project_added":
    case "stack_project_removed": {
      applyStackEvent(state.stacksById, e)
      break
    }
    case "subagent_run_started":
    case "subagent_message_delta":
    case "subagent_entry_appended":
    case "subagent_run_completed":
    case "subagent_run_failed":
    case "subagent_run_cancelled":
    case "subagent_tool_pending":
    case "subagent_tool_resolved": {
      applySubagentEvent(state.subagentRunsByChatId, e)
      break
    }
    case "tool_request_put":
    case "tool_request_resolved": {
      applyToolRequestEvent(state.toolRequestsById, e)
      break
    }
    case "orch_run_created":
    case "orch_worktree_provisioned":
    case "orch_worktree_init_started":
    case "orch_worktree_init_completed":
    case "orch_task_claimed":
    case "orch_phase_started":
    case "orch_phase_completed":
    case "orch_gate_opened":
    case "orch_gate_resolved":
    case "orch_scope_overlap_flagged":
    case "orch_config_warning":
    case "orch_verify_started":
    case "orch_verify_completed":
    case "orch_task_committed":
    case "orch_task_failed":
    case "orch_task_requeued":
    case "orch_run_completed":
    case "orch_run_cancelled":
      applyOrchEvent(state.orchRunsById, e)
      break
  }
}
