import { log } from "../shared/log"
import type { StoreEvent, StoreEventKind } from "./events"
import { storeEventKind } from "./events"
import type { LogName } from "./event-logs"

export type EventFamily =
  | "project"
  | "stack"
  | "chat"
  | "message"
  | "subagent"
  | "toolRequest"
  | "chatTask"
  | "autoContinue"

interface EventRoute {
  readonly log: LogName
  readonly family: EventFamily
  readonly replayPriority: number
}

export const EVENT_ROUTES = {
  project_opened: { log: "projects", family: "project", replayPriority: 0 },
  project_removed: { log: "projects", family: "project", replayPriority: 0 },
  project_deleted: { log: "projects", family: "project", replayPriority: 0 },
  sidebar_project_order_set: { log: "projects", family: "project", replayPriority: 0 },
  project_star_set: { log: "projects", family: "project", replayPriority: 0 },
  project_instructions_set: { log: "projects", family: "project", replayPriority: 0 },
  stack_added: { log: "stacks", family: "stack", replayPriority: 0 },
  stack_removed: { log: "stacks", family: "stack", replayPriority: 0 },
  stack_renamed: { log: "stacks", family: "stack", replayPriority: 0 },
  stack_project_added: { log: "stacks", family: "stack", replayPriority: 0 },
  stack_project_removed: { log: "stacks", family: "stack", replayPriority: 0 },
  stack_instructions_set: { log: "stacks", family: "stack", replayPriority: 0 },
  chat_created: { log: "chats", family: "chat", replayPriority: 1 },
  chat_projects_attached: { log: "chats", family: "chat", replayPriority: 2 },
  chat_renamed: { log: "chats", family: "chat", replayPriority: 2 },
  chat_provider_set: { log: "chats", family: "chat", replayPriority: 2 },
  chat_model_set: { log: "chats", family: "chat", replayPriority: 2 },
  chat_plan_mode_set: { log: "chats", family: "chat", replayPriority: 2 },
  message_appended: { log: "messages", family: "message", replayPriority: 3 },
  queued_message_enqueued: { log: "queued-messages", family: "chat", replayPriority: 4 },
  queued_message_removed: { log: "queued-messages", family: "chat", replayPriority: 4 },
  turn_started: { log: "turns", family: "chat", replayPriority: 5 },
  session_token_set: { log: "turns", family: "chat", replayPriority: 6 },
  pending_fork_session_token_set: { log: "turns", family: "chat", replayPriority: 6 },
  turn_cancelled: { log: "turns", family: "chat", replayPriority: 7 },
  turn_finished: { log: "turns", family: "chat", replayPriority: 8 },
  turn_failed: { log: "turns", family: "chat", replayPriority: 8 },
  chat_read_state_set: { log: "chats", family: "chat", replayPriority: 9 },
  chat_source_hash_set: { log: "chats", family: "chat", replayPriority: 9 },
  chat_policy_override_set: { log: "chats", family: "chat", replayPriority: 9 },
  chat_compact_failures_set: { log: "chats", family: "chat", replayPriority: 9 },
  chat_deleted: { log: "chats", family: "chat", replayPriority: 10 },
  chat_archived: { log: "chats", family: "chat", replayPriority: 10 },
  chat_unarchived: { log: "chats", family: "chat", replayPriority: 10 },
  chat_pin_set: { log: "chats", family: "chat", replayPriority: 10 },
  subagent_run_started: { log: "turns", family: "subagent", replayPriority: 5 },
  subagent_message_delta: { log: "turns", family: "subagent", replayPriority: 5 },
  subagent_entry_appended: { log: "turns", family: "subagent", replayPriority: 5 },
  subagent_run_completed: { log: "turns", family: "subagent", replayPriority: 5 },
  subagent_run_failed: { log: "turns", family: "subagent", replayPriority: 5 },
  subagent_run_cancelled: { log: "turns", family: "subagent", replayPriority: 5 },
  subagent_tool_pending: { log: "turns", family: "subagent", replayPriority: 5 },
  subagent_tool_resolved: { log: "turns", family: "subagent", replayPriority: 5 },
  tool_request_put: { log: "tool-requests", family: "toolRequest", replayPriority: 5 },
  tool_request_resolved: { log: "tool-requests", family: "toolRequest", replayPriority: 6 },
  auto_continue_proposed: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  auto_continue_accepted: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  auto_continue_rescheduled: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  auto_continue_cancelled: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  auto_continue_fired: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  loop_armed: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  loop_run_outcome: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  loop_disarmed: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  cron_armed: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  cron_disarmed: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  cron_paused: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  cron_resumed: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  cron_run_started: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  cron_run_outcome: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  cron_run_skipped: { log: "schedules", family: "autoContinue", replayPriority: 11 },
  chat_task_created: { log: "chat-tasks", family: "chatTask", replayPriority: 5 },
  chat_task_updated: { log: "chat-tasks", family: "chatTask", replayPriority: 5 },
  chat_task_deleted: { log: "chat-tasks", family: "chatTask", replayPriority: 5 },
  chat_task_claimed: { log: "chat-tasks", family: "chatTask", replayPriority: 5 },
  chat_task_run_bound: { log: "chat-tasks", family: "chatTask", replayPriority: 5 },
  chat_task_settled: { log: "chat-tasks", family: "chatTask", replayPriority: 5 },
  chat_task_integrated: { log: "chat-tasks", family: "chatTask", replayPriority: 5 },
  chat_task_note: { log: "chat-tasks", family: "chatTask", replayPriority: 5 },
  chat_task_epoch_advanced: { log: "chat-tasks", family: "chatTask", replayPriority: 5 },
  chat_task_native_synced: { log: "chat-tasks", family: "chatTask", replayPriority: 5 },
} satisfies Record<StoreEventKind, EventRoute>

type KindsOfFamily<F extends EventFamily> = {
  [K in StoreEventKind]: (typeof EVENT_ROUTES)[K]["family"] extends F ? K : never
}[StoreEventKind]

export type EventOfFamily<F extends EventFamily> =
  | Extract<StoreEvent, { type: KindsOfFamily<F> }>
  | Extract<StoreEvent, { kind: KindsOfFamily<F> }>

export function logOfEvent(event: StoreEvent): LogName {
  return EVENT_ROUTES[storeEventKind(event)].log
}

export function isEventOf<F extends EventFamily>(family: F, event: StoreEvent): event is EventOfFamily<F> {
  const kind = storeEventKind(event)
  return Object.hasOwn(EVENT_ROUTES, kind) && EVENT_ROUTES[kind].family === family
}

const RETIRED_EVENT_REPLAY_PRIORITY = new Map<string, number>([["session_commands_loaded", 6]])

export const UNKNOWN_EVENT_PRIORITY = 99

export function getReplayEventPriority(event: StoreEvent): number {
  const kind = storeEventKind(event)
  if (Object.hasOwn(EVENT_ROUTES, kind)) return EVENT_ROUTES[kind].replayPriority
  const retired = RETIRED_EVENT_REPLAY_PRIORITY.get(kind)
  if (retired !== undefined) return retired
  log.warn(
    "[kanna/event-store] Skipping unknown replay event type (written by a different version):",
    kind,
  )
  return UNKNOWN_EVENT_PRIORITY
}
