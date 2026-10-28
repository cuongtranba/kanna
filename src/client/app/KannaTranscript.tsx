import { Inbox, Webhook } from "lucide-react"
import React, { memo, useLayoutEffect, useMemo, useRef } from "react"
import type { HydratedToolCall, HydratedTranscriptMessage, AutoContinueSchedule } from "../../shared/types"
import { UserMessage } from "../components/messages/UserMessage"
import { RawJsonMessage } from "../components/messages/RawJsonMessage"
import { SystemMessage } from "../components/messages/SystemMessage"
import { AccountInfoMessage } from "../components/messages/AccountInfoMessage"
import { CronArmedMessage } from "../components/messages/CronArmedMessage"
import { CronCommandErrorMessage } from "../components/messages/CronCommandErrorMessage"
import { CronJobChangeMessage } from "../components/messages/CronJobChangeMessage"
import { CronListMessage } from "../components/messages/CronListMessage"
import { CronRunMessage } from "../components/messages/CronRunMessage"
import { DeliveryMessage } from "../components/messages/DeliveryMessage"
import { CronRunSkippedMessage } from "../components/messages/CronRunSkippedMessage"
import { TextMessage } from "../components/messages/TextMessage"
import { ThinkingMessage } from "../components/messages/ThinkingMessage"
import { ApiErrorMessage } from "../components/messages/ApiErrorMessage"
import { PolicyRefusalMessage } from "../components/messages/PolicyRefusalMessage"
import { AskUserQuestionMessage } from "../components/messages/AskUserQuestionMessage"
import { ExitPlanModeMessage } from "../components/messages/ExitPlanModeMessage"
import { TodoWriteMessage } from "../components/messages/TodoWriteMessage"
import { ToolCallMessage } from "../components/messages/ToolCallMessage"
import { OfferDownloadMessage } from "../components/messages/OfferDownloadMessage"
import { PreviewFileMessage } from "../components/messages/PreviewFileMessage"
import { ImageGenerationMessage } from "../components/messages/ImageGenerationMessage"
import { ResultMessage } from "../components/messages/ResultMessage"
import { InterruptedMessage } from "../components/messages/InterruptedMessage"
import { LoopDisarmedMessage } from "../components/messages/LoopDisarmedMessage"
import { CompactBoundaryMessage, ContextClearedMessage } from "../components/messages/CompactBoundaryMessage"
import { MemoryLoadedMessage } from "../components/messages/MemoryLoadedMessage"
import { CompactSummaryMessage } from "../components/messages/CompactSummaryMessage"
import { StatusMessage } from "../components/messages/StatusMessage"
import { CollapsedToolGroup } from "../components/messages/CollapsedToolGroup"
import { AutoContinueCard } from "../components/chat-ui/AutoContinueCard"
import { PendingToolRequestMessage } from "../components/messages/PendingToolRequestMessage"
import { CHAT_SELECTION_ZONE_ATTRIBUTE } from "./chatFocusPolicy"
import type { CronJobSnapshot } from "../../shared/cron/types"
import { sameFields } from "../../shared/equality"
import { DELEGATE_SUBAGENT_TOOL_NAME } from "./subagent-run-placement"
import { PREVIEW_FILE_TOOL_NAME } from "../../shared/tools"
import { useTranscriptActions, type TranscriptActionsContextValue } from "./transcriptActionsContext"
import { SPECIAL_TRANSCRIPT_TOOL_NAMES, type LatestToolIds } from "./derived"

const RESULT_VISIBLE_AFTER_MS = 60_000

const SPECIAL_TOOL_NAMES = new Set<string>([
  ...Object.values(SPECIAL_TRANSCRIPT_TOOL_NAMES),
  DELEGATE_SUBAGENT_TOOL_NAME,
  PREVIEW_FILE_TOOL_NAME,
])

const SPECIAL_TOOL_KINDS = new Set<HydratedToolCall["toolKind"]>(["offer_download", "image_generation"])

