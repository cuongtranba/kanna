import type { CronJobPatch } from "./cron/types"
import type { ShareClientCommand } from "./session-share/protocol"
import type { AnyValue } from "./errors"
import { isRecord } from "./errors"
import type {
  AppSettingsSnapshot,
  AppSettingsPatch,
  AgentProvider,
  ChatAttachment,
  ChatDiffSnapshot,
  ChatHistoryPage,
  ChatSnapshot,
  ClaudeAuthSettings,
  CloudflareTunnelSettings,
  DiffCommitMode,
  KeybindingsSnapshot,
  LlmProviderSnapshot,
  LocalProjectsSnapshot,
  ModelOptions,
  ProjectCommandsSnapshot,
  PushConfigSnapshot,
  PushSubscribeRequestPayload,
  SidebarData,
  Subagent,
  SubagentInput,
  SubagentPatch,
  SubagentValidationError,
  UpdateSnapshot,
  EditorPreset,
} from "./types"
import type { ChatOpsEvent } from "./chat-ops"
import type { ChatPermissionPolicyOverride, ToolRequestDecision } from "./permission-policy"
import type { PtyInstanceDelta, PtyInstancesSnapshot } from "./pty-instance"
import type {
  BoardOwnerKind,
  BoardSummary,
  BoardViewSnapshot,
  ColumnColorToken,
  ColumnSemantic,
  SyncDirection,
} from "./boards/types"
import type { CleanupDecision } from "./boards/worktree-cleanup"
import type { WorkflowRunSummary } from "./workflow-types"

export type { EditorPreset }

export interface EditorOpenSettings {
  preset: EditorPreset
  commandTemplate: string
}

export type SubscriptionTopic =
  | { type: "sidebar" }
  | { type: "local-projects" }
  | { type: "update" }
  | { type: "keybindings" }
  | { type: "app-settings" }
  | { type: "push-config" }
  | { type: "chat"; chatId: string; recentLimit?: number; since?: number }
  /**
   * `chatId` names the chat whose tree is wanted.
   *
   * A chat can run in a git worktree of its project, so "the project's git
   * state" is not one thing: two chats in one project can sit on different
   * branches with different dirty files. Without the chat, the second one is
   * shown the first one's tree. Omitted means the project's own checkout.
   */
  | { type: "project-git"; projectId: string; chatId?: string }
  | { type: "project-commands"; projectId: string }
  | { type: "terminal"; terminalId: string }
  | { type: "pty-instances" }
  | { type: "workflows"; chatId: string }
  | { type: "boards"; ownerKind: BoardOwnerKind; ownerId: string }
  /**
   * `pageSize` is how many cards per column the subscriber wants.
   *
   * Paging RAISES it rather than appending client-side: every broadcast then
   * carries a complete prefix of each column, so a snapshot pushed by an
   * unrelated card edit cannot silently discard the pages already loaded.
   */
  | { type: "board"; boardId: string; pageSize?: number }
  | { type: "followed-sessions" }
  | { type: "cron-jobs" }
  | { type: "background-task-output"; chatId: string; taskId: string }

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

export type PtyInstancesEvent =
  | { type: "pty-instances.added"; instance: Extract<PtyInstanceDelta, { type: "added" }>["instance"] }
  | { type: "pty-instances.updated"; instance: Extract<PtyInstanceDelta, { type: "updated" }>["instance"] }
  | { type: "pty-instances.removed"; chatId: string }

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
  /**
   * `too_large` is distinct from `parse_failed` on purpose: the source file
   * exceeded the import size cap, which the user can act on (raise
   * `KANNA_IMPORT_MAX_ROLLOUT_BYTES`). Reporting a 91 MB rollout as
   * `parse_failed` is a misdiagnosis they cannot do anything with.
   */
  error?: "invalid_id" | "not_found" | "cwd_missing" | "parse_failed" | "too_large" | "store_error"
}

export interface ImportSessionsByIdsResult {
  results: SingleImportResultRow[]
  newProjects: number
}

export type WsEvent = TerminalEvent | PtyInstancesEvent | ChatOpsEvent

