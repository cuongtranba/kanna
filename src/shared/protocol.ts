import type { z } from "zod"
import type { ClientCommand, CommandAckResult, CommandResult, NoResultClientCommand } from "./commands"
import type { editorOpenSettingsSchema } from "./core-types.schema"
import type { BeaconsSnapshot } from "./beacon-status"
import { isJsonArray, isJsonObject, type JsonValue } from "./json"
import type {
  AppSettingsSnapshot,
  ChatDiffSnapshot,
  ChatSnapshot,
  KeybindingsSnapshot,
  LlmProviderSnapshot,
  LocalProjectsSnapshot,
  ProjectCommandsSnapshot,
  PushConfigSnapshot,
  SidebarData,
  Subagent,
  SubagentValidationError,
  UpdateSnapshot,
  EditorPreset,
} from "./types"
import type { ChatOpsEvent } from "./chat-ops"
import type { LiveBlock } from "./live-block"
import type { BoardOwnerKind, BoardSummary, BoardViewSnapshot } from "./boards/types"
import type { WorkflowRunSummary } from "./workflow-types"
import type { InboxSnapshot } from "./inbox/types"
import type { McpSourcesSnapshot } from "./mcp-sources/types"
import type { WebhooksSnapshot } from "./webhooks/types"
import type { ServiceBusStatus } from "./service-bus/jetstream-config"

export type { EditorPreset }

export type EditorOpenSettings = z.output<typeof editorOpenSettingsSchema>

export type SubscriptionTopic =
  | { type: "sidebar" }
  | { type: "local-projects" }
  | { type: "update" }
  | { type: "keybindings" }
  | { type: "app-settings" }
  | { type: "push-config" }
  | { type: "chat"; chatId: string; recentLimit?: number; since?: number }
  | { type: "project-git"; projectId: string; chatId?: string }
  | { type: "project-commands"; projectId: string }
  | { type: "terminal"; terminalId: string }
  | { type: "workflows"; chatId: string }
  | { type: "boards"; ownerKind: BoardOwnerKind; ownerId: string }
  | { type: "board"; boardId: string; pageSize?: number }
  | { type: "followed-sessions" }
  | { type: "cron-jobs" }
  | { type: "beacons" }
  | { type: "background-task-output"; chatId: string; taskId: string }
  | { type: "package-updates" }
  | { type: "webhooks" }
  | { type: "inbox" }
  | { type: "mcp-sources" }
  | { type: "service-bus" }

export interface TerminalSnapshot {
  terminalId: string
  title: string
  cwd: string
  shell: string
  cols: number
  rows: number
  scrollback: number
  serializedState: string
  status: "running" | "exited"
  exitCode: number | null
  signal?: number
}

export type TerminalEvent =
  | { type: "terminal.output"; terminalId: string; data: string }
  | { type: "terminal.exit"; terminalId: string; exitCode: number; signal?: number }

export type SubagentCommandResult =
  | { ok: true; subagent: Subagent }
  | { ok: false; error: SubagentValidationError }

export type SubagentDeleteResult = { ok: true }

export interface WorkflowsSnapshot {
  chatId: string
  runs: WorkflowRunSummary[]
}

export interface BackgroundTaskOutputSnapshot {
  chatId: string
  taskId: string
  content: string
  truncated: boolean
}

export interface FollowedSessionsSnapshot {
  chatIds: string[]
}

export interface SingleImportResultRow {
  sessionId: string
  status: "created" | "updated" | "skipped" | "failed"
  chatId?: string
  title?: string
  error?: "invalid_id" | "not_found" | "cwd_missing" | "parse_failed" | "store_error"
}

export interface ImportSessionsByIdsResult {
  results: SingleImportResultRow[]
  newProjects: number
}

export interface ProjectDeleteResult {
  deletedBoardIds: string[]
  failures: string[]
}

function stringsOf(value: JsonValue | undefined): string[] {
  if (value === undefined || !isJsonArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

export function readProjectDeleteResult(value: JsonValue): ProjectDeleteResult {
  const record = isJsonObject(value) ? value : {}
  return { deletedBoardIds: stringsOf(record.deletedBoardIds), failures: stringsOf(record.failures) }
}

export interface ChatLiveEvent {
  type: "chat.live"
  chatId: string
  block: LiveBlock | null
}

export type WsEvent = TerminalEvent | ChatOpsEvent | ChatLiveEvent

export type { ClientCommand }

export type OpenExternalAction = Extract<ClientCommand, { type: "system.openExternal" }>["action"]

export type ClientEnvelope =
  | { v: 1; type: "subscribe"; id: string; topic: SubscriptionTopic }
  | { v: 1; type: "unsubscribe"; id: string }
  | { v: 1; type: "command"; id: string; command: ClientCommand }

export type ServerSnapshot =
  | { type: "sidebar"; data: SidebarData }
  | { type: "local-projects"; data: LocalProjectsSnapshot }
  | { type: "update"; data: UpdateSnapshot }
  | { type: "keybindings"; data: KeybindingsSnapshot }
  | { type: "app-settings"; data: AppSettingsSnapshot }
  | { type: "llm-provider"; data: LlmProviderSnapshot }
  | { type: "push-config"; data: PushConfigSnapshot }
  | { type: "chat"; data: ChatSnapshot | null }
  | { type: "project-git"; data: ChatDiffSnapshot | null }
  | { type: "project-commands"; data: ProjectCommandsSnapshot }
  | { type: "terminal"; data: TerminalSnapshot | null }
  | { type: "workflows"; data: WorkflowsSnapshot }
  | { type: "boards"; data: BoardsSnapshot }
  | { type: "board"; data: BoardSnapshot }
  | { type: "followed-sessions"; data: FollowedSessionsSnapshot }
  | { type: "cron-jobs"; data: import("./cron/types").CronJobsGlobalSnapshot }
  | { type: "beacons"; data: BeaconsSnapshot }
  | { type: "background-task-output"; data: BackgroundTaskOutputSnapshot }
  | { type: "package-updates"; data: import("./packages/types").PackageUpdateSnapshot }
  | { type: "webhooks"; data: WebhooksSnapshot }
  | { type: "inbox"; data: InboxSnapshot }
  | { type: "mcp-sources"; data: McpSourcesSnapshot }
  | { type: "service-bus"; data: ServiceBusStatus }

export interface BoardsSnapshot {
  ownerKind: BoardOwnerKind
  ownerId: string
  boards: BoardSummary[]
}

export interface BoardSnapshot {
  boardId: string
  view: BoardViewSnapshot | null
}

export type { CommandAckResult, CommandResult, NoResultClientCommand }

export type ServerEnvelope =
  | { v: 1; type: "snapshot"; id: string; snapshot: ServerSnapshot }
  | { v: 1; type: "event"; id: string; event: WsEvent }
  | { v: 1; type: "ack"; id: string; result?: CommandAckResult }
  | { v: 1; type: "error"; id?: string; message: string }

export function isClientEnvelope(value: JsonValue): value is JsonValue & ClientEnvelope {
  if (!isJsonObject(value)) return false
  return value.v === 1 && typeof value.type === "string"
}

export function isServerEnvelope(value: JsonValue): value is JsonValue & ServerEnvelope {
  if (!isJsonObject(value)) return false
  return value.v === 1 && typeof value.type === "string"
}