export type TranscriptRenderItem =
  | { type: "single"; message: HydratedTranscriptMessage; index: number }
  | { type: "tool-group"; messages: HydratedTranscriptMessage[]; startIndex: number }

export interface ResolvedSingleTranscriptRow {
  kind: "single"
  id: string
  message: HydratedTranscriptMessage
  index: number
  isLoading: boolean
  localPath?: string
  isLatestAskUserQuestion: boolean
  isLatestExitPlanMode: boolean
}

export interface ResolvedToolGroupTranscriptRow {
  kind: "tool-group"
  id: string
  startIndex: number
  messages: HydratedTranscriptMessage[]
  isLoading: boolean
  localPath?: string
}

export type ResolvedTranscriptRow = ResolvedSingleTranscriptRow | ResolvedToolGroupTranscriptRow

export interface StableResolvedTranscriptRowsState {
  byId: Map<string, ResolvedTranscriptRow>
  result: ResolvedTranscriptRow[]
}

function isProcessedToolCall(message: HydratedTranscriptMessage): message is HydratedToolCall {
  return message.kind === "tool"
}

function isCollapsibleToolCall(message: HydratedTranscriptMessage) {
  if (!isProcessedToolCall(message)) return false
  if (SPECIAL_TOOL_KINDS.has(message.toolKind)) return false
  return !SPECIAL_TOOL_NAMES.has(message.toolName)
}

function isMessageVisible(
  messages: HydratedTranscriptMessage[],
  index: number,
  latestToolIds: LatestToolIds,
): boolean {
  const message = messages[index]
  if (message.hidden) return false

  switch (message.kind) {
    case "system_init":
      return messages.findIndex((entry) => entry.kind === "system_init") === index
    case "account_info":
      return messages.findIndex((entry) => entry.kind === "account_info") === index
    case "tool":
      return message.toolKind !== "todo_write" || message.id === latestToolIds.todoWrite
    case "result": {
      const adjacentToClear = messages[index - 1]?.kind === "context_cleared" || messages[index + 1]?.kind === "context_cleared"
      return !adjacentToClear && (!message.success || message.durationMs > RESULT_VISIBLE_AFTER_MS)
    }
    case "context_window_updated":
      return false
    case "status":
      return index === messages.length - 1
    default:
      return true
  }
}

function buildTranscriptRenderItems(
  messages: HydratedTranscriptMessage[],
  visible: boolean[],
): TranscriptRenderItem[] {
  const result: TranscriptRenderItem[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]
    if (visible[index] && isCollapsibleToolCall(message)) {
      const group: HydratedTranscriptMessage[] = [message]
      const startIndex = index
      index += 1

      while (index < messages.length) {
        const nextMessage = messages[index]
        if (!visible[index]) {
          index += 1
          continue
        }
        if (!isCollapsibleToolCall(nextMessage)) break
        group.push(nextMessage)
        index += 1
      }

      if (group.length >= 2) {
        result.push({ type: "tool-group", messages: group, startIndex })
      } else {
        result.push({ type: "single", message, index: startIndex })
      }
      continue
    }

    result.push({ type: "single", message, index })
    index += 1
  }

  return result
}

function getTranscriptRenderItemId(item: TranscriptRenderItem) {
  if (item.type === "single") {
    return item.message.id
  }

  const firstId = item.messages[0]?.id ?? item.startIndex
  return `tool-group:${firstId}`
}

const MESSAGE_FIELDS_IGNORED_FOR_EQUALITY = ["timestamp", "messageId"]

function sameMessage(left: HydratedTranscriptMessage, right: HydratedTranscriptMessage) {
  return left.kind === right.kind && sameFields(left, right, MESSAGE_FIELDS_IGNORED_FOR_EQUALITY)
}

