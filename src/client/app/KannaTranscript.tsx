import React, { memo, useMemo } from "react"
import type { AskUserQuestionItem, ProcessedToolCall } from "../components/messages/types"
import type { AskUserQuestionAnswerMap, HydratedTranscriptMessage } from "../../shared/types"
import { UserMessage } from "../components/messages/UserMessage"
import { RawJsonMessage } from "../components/messages/RawJsonMessage"
import { SystemMessage } from "../components/messages/SystemMessage"
import { AccountInfoMessage } from "../components/messages/AccountInfoMessage"
import { TextMessage } from "../components/messages/TextMessage"
import { AskUserQuestionMessage } from "../components/messages/AskUserQuestionMessage"
import { ExitPlanModeMessage } from "../components/messages/ExitPlanModeMessage"
import { TodoWriteMessage } from "../components/messages/TodoWriteMessage"
import { ToolCallMessage } from "../components/messages/ToolCallMessage"
import { ResultMessage } from "../components/messages/ResultMessage"
import { InterruptedMessage } from "../components/messages/InterruptedMessage"
import { CompactBoundaryMessage, ContextClearedMessage } from "../components/messages/CompactBoundaryMessage"
import { CompactSummaryMessage } from "../components/messages/CompactSummaryMessage"
import { StatusMessage } from "../components/messages/StatusMessage"
import { CollapsedToolGroup } from "../components/messages/CollapsedToolGroup"
import { OpenLocalLinkProvider } from "../components/messages/shared"
import { CHAT_SELECTION_ZONE_ATTRIBUTE } from "./chatFocusPolicy"

const SPECIAL_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode", "TodoWrite"])

export type TranscriptRenderItem =
  | { type: "single"; message: HydratedTranscriptMessage; index: number }
  | { type: "tool-group"; messages: HydratedTranscriptMessage[]; startIndex: number }

function isCollapsibleToolCall(message: HydratedTranscriptMessage) {
  if (message.kind !== "tool") return false
  const toolName = (message as ProcessedToolCall).toolName
  return !SPECIAL_TOOL_NAMES.has(toolName)
}

