import type { AgentProvider, KannaStatus, NormalizedToolCall, SlashCommand } from "../shared/types"
import type { ClaudeSessionHandle, HarnessTurn } from "./harness-types"
import { mergeBackgroundTaskSnapshot, toolCallCommand, toolCallDescription } from "./claude-prompt-helpers"

const RECENT_TOOL_CALL_LIMIT = 64

export interface SessionBackgroundTask {
  taskType: string | null
  description: string | null
  startedAt: number
  outputPath: string | null
  command: string | null
}

export interface RecentToolCall {
  description: string | null
  command: string | null
}

export interface StartingTurn {
  chatId: string
  provider: AgentProvider
  startedAt: number
  cancelRequested: boolean
}

export type CompactionTurnKind = "proactive" | "user" | "codex_summary"

export function isCliCompactTurn(turn: Pick<ActiveTurn, "compactionTurn"> | undefined): boolean {
  return turn?.compactionTurn === "proactive" || turn?.compactionTurn === "user"
}

export function isProactiveCompactTurn(turn: Pick<ActiveTurn, "compactionTurn"> | undefined): boolean {
  return turn?.compactionTurn === "proactive"
}

export interface ActiveTurn {
  chatId: string
  provider: AgentProvider
  turn: HarnessTurn
  startedAt: number
  sessionId?: string
  claudePromptSeq?: number
  model: string
  effort?: string
  serviceTier?: "fast"
  planMode: boolean
  status: KannaStatus
  postToolFollowUp: { content: string; planMode: boolean } | null
  hasFinalResult: boolean
  cancelRequested: boolean
  cancelRecorded: boolean
  clientTraceId?: string
  profilingStartedAt?: number
  waitStartedAt: number | null
  compactionTurn?: CompactionTurnKind
  cronRun?: import("../shared/cron/types").CronRunTag
  usage?: import("../shared/subagent-types").ProviderUsage
  userMessageId: string | null
}

export interface ClaudeSessionStateInit {
  id: string
  chatId: string
  session: ClaudeSessionHandle
  localPath: string
  additionalDirectories: string[]
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  accountInfoLoaded: boolean
  nextPromptSeq: number
  pendingPromptSeqs: number[]
  activeTokenId: string | null
  oauthKeyMasked: string | null
  oauthLabel: string | null
  openrouterKeyMasked: string | null
  openrouterModel: string | null
  lastUsedAt: number
  backgroundTasks: Map<string, SessionBackgroundTask>
  backgroundTaskDeadlineAt: number
  backgroundTaskWakeCount: number
  backgroundTasksLevelSourced: boolean
  selfWakeActive: boolean
  recentToolCalls: Map<string, RecentToolCall>
  backgroundLaunchToolIds: Set<string>
  loopArmedAtSpawn: boolean
  cancelledResultPending: number
  suppressSessionTokenPersist: boolean
  backgroundTaskWakeSuppressed: boolean
  workflowsDirRegistered?: boolean
}

type BackgroundTaskMeta = { id: string; taskType: string | null; description: string | null }

export class ClaudeSessionState {
  id: string
  chatId: string
  session: ClaudeSessionHandle
  localPath: string
  additionalDirectories: string[]
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  accountInfoLoaded: boolean
  nextPromptSeq: number
  pendingPromptSeqs: number[]
  activeTokenId: string | null
  oauthKeyMasked: string | null
  oauthLabel: string | null
  openrouterKeyMasked: string | null
  openrouterModel: string | null
  lastUsedAt: number
  backgroundTasks: Map<string, SessionBackgroundTask>
  backgroundTaskDeadlineAt: number
  backgroundTaskWakeCount: number
  backgroundTasksLevelSourced: boolean
  selfWakeActive: boolean
  recentToolCalls: Map<string, RecentToolCall>
  backgroundLaunchToolIds: Set<string>
  loopArmedAtSpawn: boolean
  workflowsDirRegistered?: boolean
  cancelledResultPending: number
  suppressSessionTokenPersist: boolean
  backgroundTaskWakeSuppressed: boolean

  constructor(init: ClaudeSessionStateInit) {
    this.id = init.id
    this.chatId = init.chatId
    this.session = init.session
    this.localPath = init.localPath
    this.additionalDirectories = init.additionalDirectories
    this.model = init.model
    this.effort = init.effort
    this.planMode = init.planMode
    this.sessionToken = init.sessionToken
    this.accountInfoLoaded = init.accountInfoLoaded
    this.nextPromptSeq = init.nextPromptSeq
    this.pendingPromptSeqs = init.pendingPromptSeqs
    this.activeTokenId = init.activeTokenId
    this.oauthKeyMasked = init.oauthKeyMasked
    this.oauthLabel = init.oauthLabel
    this.openrouterKeyMasked = init.openrouterKeyMasked
    this.openrouterModel = init.openrouterModel
    this.lastUsedAt = init.lastUsedAt
    this.backgroundTasks = init.backgroundTasks
    this.backgroundTaskDeadlineAt = init.backgroundTaskDeadlineAt
    this.backgroundTaskWakeCount = init.backgroundTaskWakeCount
    this.backgroundTasksLevelSourced = init.backgroundTasksLevelSourced
    this.selfWakeActive = init.selfWakeActive
    this.recentToolCalls = init.recentToolCalls
    this.backgroundLaunchToolIds = init.backgroundLaunchToolIds
    this.loopArmedAtSpawn = init.loopArmedAtSpawn
    this.workflowsDirRegistered = init.workflowsDirRegistered
    this.cancelledResultPending = init.cancelledResultPending
    this.suppressSessionTokenPersist = init.suppressSessionTokenPersist
    this.backgroundTaskWakeSuppressed = init.backgroundTaskWakeSuppressed
  }