function isResolvedTranscriptRowUnchanged(left: ResolvedTranscriptRow, right: ResolvedTranscriptRow) {
  if (left.kind !== right.kind || left.id !== right.id) return false

  if (left.kind === "single" && right.kind === "single") {
    return left.index === right.index
      && left.isLoading === right.isLoading
      && left.localPath === right.localPath
      && left.isLatestAskUserQuestion === right.isLatestAskUserQuestion
      && left.isLatestExitPlanMode === right.isLatestExitPlanMode
      && sameMessage(left.message, right.message)
  }

  if (left.kind === "tool-group" && right.kind === "tool-group") {
    return left.startIndex === right.startIndex
      && left.isLoading === right.isLoading
      && left.localPath === right.localPath
      && left.messages.length === right.messages.length
      && left.messages.every((message, index) => sameMessage(message, right.messages[index]!))
  }

  return false
}

export function computeStableResolvedTranscriptRows(
  rows: ResolvedTranscriptRow[],
  previous: StableResolvedTranscriptRowsState,
): StableResolvedTranscriptRowsState {
  const nextById = new Map<string, ResolvedTranscriptRow>()
  let anyChanged = rows.length !== previous.byId.size

  const result = rows.map((row, index) => {
    const previousRow = previous.byId.get(row.id)
    const nextRow = previousRow && isResolvedTranscriptRowUnchanged(previousRow, row) ? previousRow : row
    nextById.set(row.id, nextRow)
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true
    }
    return nextRow
  })

  return anyChanged ? { byId: nextById, result } : previous
}

export function useStableResolvedRows(rows: ResolvedTranscriptRow[]) {
  const previousState = useRef<StableResolvedTranscriptRowsState>({
    byId: new Map<string, ResolvedTranscriptRow>(),
    result: [],
  })

  const result = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs
    const nextState = computeStableResolvedTranscriptRows(rows, previousState.current)
    return nextState
  }, [rows])

  useLayoutEffect(() => {
    previousState.current = result
  })

  return result.result
}

function pickSingleRowActions(actions: TranscriptActionsContextValue) {
  const {
    onAskUserQuestionSubmit,
    onExitPlanModeConfirm,
    onToolRequestAnswer,
    schedules,
    cronJobs,
    onAutoContinueAccept,
    onAutoContinueReschedule,
    onAutoContinueCancel,
    onRetryFailedTurn,
    onCronRemove,
    chatId,
  } = actions
  return {
    onAskUserQuestionSubmit,
    onExitPlanModeConfirm,
    onToolRequestAnswer,
    schedules,
    cronJobs,
    onAutoContinueAccept,
    onAutoContinueReschedule,
    onAutoContinueCancel,
    onRetryFailedTurn,
    onCronRemove,
    chatId,
  }
}

type SingleRowActions = ReturnType<typeof pickSingleRowActions>

interface TranscriptSingleRowProps {
  row: ResolvedSingleTranscriptRow
  actions: SingleRowActions
}

