import type { TranscriptEntry } from "../../shared/types"
import { isAutoContinueEvent, storeEventKind, type StoreEvent, type StoreEventKind } from "../events"

export const STORE_EVENT_SUBJECT = {
  project_opened: "project.opened",
  project_removed: "project.removed",
  project_deleted: "project.deleted",
  project_star_set: "project.starred",
  project_instructions_set: "project.instructions",
  sidebar_project_order_set: null,
  chat_created: "chat.created",
  chat_projects_attached: "chat.projectsAttached",
  chat_renamed: "chat.renamed",
  chat_deleted: "chat.deleted",
  chat_archived: "chat.archived",
  chat_unarchived: "chat.unarchived",
  chat_pin_set: "chat.pinned",
  chat_provider_set: "chat.provider",
  chat_model_set: "chat.model",
  chat_plan_mode_set: "chat.planMode",
  chat_policy_override_set: "chat.policy",
  chat_read_state_set: null,
  chat_source_hash_set: null,
  chat_compact_failures_set: null,
  message_appended: null,
  queued_message_enqueued: "queue.enqueued",
  queued_message_removed: "queue.removed",
  turn_started: "turn.started",
  turn_finished: "turn.finished",
  turn_failed: "turn.failed",
  turn_cancelled: "turn.cancelled",
  session_token_set: null,
  pending_fork_session_token_set: null,
  stack_added: "stack.added",
  stack_removed: "stack.removed",
  stack_renamed: "stack.renamed",
  stack_project_added: "stack.projectAdded",
  stack_project_removed: "stack.projectRemoved",
  stack_instructions_set: "stack.instructions",
  subagent_run_started: "subagent.started",
  subagent_run_completed: "subagent.completed",
  subagent_run_failed: "subagent.failed",
  subagent_run_cancelled: "subagent.cancelled",
  subagent_tool_pending: "subagent.toolPending",
  subagent_tool_resolved: "subagent.toolResolved",
  subagent_message_delta: null,
  subagent_entry_appended: null,
  tool_request_put: "toolRequest.put",
  tool_request_resolved: "toolRequest.resolved",
  auto_continue_proposed: "autocontinue.proposed",
  auto_continue_accepted: "autocontinue.accepted",
  auto_continue_rescheduled: "autocontinue.rescheduled",
  auto_continue_cancelled: "autocontinue.cancelled",
  auto_continue_fired: "autocontinue.fired",
  loop_armed: "loop.armed",
  loop_run_outcome: "loop.runOutcome",
  loop_disarmed: "loop.disarmed",
  cron_armed: "cron.armed",
  cron_disarmed: "cron.disarmed",
  cron_paused: "cron.paused",
  cron_resumed: "cron.resumed",
  cron_run_started: "cron.runStarted",
  cron_run_outcome: "cron.runOutcome",
  cron_run_skipped: "cron.runSkipped",
  chat_task_created: "task.created",
  chat_task_updated: "task.updated",
  chat_task_deleted: "task.deleted",
  chat_task_claimed: "task.claimed",
  chat_task_run_bound: "task.runBound",
  chat_task_settled: "task.settled",
  chat_task_integrated: "task.integrated",
  chat_task_note: "task.note",
  chat_task_epoch_advanced: "task.epochAdvanced",
  chat_task_native_synced: "task.nativeSynced",
} satisfies Record<StoreEventKind, string | null>

export const TRANSCRIPT_BUS_KINDS: ReadonlySet<TranscriptEntry["kind"]> = new Set<TranscriptEntry["kind"]>([
  "user_prompt",
  "compact_boundary",
  "context_cleared",
  "webhook_delivery",
  "inbound_delivery",
  "loop_disarmed",
  "cron_armed",
  "cron_command_error",
  "cron_run",
  "cron_run_skipped",
  "cron_list",
  "cron_job_change",
])

export function storeEventSubject(event: StoreEvent): string | null {
  return STORE_EVENT_SUBJECT[storeEventKind(event)]
}

export function storeEventEntityId(event: StoreEvent): string {
  if (isAutoContinueEvent(event)) return event.scheduleId
  switch (event.type) {
    case "sidebar_project_order_set":
      return ""
    case "project_opened":
    case "project_removed":
    case "project_deleted":
    case "project_star_set":
    case "project_instructions_set":
      return event.projectId
    case "stack_added":
    case "stack_removed":
    case "stack_renamed":
    case "stack_project_added":
    case "stack_project_removed":
    case "stack_instructions_set":
      return event.stackId
    case "tool_request_put":
      return event.request.id
    case "tool_request_resolved":
      return event.id
    case "queued_message_enqueued":
      return event.message.id
    case "queued_message_removed":
      return event.queuedMessageId
    case "subagent_run_started":
    case "subagent_message_delta":
    case "subagent_run_completed":
    case "subagent_run_failed":
    case "subagent_run_cancelled":
    case "subagent_entry_appended":
    case "subagent_tool_pending":
    case "subagent_tool_resolved":
      return event.runId
    case "chat_task_created":
    case "chat_task_updated":
    case "chat_task_deleted":
    case "chat_task_claimed":
    case "chat_task_run_bound":
    case "chat_task_settled":
    case "chat_task_integrated":
      return event.taskId
    case "chat_task_note":
      return event.noteId
    default:
      return event.chatId
  }
}

export function storeEventTimestamp(event: StoreEvent): number {
  return event.timestamp
}

export function storeEventChatId(event: StoreEvent): string | undefined {
  if ("chatId" in event) return event.chatId
  if (event.type === "tool_request_put") return event.request.chatId
  return undefined
}