  isHoldingWork(now: number): boolean {
    if (this.backgroundTasks.size === 0) return false
    if (this.backgroundTasksLevelSourced) return true
    return now < this.backgroundTaskDeadlineAt
  }

  guardExpired(now: number): boolean {
    if (this.backgroundTasks.size === 0) return false
    if (this.backgroundTasksLevelSourced) return false
    return now >= this.backgroundTaskDeadlineAt
  }

  noteUserSend(maxMs: number, now: number): void {
    if (this.backgroundTasks.size > 0) {
      this.backgroundTaskDeadlineAt = now + maxMs
      this.backgroundTaskWakeCount = 0
    }
    this.backgroundTaskWakeSuppressed = false
  }

  noteToolCall(tool: NormalizedToolCall): void {
    const description = toolCallDescription(tool)
    const command = toolCallCommand(tool)
    if (description !== null || command !== null) {
      this.recentToolCalls.set(tool.toolId, { description, command })
      while (this.recentToolCalls.size > RECENT_TOOL_CALL_LIMIT) {
        const oldest = this.recentToolCalls.keys().next().value
        if (oldest === undefined) break
        this.recentToolCalls.delete(oldest)
      }
    }
    if (
      (tool.toolKind === "bash" && tool.input.runInBackground === true)
      || tool.toolKind === "subagent_task"
      || tool.toolKind === "workflow"
    ) {
      this.backgroundLaunchToolIds.add(tool.toolId)
    }
  }

  noteLaunch(
    launches: Array<{ id: string; outputPath: string | null }>,
    launchedBy: RecentToolCall | null,
    maxMs: number,
    now: number,
  ): Array<{ id: string; outputPath: string | null }> {
    if (launches.length === 0) return []

    if (this.backgroundTasks.size === 0) this.backgroundTaskWakeCount = 0

    const added: Array<{ id: string; outputPath: string | null }> = []
    for (const { id, outputPath } of launches) {
      const existing = this.backgroundTasks.get(id)
      if (!existing) {
        this.backgroundTasks.set(id, {
          taskType: null,
          description: launchedBy?.description ?? null,
          startedAt: now,
          outputPath,
          command: launchedBy?.command ?? null,
        })
        added.push({ id, outputPath })
      } else {
        const command = existing.command ?? launchedBy?.command ?? null
        const enrichedPath = existing.outputPath === null && outputPath !== null
        if (enrichedPath || command !== existing.command) {
          this.backgroundTasks.set(id, {
            ...existing,
            outputPath: existing.outputPath ?? outputPath,
            command,
          })
        }
        if (enrichedPath) added.push({ id, outputPath })
      }
    }

    if (added.length > 0 || launches.length > 0) {
      this.backgroundTaskDeadlineAt = now + maxMs
    }

    return added
  }

  noteSettle(settledId: string, maxMs: number, now: number): void {
    this.backgroundTasks.delete(settledId)
    if (this.backgroundTasks.size > 0) {
      this.backgroundTaskDeadlineAt = now + maxMs
    } else {
      this.backgroundTaskDeadlineAt = 0
    }
  }

  applyLevelSnapshot(
    ids: string[],
    snapshot: readonly BackgroundTaskMeta[] | undefined,
    maxMs: number,
    now: number,
  ): void {
    this.backgroundTasksLevelSourced = true
    const wasEmpty = this.backgroundTasks.size === 0
    this.backgroundTasks = mergeBackgroundTaskSnapshot(this.backgroundTasks, ids, snapshot, now)
    if (wasEmpty && this.backgroundTasks.size > 0) this.backgroundTaskWakeCount = 0
    this.backgroundTaskDeadlineAt = this.backgroundTasks.size > 0 ? now + maxMs : 0
  }

  hasBackgroundTasks(): boolean {
    return this.backgroundTasks.size > 0
  }

  getBackgroundTaskEntries(): Array<[string, SessionBackgroundTask]> {
    return [...this.backgroundTasks.entries()]
  }

  getBackgroundTaskIds(): string[] {
    return [...this.backgroundTasks.keys()]
  }

  abandonBackgroundTasks(): string[] {
    const ids = [...this.backgroundTasks.keys()]
    this.backgroundTasks.clear()
    this.backgroundTaskDeadlineAt = 0
    return ids
  }
}

export type { SlashCommand }