const TranscriptSingleRow = memo(({ row, actions }: TranscriptSingleRowProps) => {
  const { message, index, isLoading, localPath, isLatestAskUserQuestion, isLatestExitPlanMode } = row
  const {
    onAskUserQuestionSubmit,
    onExitPlanModeConfirm,
    onToolRequestAnswer,
    schedules,
    cronJobs,
    onAutoContinueAccept,
    onAutoContinueReschedule,
    onAutoContinueCancel,
    onRetryFailedTurn,
    onCronRemove,
    chatId,
  } = actions
  let rendered: React.ReactNode = null

  if (message.kind === "user_prompt") {
    rendered = <UserMessage key={message.id} content={message.content} attachments={message.attachments} steered={message.steered} autoContinue={message.autoContinue} expandedCommand={message.expandedCommand} origin={message.origin} />
  } else {
    switch (message.kind) {
      case "auto_continue_prompt": {
        const schedule = schedules[message.scheduleId]
        if (!schedule) {
          rendered = (
            <div key={message.id} className="rounded border px-3 py-2 text-sm opacity-70">
              Auto-continue expired
            </div>
          )
          break
        }
        rendered = (
          <AutoContinueCard
            key={message.id}
            schedule={schedule}
            onAccept={(scheduledAt) => onAutoContinueAccept(message.scheduleId, scheduledAt)}
            onReschedule={(scheduledAt) => onAutoContinueReschedule(message.scheduleId, scheduledAt)}
            onCancel={() => onAutoContinueCancel(message.scheduleId)}
          />
        )
        break
      }
      case "unknown":
        rendered = <RawJsonMessage key={message.id} json={message.json} />
        break
      case "system_init":
        rendered = <SystemMessage key={message.id} message={message} rawJson={message.debugRaw} />
        break
      case "account_info":
        rendered = <AccountInfoMessage key={message.id} message={message} />
        break
      case "assistant_text":
        rendered = <TextMessage key={message.id} message={message} />
        break
      case "assistant_thinking":
        rendered = <ThinkingMessage key={message.id} message={message} />
        break
      case "api_error":
        rendered = <ApiErrorMessage key={message.id} message={message} />
        break
      case "policy_refusal":
        rendered = <PolicyRefusalMessage key={message.id} message={message} />
        break
      case "tool":
        if (message.isError) {
          rendered = <ToolCallMessage key={message.id} message={message} isLoading={isLoading} localPath={localPath} chatId={chatId} />
          break
        }
        if (message.toolKind === "ask_user_question") {
          rendered = (
            <AskUserQuestionMessage
              key={message.id}
              message={message}
              onSubmit={onAskUserQuestionSubmit}
              isLatest={isLatestAskUserQuestion}
            />
          )
          break
        }
        if (message.toolKind === "exit_plan_mode") {
          rendered = (
            <ExitPlanModeMessage
              key={message.id}
              message={message}
              onConfirm={onExitPlanModeConfirm}
              isLatest={isLatestExitPlanMode}
            />
          )
          break
        }
        if (message.toolKind === "todo_write") {
          rendered = <TodoWriteMessage key={message.id} message={message} />
          break
        }
        if (message.toolKind === "offer_download" && message.result) {
          rendered = <OfferDownloadMessage key={message.id} message={message} />
          break
        }
        if (message.toolKind === "preview_file" && message.result) {
          rendered = <PreviewFileMessage key={message.id} message={message} />
          break
        }
        if (message.toolKind === "image_generation") {
          rendered = <ImageGenerationMessage key={message.id} message={message} />
          break
        }
        rendered = <ToolCallMessage key={message.id} message={message} isLoading={isLoading} localPath={localPath} chatId={chatId} />
        break
      case "result":
        rendered = <ResultMessage key={message.id} message={message} onRetry={onRetryFailedTurn} />
        break
      case "interrupted":
        rendered = <InterruptedMessage key={message.id} message={message} />
        break
      case "compact_boundary":
        rendered = <CompactBoundaryMessage key={message.id} />
        break
      case "context_cleared":
        rendered = <ContextClearedMessage key={message.id} />
        break
      case "memory_loaded":
        rendered = <MemoryLoadedMessage key={message.id} message={message} />
        break
      case "compact_summary":
        rendered = <CompactSummaryMessage key={message.id} message={message} />
        break
      case "status":
        rendered = <StatusMessage key={message.id} message={message} />
        break
      case "pending_tool_request":
        rendered = (
          <PendingToolRequestMessage
            key={message.id}
            entry={message}
            onAnswer={onToolRequestAnswer}
          />
        )
        break
      case "cron_armed":
        rendered = <CronArmedMessage key={message.id} message={message} chatId={chatId} onRemove={onCronRemove} />
        break
      case "cron_command_error":
        rendered = <CronCommandErrorMessage key={message.id} message={message} />
        break
      case "cron_run":
        rendered = <CronRunMessage key={message.id} message={message} cronJobs={cronJobs} />
        break
      case "cron_run_skipped":
        rendered = <CronRunSkippedMessage key={message.id} message={message} />
        break
      case "cron_list":
        rendered = <CronListMessage key={message.id} message={message} cronJobs={cronJobs} />
        break
      case "cron_job_change":
        rendered = <CronJobChangeMessage key={message.id} message={message} />
        break
      case "webhook_delivery":
        rendered = <DeliveryMessage key={message.id} icon={Webhook} title="Webhook" name={message.hookName} delivery={message} />
        break
      case "inbound_delivery":
        rendered = <DeliveryMessage key={message.id} icon={Inbox} title="Inbound" name={message.sourceName} delivery={message} />
        break
      case "loop_disarmed":
        rendered = <LoopDisarmedMessage key={message.id} message={message} />
        break
    }
  }

  if (!rendered) return null
  return (
    <div
      id={`msg-${message.id}`}
      className="group relative"
      data-index={index}
      {...{ [CHAT_SELECTION_ZONE_ATTRIBUTE]: "" }}
    >
      {rendered}
    </div>
  )
}, (prev, next) => prev.row === next.row && sameFields(prev.actions, next.actions))