export type ClientCommand =
  | { type: "project.open"; localPath: string }
  | { type: "project.create"; localPath: string; title: string }
  | { type: "sessions.importClaude" }
  | { type: "sessions.importClaudeSession"; sessionIds: string[] }
  | { type: "project.remove"; projectId: string }
  | { type: "project.setStar"; projectId: string; starred: boolean }
  | { type: "sidebar.reorderProjectGroups"; projectIds: string[] }
  /** `chatId` names the tree to read from — a chat's worktree has its own contents. */
  | { type: "project.readDiffPatch"; projectId: string; path: string; chatId?: string }
  | { type: "stack.create"; title: string; projectIds: string[] }
  | { type: "stack.rename"; stackId: string; title: string }
  | { type: "stack.remove"; stackId: string }
  | { type: "stack.addProject"; stackId: string; projectId: string }
  | { type: "stack.removeProject"; stackId: string; projectId: string }
  | { type: "stack.listWorktrees"; projectId: string }
  | { type: "system.ping" }
  | { type: "update.check"; force?: boolean }
  | { type: "update.install"; version?: string }
  | { type: "update.reload" }
  | { type: "settings.readKeybindings" }
  | { type: "settings.writeKeybindings"; bindings: KeybindingsSnapshot["bindings"] }
  | { type: "settings.readAppSettings" }
  | { type: "settings.writeAppSettings"; analyticsEnabled: boolean }
  | { type: "appSettings.setCloudflareTunnel"; patch: Partial<CloudflareTunnelSettings> }
  | { type: "appSettings.setClaudeAuth"; patch: Partial<ClaudeAuthSettings> }
  | { type: "appSettings.testOAuthToken"; token: string }
  | { type: "settings.writeAppSettingsPatch"; patch: AppSettingsPatch }
  | { type: "subagent.create"; input: SubagentInput }
  | { type: "subagent.update"; id: string; patch: SubagentPatch }
  | { type: "subagent.delete"; id: string }
  | { type: "settings.testMcpServer"; id: string }
  | { type: "settings.startMcpOAuth"; id: string }
  | { type: "settings.completeMcpOAuth"; id: string; callbackUrl: string }
  | { type: "settings.readLlmProvider" }
  | { type: "settings.listOpenRouterModels" }
  | { type: "settings.getChangelog" }
  | { type: "skills.search"; query: string; limit?: number }
  | { type: "skills.install"; source: string; skillId: string }
  | { type: "skills.uninstall"; skillId: string }
  | { type: "skills.listInstalled" }
  | {
      type: "settings.writeLlmProvider"
      provider: LlmProviderSnapshot["provider"]
      apiKey: string
      model: string
      baseUrl: string
    }
  | {
      type: "settings.validateLlmProvider"
      provider: LlmProviderSnapshot["provider"]
      apiKey: string
      model: string
      baseUrl: string
    }
  | {
      type: "system.openExternal"
      localPath: string
      action: "open_finder" | "open_terminal" | "open_editor" | "open_preview" | "open_default"
      line?: number
      column?: number
      editor?: EditorOpenSettings
    }
  | {
      type: "chat.create"
      projectId: string
      stackId?: string
      stackBindings?: Array<{ projectId: string; worktreePath: string; role: "primary" | "additional" }>
    }
  | { type: "chat.fork"; chatId: string }
  | { type: "chat.rename"; chatId: string; title: string }
  | { type: "chat.archive"; chatId: string }
  | { type: "chat.unarchive"; chatId: string }
  | { type: "chat.delete"; chatId: string }
  | { type: "chat.setDraftProtection"; chatIds: string[] }
  | { type: "chat.markRead"; chatId: string }
  | { type: "chat.setPolicyOverride"; chatId: string; policyOverride: ChatPermissionPolicyOverride | null }
  | {
      type: "chat.send"
      chatId?: string
      projectId?: string
      clientTraceId?: string
      provider?: AgentProvider
      content: string
      attachments?: ChatAttachment[]
      model?: string
      modelOptions?: ModelOptions
      effort?: string
      planMode?: boolean
      autoResumeOnRateLimit?: boolean
    }
  | { type: "chat.refreshDiffs"; chatId: string }
  | { type: "chat.initGit"; chatId: string }
  | { type: "chat.getGitHubPublishInfo"; chatId: string }
  | { type: "chat.checkGitHubRepoAvailability"; chatId: string; owner: string; name: string }
  | {
      type: "chat.publishToGitHub"
      chatId: string
      owner: string
      name: string
      visibility: "public" | "private"
      description?: string
    }
  | { type: "chat.listBranches"; chatId: string }
  | {
      type: "chat.previewMergeBranch"
      chatId: string
      branch:
      | { kind: "local"; name: string }
      | { kind: "remote"; name: string; remoteRef: string }
      | {
          kind: "pull_request"
          name: string
          prNumber: number
          headRefName: string
          headRepoCloneUrl?: string
          isCrossRepository?: boolean
          remoteRef?: string
        }
    }
  | {
      type: "chat.mergeBranch"
      chatId: string
      branch:
      | { kind: "local"; name: string }
      | { kind: "remote"; name: string; remoteRef: string }
      | {
          kind: "pull_request"
          name: string
          prNumber: number
          headRefName: string
          headRepoCloneUrl?: string
          isCrossRepository?: boolean
          remoteRef?: string
        }
    }
  | { type: "chat.syncBranch"; chatId: string; action: "fetch" | "pull" | "push" | "publish" }
  | {
      type: "chat.checkoutBranch"
      chatId: string
      branch:
      | { kind: "local"; name: string }
      | { kind: "remote"; name: string; remoteRef: string }
      | {
          kind: "pull_request"
          name: string
          prNumber: number
          headRefName: string
          headRepoCloneUrl?: string
          isCrossRepository?: boolean
          remoteRef?: string
        }
      bringChanges?: boolean
    }
  | { type: "chat.createBranch"; chatId: string; name: string; baseBranchName?: string }
  | { type: "chat.generateCommitMessage"; chatId: string; paths: string[] }
  | { type: "chat.commitDiffs"; chatId: string; paths: string[]; summary: string; description?: string; mode: DiffCommitMode }
  | { type: "chat.discardDiffFile"; chatId: string; path: string }
  | { type: "chat.ignoreDiffFile"; chatId: string; path: string }
  | { type: "chat.cancel"; chatId: string }
  | { type: "chat.stopDraining"; chatId: string }
  | { type: "chat.loadHistory"; chatId: string; beforeCursor: string; limit: number }
  | { type: "chat.respondTool"; chatId: string; toolUseId: string; result: AnyValue }
  | {
      type: "chat.toolRequestAnswer"
      chatId: string
      toolRequestId: string
      decision: ToolRequestDecision
    }
  | { type: "chat.respondSubagentTool"; chatId: string; runId: string; toolUseId: string; result: Record<string, unknown> }
  | {
      type: "chat.cancelSubagentRun"
      chatId: string
      runId: string
    }
  | { type: "board.create"; ownerKind: BoardOwnerKind; ownerId: string; title: string; templateId?: string | null }
  | { type: "board.archive"; boardId: string }
  /**
   * `cardFields` is the board's whole card schema, not a delta — the store
   * writes it whole. Typed loose for the same reason `board.card.update`
   * carries its content that way: it is decoded against the domain's own rules
   * server-side, and a wire type would only be a second place to state them.
   */
  | { type: "board.update"; boardId: string; title?: string; description?: string | null; cardFields?: AnyValue }
  | { type: "board.duplicate"; boardId: string; title: string }
  | { type: "board.saveAsTemplate"; boardId: string; name: string }
  | {
      type: "board.sync.bind"
      boardId: string
      owner: string
      repo: string
      direction: SyncDirection
      allowAgentPush: boolean
      /** The checkout this repo lives in, so a Stack board's cards can Start work. */
      projectId?: string | null
      /**
       * Confirms a MOVE: the board this repo is currently synced by.
       *
       * A repo binds to exactly one board, so connecting one another board
       * holds detaches it there. Omitting this on a held repo is refused rather
       * than resolved — the server will not guess that a user meant to move.
       */
      detachFromBoardId?: string | null
    }
  /** Disconnect ONE repo from a board that may sync several. */
  | { type: "board.sync.unbind"; boardId: string; bindingId: string }
  | { type: "board.sync.pull"; boardId: string }
  | { type: "board.sync.push"; boardId: string }
  | { type: "board.sync.status"; boardId: string }
  | { type: "board.column.create"; boardId: string; title: string; afterColumnId?: string | null }
  | {
      type: "board.column.update"
      columnId: string
      title?: string
      semantic?: ColumnSemantic | null
      colorToken?: ColumnColorToken | null
      wipLimit?: number | null
    }
  /** Reorder: the column it should sit after; null means first. */
  | { type: "board.column.move"; columnId: string; afterColumnId: string | null }
  /** Refused while the column still holds cards. */
  | { type: "board.column.delete"; columnId: string }
  | { type: "board.card.create"; boardId: string; columnId: string; title: string; projectId?: string | null; afterCardId?: string | null }
  | {
      type: "board.card.move"
      cardId: string
      toColumnId: string
      aboveCardId: string | null
      belowCardId: string | null
    }
  | { type: "board.card.archive"; cardId: string }
  | { type: "board.card.detail"; cardId: string }
  | { type: "board.card.comment"; cardId: string; body: string }
  /**
   * `content` is the card's WHOLE content, not just the field that changed: the
   * store replaces rather than merges, so a partial map would erase every field
   * it did not name. Untyped on the wire because the schema it has to satisfy
   * is the board's, which only the server can read — see `decodeContentForFields`.
   */
  | { type: "board.card.update"; cardId: string; title?: string; content?: AnyValue }
  /** Card → worktree → branch → chat. Idempotent: a card already working opens what it has. */
  | { type: "board.card.startWork"; cardId: string }
  /** Answer the question a card asks on reaching `done`. */
  | { type: "board.card.resolveWorktree"; cardId: string; decision: CleanupDecision }
  | { type: "board.cards.page"; columnId: string; limit: number; afterRank?: string | null }
  | { type: "board.templates.list" }
  | { type: "workflows.getRun"; chatId: string; runId: string }
  | { type: "workflows.getAgentTranscript"; chatId: string; runId: string; agentId: string }
  | { type: "subagents.getRun"; chatId: string; agentId: string }
  | { type: "backgroundTasks.getOutput"; chatId: string; taskId: string }
  | {
      type: "message.enqueue"
      chatId: string
      content: string
      attachments?: ChatAttachment[]
      provider?: AgentProvider
      model?: string
      modelOptions?: ModelOptions
      planMode?: boolean
      autoResumeOnRateLimit?: boolean
    }
  | {
      type: "message.steer"
      chatId: string
      queuedMessageId: string
    }
  | {
      type: "message.dequeue"
      chatId: string
      queuedMessageId: string
    }
  | { type: "autoContinue.accept"; chatId: string; scheduleId: string; scheduledAt: number }
  | { type: "autoContinue.reschedule"; chatId: string; scheduleId: string; scheduledAt: number }
  | { type: "autoContinue.cancel"; chatId: string; scheduleId: string }
  | { type: "cron.remove"; chatId: string; jobId: string }
  | { type: "cron.pause"; chatId: string; jobId: string }
  | { type: "cron.resume"; chatId: string; jobId: string }
  | { type: "cron.update"; chatId: string; jobId: string; patch: CronJobPatch }
  | { type: "tunnel.accept"; chatId: string; tunnelId: string }
  | { type: "tunnel.stop"; chatId: string; tunnelId: string }
  | { type: "tunnel.retry"; chatId: string; tunnelId: string }
  | { type: "terminal.create"; projectId: string; terminalId: string; cols: number; rows: number; scrollback: number }
  | { type: "terminal.input"; terminalId: string; data: string }
  | { type: "terminal.resize"; terminalId: string; cols: number; rows: number }
  | { type: "terminal.close"; terminalId: string }
  | { type: "pty.cancel"; chatId: string }
  | { type: "pty.kill"; chatId: string }
  | { type: "push.identifyDevice"; pushDeviceId: string | null }
  | { type: "push.subscribe"; subscription: PushSubscribeRequestPayload; label: string; userAgent: string }
  | { type: "push.unsubscribe"; pushDeviceId: string }
  | { type: "push.test" }
  | { type: "push.setProjectMute"; localPath: string; muted: boolean }
  | { type: "push.setChatMute"; chatId: string; muted: boolean }
  | { type: "push.setFocusedChat"; chatId: string | null }
  | ShareClientCommand

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
  | { type: "pty-instances"; data: PtyInstancesSnapshot }
  | { type: "workflows"; data: WorkflowsSnapshot }
  | { type: "boards"; data: BoardsSnapshot }
  | { type: "board"; data: BoardSnapshot }
  | { type: "followed-sessions"; data: FollowedSessionsSnapshot }
  | { type: "cron-jobs"; data: import("./cron/types").CronJobsGlobalSnapshot }
  | { type: "background-task-output"; data: BackgroundTaskOutputSnapshot }

export interface BoardsSnapshot {
  ownerKind: BoardOwnerKind
  ownerId: string
  boards: BoardSummary[]
}

export interface BoardSnapshot {
  boardId: string
  /** Null when the board was archived or never existed. */
  view: BoardViewSnapshot | null
}

export type ServerEnvelope =
  | { v: 1; type: "snapshot"; id: string; snapshot: ServerSnapshot }
  | { v: 1; type: "event"; id: string; event: WsEvent }
  | { v: 1; type: "ack"; id: string; result?: AnyValue | ChatHistoryPage }
  | { v: 1; type: "error"; id?: string; message: string }

export function isClientEnvelope(value: AnyValue): value is ClientEnvelope {
  if (!isRecord(value)) return false
  return value.v === 1 && typeof value.type === "string"
}