export function buildTranscriptRenderItems(messages: HydratedTranscriptMessage[]): TranscriptRenderItem[] {
  const result: TranscriptRenderItem[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]
    if (isCollapsibleToolCall(message)) {
      const group: HydratedTranscriptMessage[] = [message]
      const startIndex = index
      index += 1
      while (index < messages.length && isCollapsibleToolCall(messages[index])) {
        group.push(messages[index])
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

function sameStringArray(left: string[] | undefined, right: string[] | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function sameMessage(left: HydratedTranscriptMessage, right: HydratedTranscriptMessage) {
  if (left === right) return true
  if (left.kind !== right.kind || left.id !== right.id || left.hidden !== right.hidden) return false

  switch (left.kind) {
    case "user_prompt":
      return left.content === (right.kind === "user_prompt" ? right.content : null)
        && left.attachments?.length === (right.kind === "user_prompt" ? right.attachments?.length : null)
    case "system_init":
      return right.kind === "system_init"
        && left.provider === right.provider
        && left.model === right.model
        && sameStringArray(left.tools, right.tools)
        && sameStringArray(left.agents, right.agents)
        && sameStringArray(left.slashCommands, right.slashCommands)
        && left.debugRaw === right.debugRaw
    case "account_info":
      return right.kind === "account_info" && JSON.stringify(left.accountInfo) === JSON.stringify(right.accountInfo)
    case "assistant_text":
      return right.kind === "assistant_text" && left.text === right.text
    case "tool":
      return right.kind === "tool"
        && left.toolKind === right.toolKind
        && left.toolName === right.toolName
        && left.toolId === right.toolId
        && left.isError === right.isError
        && JSON.stringify(left.input) === JSON.stringify(right.input)
        && JSON.stringify(left.result) === JSON.stringify(right.result)
        && JSON.stringify(left.rawResult) === JSON.stringify(right.rawResult)
    case "result":
      return right.kind === "result"
        && left.success === right.success
        && left.cancelled === right.cancelled
        && left.result === right.result
        && left.durationMs === right.durationMs
        && left.costUsd === right.costUsd
    case "status":
      return right.kind === "status" && left.status === right.status
    case "compact_summary":
      return right.kind === "compact_summary" && left.summary === right.summary
    case "context_window_updated":
      return right.kind === "context_window_updated" && JSON.stringify(left.usage) === JSON.stringify(right.usage)
    case "compact_boundary":
    case "context_cleared":
    case "interrupted":
      return true
    case "unknown":
      return right.kind === "unknown" && left.json === right.json
  }
}

interface TranscriptSingleRowProps {
  message: HydratedTranscriptMessage
  index: number
  isLoading: boolean
  localPath?: string
  isFirstSystem: boolean
  isFirstAccount: boolean
  isLatestAskUserQuestion: boolean
  isLatestExitPlanMode: boolean
  isLatestTodoWrite: boolean
  hideResult: boolean
  isFinalStatus: boolean
  onAskUserQuestionSubmit: (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap
  ) => void
  onExitPlanModeConfirm: (toolUseId: string, confirmed: boolean, clearContext?: boolean, message?: string) => void
}

const TranscriptSingleRow = memo(function TranscriptSingleRow({
  message,
  index,
  isLoading,
  localPath,
  isFirstSystem,
  isFirstAccount,
  isLatestAskUserQuestion,
  isLatestExitPlanMode,
  isLatestTodoWrite,
  hideResult,
  isFinalStatus,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
}: TranscriptSingleRowProps) {
  let rendered: React.ReactNode = null

  if (message.kind === "user_prompt") {
    rendered = <UserMessage key={message.id} content={message.content} attachments={message.attachments} />
  } else {
    switch (message.kind) {
      case "unknown":
        rendered = <RawJsonMessage key={message.id} json={message.json} />
        break
      case "system_init":
        rendered = isFirstSystem ? <SystemMessage key={message.id} message={message} rawJson={message.debugRaw} /> : null
        break
      case "account_info":
        rendered = isFirstAccount ? <AccountInfoMessage key={message.id} message={message} /> : null
        break
      case "assistant_text":
        rendered = <TextMessage key={message.id} message={message} />
        break
      case "tool":
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
          rendered = isLatestTodoWrite ? <TodoWriteMessage key={message.id} message={message} /> : null
          break
        }
        rendered = <ToolCallMessage key={message.id} message={message} isLoading={isLoading} localPath={localPath} />
        break
      case "result":
        rendered = hideResult ? null : <ResultMessage key={message.id} message={message} />
        break
      case "context_window_updated":
        rendered = null
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
      case "compact_summary":
        rendered = <CompactSummaryMessage key={message.id} message={message} />
        break
      case "status":
        rendered = isFinalStatus ? <StatusMessage key={message.id} message={message} /> : null
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
}, (prev, next) => (
  prev.index === next.index
  && prev.isLoading === next.isLoading
  && prev.localPath === next.localPath
  && prev.isFirstSystem === next.isFirstSystem
  && prev.isFirstAccount === next.isFirstAccount
  && prev.isLatestAskUserQuestion === next.isLatestAskUserQuestion
  && prev.isLatestExitPlanMode === next.isLatestExitPlanMode
  && prev.isLatestTodoWrite === next.isLatestTodoWrite
  && prev.hideResult === next.hideResult
  && prev.isFinalStatus === next.isFinalStatus
  && prev.onAskUserQuestionSubmit === next.onAskUserQuestionSubmit
  && prev.onExitPlanModeConfirm === next.onExitPlanModeConfirm
  && sameMessage(prev.message, next.message)
))

interface TranscriptToolGroupProps {
  startIndex: number
  messages: HydratedTranscriptMessage[]
  isLoading: boolean
  localPath?: string
}

const TranscriptToolGroup = memo(function TranscriptToolGroup({
  startIndex,
  messages,
  isLoading,
  localPath,
}: TranscriptToolGroupProps) {
  return (
    <div
      className="group relative"
      {...{ [CHAT_SELECTION_ZONE_ATTRIBUTE]: "" }}
    >
      <CollapsedToolGroup messages={messages} isLoading={isLoading} localPath={localPath} />
    </div>
  )
}, (prev, next) => (
  prev.startIndex === next.startIndex
  && prev.isLoading === next.isLoading
  && prev.localPath === next.localPath
  && prev.messages.length === next.messages.length
  && prev.messages.every((message, index) => sameMessage(message, next.messages[index]!))
))

interface KannaTranscriptProps {
  messages: HydratedTranscriptMessage[]
  isLoading: boolean
  localPath?: string
  latestToolIds: Record<string, string | null>
  onOpenLocalLink: (target: { path: string; line?: number; column?: number }) => void
  onAskUserQuestionSubmit: (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap
  ) => void
  onExitPlanModeConfirm: (toolUseId: string, confirmed: boolean, clearContext?: boolean, message?: string) => void
}

interface KannaTranscriptRowProps {
  item: TranscriptRenderItem
  messages: HydratedTranscriptMessage[]
  isLoading: boolean
  localPath?: string
  latestToolIds: Record<string, string | null>
  firstSystemIndex: number
  firstAccountIndex: number
  onAskUserQuestionSubmit: (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap
  ) => void
  onExitPlanModeConfirm: (toolUseId: string, confirmed: boolean, clearContext?: boolean, message?: string) => void
}

export const KannaTranscriptRow = memo(function KannaTranscriptRow({
  item,
  messages,
  isLoading,
  localPath,
  latestToolIds,
  firstSystemIndex,
  firstAccountIndex,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
}: KannaTranscriptRowProps) {
  if (item.type === "tool-group") {
    const groupIsLoading = isLoading && item.messages.some((message) => message.kind === "tool" && message.result === undefined)
    return (
      <TranscriptToolGroup
        startIndex={item.startIndex}
        messages={item.messages}
        isLoading={groupIsLoading}
        localPath={localPath}
      />
    )
  }

  const previousMessage = messages[item.index - 1]
  const nextMessage = messages[item.index + 1]
  const rowIsLoading = item.message.kind === "tool" && item.message.result === undefined && isLoading
  return (
    <TranscriptSingleRow
      message={item.message}
      index={item.index}
      isLoading={rowIsLoading}
      localPath={localPath}
      isFirstSystem={firstSystemIndex === item.index}
      isFirstAccount={firstAccountIndex === item.index}
      isLatestAskUserQuestion={item.message.id === latestToolIds.AskUserQuestion}
      isLatestExitPlanMode={item.message.id === latestToolIds.ExitPlanMode}
      isLatestTodoWrite={item.message.id === latestToolIds.TodoWrite}
      hideResult={nextMessage?.kind === "context_cleared" || previousMessage?.kind === "context_cleared"}
      isFinalStatus={item.index === messages.length - 1}
      onAskUserQuestionSubmit={onAskUserQuestionSubmit}
      onExitPlanModeConfirm={onExitPlanModeConfirm}
    />
  )
})

function KannaTranscriptImpl({
  messages,
  isLoading,
  localPath,
  latestToolIds,
  onOpenLocalLink,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
}: KannaTranscriptProps) {
  const renderItems = useMemo(() => buildTranscriptRenderItems(messages), [messages])
  const firstSystemIndex = useMemo(() => messages.findIndex((entry) => entry.kind === "system_init"), [messages])
  const firstAccountIndex = useMemo(() => messages.findIndex((entry) => entry.kind === "account_info"), [messages])

  return (
    <OpenLocalLinkProvider onOpenLocalLink={onOpenLocalLink}>
      {renderItems.map((item) => (
        <div
          key={item.type === "tool-group" ? `group-${item.startIndex}` : item.message.id}
          className="mx-auto max-w-[800px] pb-5"
        >
          <KannaTranscriptRow
            item={item}
            messages={messages}
            isLoading={isLoading}
            localPath={localPath}
            latestToolIds={latestToolIds}
            firstSystemIndex={firstSystemIndex}
            firstAccountIndex={firstAccountIndex}
            onAskUserQuestionSubmit={onAskUserQuestionSubmit}
            onExitPlanModeConfirm={onExitPlanModeConfirm}
          />
        </div>
      ))}
    </OpenLocalLinkProvider>
  )
}

export const KannaTranscript = memo(KannaTranscriptImpl)
