import { createContext, useContext, type ReactNode } from "react"
import type { AskUserQuestionItem } from "../components/messages/types"
import type { AskUserQuestionAnswerMap, AutoContinueSchedule, QueuedChatMessage, ChatBackgroundTask } from "../../shared/types"
import type { CronJobSnapshot } from "../../shared/cron/types"
import type { ToolRequestDecision } from "../../shared/permission-policy"
import type { SubagentRunSnapshot, LoopProgressSnapshot } from "../../shared/subagent-types"
import type { EditorPreset } from "../../shared/protocol"
import type { CloudflareTunnelRecord } from "../../shared/settings/cloudflare-tunnel"
import type { WorkflowRunSummary, WorkflowRun } from "../../shared/workflow-types"
import type { GetSubagentTranscript } from "../components/messages/subagent-fetch-context"
import type { KannaState } from "./useKannaState"

export interface TranscriptActionsContextValue {
  onAskUserQuestionSubmit: (toolUseId: string, questions: AskUserQuestionItem[], answers: AskUserQuestionAnswerMap) => void | Promise<void>
  onExitPlanModeConfirm: (toolUseId: string, confirmed: boolean, clearContext?: boolean, message?: string) => void
  onToolRequestAnswer: (toolRequestId: string, decision: ToolRequestDecision) => void
  onAutoContinueAccept: (scheduleId: string, scheduledAt: number) => void
  onAutoContinueReschedule: (scheduleId: string, scheduledAt: number) => void
  onAutoContinueCancel: (scheduleId: string) => void
  onRetryFailedTurn: ((resultMessageId: string) => void | Promise<void>) | undefined
  onCronRemove: ((jobId: string) => void) | undefined
  schedules: Record<string, AutoContinueSchedule>
  cronJobs: readonly CronJobSnapshot[]
  chatId: string | undefined
  onToolGroupExpandedChange: (groupId: string, next: boolean) => void
  onSubagentAskUserQuestionSubmit?: (runId: string, toolUseId: string, questions: AskUserQuestionItem[], answers: AskUserQuestionAnswerMap) => Promise<void>
  onSubagentExitPlanModeSubmit?: (runId: string, toolUseId: string, response: { confirmed: boolean; clearContext?: boolean; message?: string }) => Promise<void>
  subagentRuns: Record<string, SubagentRunSnapshot>
  editorPreset: EditorPreset
  editorCommandTemplate: string | undefined
  onCancelSubagentRun?: (chatId: string, runId: string) => void
  getSubagentTranscript?: GetSubagentTranscript
  platform: string
  tunnels?: Record<string, CloudflareTunnelRecord>
  liveTunnelId?: string | null
  onTunnelAccept?: (tunnelId: string) => void | Promise<void>
  onTunnelStop?: (tunnelId: string) => void | Promise<void>
  onTunnelRetry?: (tunnelId: string) => void | Promise<void>
  queuedMessages: QueuedChatMessage[]
  runtimeStatus: string | null
  isDraining: boolean
  commandError: string | null
  onStopDraining: () => void | Promise<void>
  onSteerQueuedMessage: (queuedMessageId: string) => void | Promise<void>
  onRemoveQueuedMessage: (queuedMessageId: string) => void | Promise<void>
  loopProgress?: LoopProgressSnapshot
  workflowRuns?: WorkflowRunSummary[]
  backgroundTasks?: ChatBackgroundTask[]
  getWorkflowRunDetail?: (runId: string) => Promise<WorkflowRun | null>
  onCronPause?: (jobId: string) => void
  onCronResume?: (jobId: string) => void
  localPath: string | null | undefined
  latestToolIds: KannaState["latestToolIds"]
  isProcessing: boolean
}

const NOOP = () => {}

const defaultContextValue: TranscriptActionsContextValue = {
  onAskUserQuestionSubmit: NOOP,
  onExitPlanModeConfirm: NOOP,
  onToolRequestAnswer: NOOP,
  onAutoContinueAccept: NOOP,
  onAutoContinueReschedule: NOOP,
  onAutoContinueCancel: NOOP,
  onRetryFailedTurn: undefined,
  onCronRemove: undefined,
  schedules: {},
  cronJobs: [],
  chatId: undefined,
  onToolGroupExpandedChange: NOOP,
  subagentRuns: {},
  editorPreset: "cursor",
  editorCommandTemplate: undefined,
  platform: "darwin",
  queuedMessages: [],
  runtimeStatus: null,
  isDraining: false,
  commandError: null,
  onStopDraining: NOOP,
  onSteerQueuedMessage: NOOP,
  onRemoveQueuedMessage: NOOP,
  localPath: undefined,
  latestToolIds: {},
  isProcessing: false,
}

export const TranscriptActionsContext = createContext<TranscriptActionsContextValue>(defaultContextValue)

export function useTranscriptActions(): TranscriptActionsContextValue {
  return useContext(TranscriptActionsContext)
}

export function TranscriptActionsProvider({
  value,
  children,
}: {
  value: TranscriptActionsContextValue
  children: ReactNode
}) {
  return <TranscriptActionsContext.Provider value={value}>{children}</TranscriptActionsContext.Provider>
}
