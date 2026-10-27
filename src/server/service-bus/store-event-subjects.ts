import { BUS_SUBJECT_SUFFIX } from "../../shared/service-bus/subjects"
import type { TranscriptEntry } from "../../shared/types"
import { isAutoContinueEvent, storeEventKind, type StoreEvent, type StoreEventKind } from "../events"

export const STORE_EVENT_SUBJECT = {
  project_opened: BUS_SUBJECT_SUFFIX.projectOpened,
  project_removed: BUS_SUBJECT_SUFFIX.projectRemoved,
  project_deleted: BUS_SUBJECT_SUFFIX.projectDeleted,
  project_star_set: BUS_SUBJECT_SUFFIX.projectStarred,
  project_instructions_set: BUS_SUBJECT_SUFFIX.projectInstructions,
  sidebar_project_order_set: null,
  chat_created: BUS_SUBJECT_SUFFIX.chatCreated,
  chat_projects_attached: BUS_SUBJECT_SUFFIX.chatProjectsAttached,
  chat_renamed: BUS_SUBJECT_SUFFIX.chatRenamed,
  chat_deleted: BUS_SUBJECT_SUFFIX.chatDeleted,
  chat_archived: BUS_SUBJECT_SUFFIX.chatArchived,
  chat_unarchived: BUS_SUBJECT_SUFFIX.chatUnarchived,
  chat_pin_set: BUS_SUBJECT_SUFFIX.chatPinned,
  chat_provider_set: BUS_SUBJECT_SUFFIX.chatProvider,
  chat_model_set: BUS_SUBJECT_SUFFIX.chatModel,
  chat_plan_mode_set: BUS_SUBJECT_SUFFIX.chatPlanMode,
  chat_policy_override_set: BUS_SUBJECT_SUFFIX.chatPolicy,
  chat_read_state_set: null,
  chat_source_hash_set: null,
  chat_compact_failures_set: null,
  message_appended: null,
  queued_message_enqueued: BUS_SUBJECT_SUFFIX.queueEnqueued,
  queued_message_removed: BUS_SUBJECT_SUFFIX.queueRemoved,
  turn_started: BUS_SUBJECT_SUFFIX.turnStarted,
  turn_finished: BUS_SUBJECT_SUFFIX.turnFinished,
  turn_failed: BUS_SUBJECT_SUFFIX.turnFailed,
  turn_cancelled: BUS_SUBJECT_SUFFIX.turnCancelled,
  session_token_set: null,
  pending_fork_session_token_set: null,
  stack_added: BUS_SUBJECT_SUFFIX.stackAdded,
  stack_removed: BUS_SUBJECT_SUFFIX.stackRemoved,
  stack_renamed: BUS_SUBJECT_SUFFIX.stackRenamed,
  stack_project_added: BUS_SUBJECT_SUFFIX.stackProjectAdded,
  stack_project_removed: BUS_SUBJECT_SUFFIX.stackProjectRemoved,
  stack_instructions_set: BUS_SUBJECT_SUFFIX.stackInstructions,
  subagent_run_started: BUS_SUBJECT_SUFFIX.subagentStarted,
  subagent_run_completed: BUS_SUBJECT_SUFFIX.subagentCompleted,
  subagent_run_failed: BUS_SUBJECT_SUFFIX.subagentFailed,
  subagent_run_cancelled: BUS_SUBJECT_SUFFIX.subagentCancelled,
  subagent_tool_pending: BUS_SUBJECT_SUFFIX.subagentToolPending,
  subagent_tool_resolved: BUS_SUBJECT_SUFFIX.subagentToolResolved,
  subagent_message_delta: null,
  subagent_entry_appended: null,
  tool_request_put: BUS_SUBJECT_SUFFIX.toolRequestPut,
  tool_request_resolved: BUS_SUBJECT_SUFFIX.toolRequestResolved,
  auto_continue_proposed: BUS_SUBJECT_SUFFIX.autocontinueProposed,
  auto_continue_accepted: BUS_SUBJECT_SUFFIX.autocontinueAccepted,
  auto_continue_rescheduled: BUS_SUBJECT_SUFFIX.autocontinueRescheduled,
  auto_continue_cancelled: BUS_SUBJECT_SUFFIX.autocontinueCancelled,
  auto_continue_fired: BUS_SUBJECT_SUFFIX.autocontinueFired,
  loop_armed: BUS_SUBJECT_SUFFIX.loopArmed,
  loop_run_outcome: BUS_SUBJECT_SUFFIX.loopRunOutcome,
  loop_disarmed: BUS_SUBJECT_SUFFIX.loopDisarmed,
  cron_armed: BUS_SUBJECT_SUFFIX.cronArmed,
  cron_disarmed: BUS_SUBJECT_SUFFIX.cronDisarmed,
  cron_paused: BUS_SUBJECT_SUFFIX.cronPaused,
  cron_resumed: BUS_SUBJECT_SUFFIX.cronResumed,
  cron_run_started: BUS_SUBJECT_SUFFIX.cronRunStarted,
  cron_run_outcome: BUS_SUBJECT_SUFFIX.cronRunOutcome,
  cron_run_skipped: BUS_SUBJECT_SUFFIX.cronRunSkipped,
  chat_task_created: BUS_SUBJECT_SUFFIX.taskCreated,
  chat_task_updated: BUS_SUBJECT_SUFFIX.taskUpdated,
  chat_task_deleted: BUS_SUBJECT_SUFFIX.taskDeleted,
  chat_task_claimed: BUS_SUBJECT_SUFFIX.taskClaimed,
  chat_task_run_bound: BUS_SUBJECT_SUFFIX.taskRunBound,
  chat_task_settled: BUS_SUBJECT_SUFFIX.taskSettled,
  chat_task_integrated: BUS_SUBJECT_SUFFIX.taskIntegrated,
  chat_task_note: BUS_SUBJECT_SUFFIX.taskNote,
  chat_task_epoch_advanced: BUS_SUBJECT_SUFFIX.taskEpochAdvanced,
  chat_task_native_synced: BUS_SUBJECT_SUFFIX.taskNativeSynced,
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