interface TranscriptToolGroupProps {
  row: ResolvedToolGroupTranscriptRow
  expanded: boolean
  onExpandedChange: (groupId: string, next: boolean) => void
  chatId?: string
}

const TranscriptToolGroup = memo(({ row, expanded, onExpandedChange, chatId }: TranscriptToolGroupProps) => {
  return (
    <div
      className="group relative"
      {...{ [CHAT_SELECTION_ZONE_ATTRIBUTE]: "" }}
    >
      <CollapsedToolGroup
        messages={row.messages}
        isLoading={row.isLoading}
        localPath={row.localPath}
        expanded={expanded}
        onExpandedChange={(next) => onExpandedChange(row.id, next)}
        chatId={chatId}
      />
    </div>
  )
})

export function buildResolvedTranscriptRows(
  messages: HydratedTranscriptMessage[],
  {
    isLoading,
    localPath,
    latestToolIds,
  }: {
    isLoading: boolean
    localPath?: string
    latestToolIds: LatestToolIds
  }
): ResolvedTranscriptRow[] {
  const visible = messages.map((_, index) => isMessageVisible(messages, index, latestToolIds))
  const renderItems = buildTranscriptRenderItems(messages, visible)
  const rows: ResolvedTranscriptRow[] = []

  for (const item of renderItems) {
    if (item.type === "tool-group") {
      rows.push({
        kind: "tool-group",
        id: getTranscriptRenderItemId(item),
        startIndex: item.startIndex,
        messages: item.messages,
        isLoading: isLoading && item.messages.some((message) => message.kind === "tool" && message.result === undefined),
        localPath,
      })
      continue
    }

    if (!visible[item.index]) continue
    rows.push({
      kind: "single",
      id: getTranscriptRenderItemId(item),
      message: item.message,
      index: item.index,
      isLoading: item.message.kind === "tool" && item.message.result === undefined && isLoading,
      localPath,
      isLatestAskUserQuestion: item.message.id === latestToolIds.askUserQuestion,
      isLatestExitPlanMode: item.message.id === latestToolIds.exitPlanMode,
    })
  }

  return rows
}

interface KannaTranscriptRowProps {
  row: ResolvedTranscriptRow
  toolGroupExpanded?: boolean
}

export const KannaTranscriptRow = memo(({
  row,
  toolGroupExpanded,
}: KannaTranscriptRowProps) => {
  const actions = useTranscriptActions()

  if (row.kind === "tool-group") {
    return (
      <TranscriptToolGroup
        row={row}
        expanded={toolGroupExpanded ?? false}
        onExpandedChange={actions.onToolGroupExpandedChange}
        chatId={actions.chatId}
      />
    )
  }

  return <TranscriptSingleRow row={row} actions={pickSingleRowActions(actions)} />
}, (prev, next) => prev.row === next.row && prev.toolGroupExpanded === next.toolGroupExpanded)

export const EMPTY_SCHEDULES: Record<string, AutoContinueSchedule> = {}
export const EMPTY_CRON_JOBS: readonly CronJobSnapshot[] = []
