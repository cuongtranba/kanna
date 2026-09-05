import { LegendList, type LegendListRef } from "@legendapp/list/react"
import { memo, useCallback, useEffect, useMemo, useRef } from "react"
import { useChatPageStore } from "../../stores/chatPageStore"
import { ChatTabScopedStore } from "../../stores/chatTabScopedStore"
import { ArrowDown, Bot, Flower, MessageCircleQuestion, Upload } from "lucide-react"
import { AnimatedShinyText } from "../../components/ui/animated-shiny-text"
import { DrainingIndicator } from "../../components/messages/DrainingIndicator"
import { QueuedUserMessage } from "../../components/messages/QueuedUserMessage"
import { OpenLocalLinkProvider, type OpenLocalLinkTarget } from "../../components/messages/shared"
import { SubagentTranscriptFetchProvider } from "../../components/messages/subagent-fetch-context"
import { ProcessingMessage } from "../../components/messages/ProcessingMessage"
import { ContextMenu, ContextMenuTrigger } from "../../components/ui/context-menu"
import { OpenExternalContextMenuContent } from "../../components/open-external-menu"
import { cn } from "../../lib/utils"
import { shouldOpenLocalFileLinkInEditor } from "../../lib/pathUtils"
import {
  buildResolvedTranscriptRows,
  type ResolvedTranscriptRow,
  useStableResolvedRows,
} from "../KannaTranscript"
import { useTranscriptActions } from "../transcriptActionsContext"
import { CronJobsSection } from "../CronJobsSection"
import { buildTranscriptGapClassMap } from "../transcriptSpacing"
import type { KannaState } from "../useKannaState"
import type { SubagentRunSnapshot } from "../../../shared/types"
import { SubagentMessage } from "../../components/messages/SubagentMessage"
import { SubagentPendingToolCard } from "../../components/messages/SubagentPendingToolCard"
import { AskUserQuestionMessage } from "../../components/messages/AskUserQuestionMessage"
import { TranscriptRenderOptionsProvider } from "../../components/messages/render-context"
import type { ProcessedToolCall } from "../../components/messages/types"
import { renderChatLinks } from "../../components/messages/renderChatLinks"
import React from "react"
import { CloudflareTunnelCard } from "../../components/chat-ui/CloudflareTunnelCard"
import {
  CHAT_NAVBAR_OFFSET_PX,
  EMPTY_STATE_TEXT,
} from "./utils"
import { WorkflowsSectionWithDetail } from "../WorkflowsSection"
import { domAdapter } from "../../adapters/dom.adapter"
import { timerAdapter } from "../../adapters/timer.adapter"
import type { DomPort } from "../../ports/domPort"
import type { TimerPort } from "../../ports/timerPort"
import { LoopProgressSection } from "../LoopProgressSection"
import { BackgroundTasksSection } from "../BackgroundTasksSection"
import { PluginsFooterSlot } from "../PluginsFooterSlot"
import { useArrivingRows } from "./useArrivingRows"
import { TranscriptRowFrame, delegateRunIdOf } from "./TranscriptRowFrame"
import {
  extractDelegateCalls,
  matchRunsToDelegateCalls,
} from "../subagent-run-placement"

export interface ChatTranscriptViewportPorts {
  dom?: DomPort
  timer?: TimerPort
}

export type PendingQuestionRun = SubagentRunSnapshot & {
  pendingTool: NonNullable<SubagentRunSnapshot["pendingTool"]>
}

export type PendingMainQuestion = Extract<ProcessedToolCall, { toolKind: "ask_user_question" }>

/** The one field the scroll handler reads — LegendList's DOM event and the
 * synthetic `{currentTarget}` the resize effect fabricates both satisfy it. */
interface ScrollEventLike {
  /** Present on the DOM event LegendList actually forwards on web. */
  readonly currentTarget?: EventTarget | null
  /** Declared only so LegendList's React-Native-shaped event type matches. */
  readonly nativeEvent?: object
}

/** Stable option objects — the render-context memo keys on reference identity. */
const FOOTER_SURFACE_OPTIONS = { askUserQuestionSurface: "footer" } as const
const INLINE_SURFACE_OPTIONS = { askUserQuestionSurface: "inline" } as const

/**
 * The main agent's own AskUserQuestion still awaiting an answer, or null.
 *
 * `latestToolIds.AskUserQuestion` is already "latest UNRESOLVED" — but that
 * means latest in the transcript, NOT last on screen: background tasks stream
 * hundreds of entries below a parked question, burying it. Selecting it here
 * lets the viewport re-render the actionable card in the footer.
 *
 * Pure so it can be unit-tested without rendering the virtualized list.
 */
export function selectPendingMainQuestion(
  messages: readonly KannaState["messages"][number][],
  latestToolIds: Record<string, string | null>,
): PendingMainQuestion | null {
  const id = latestToolIds.AskUserQuestion
  if (!id) return null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.id !== id) continue
    if (message.kind !== "tool" || message.toolKind !== "ask_user_question") return null
    // Guard a latestToolIds prop one tick staler than `messages`.
    return message.result ? null : message
  }
  return null
}

/**
 * Select every subagent run awaiting a user response, oldest request first.
 * Pure so it can be unit-tested without rendering the virtualized list.
 */
export function collectPendingQuestionRuns(
  subagentRuns: Record<string, SubagentRunSnapshot> | undefined,
): PendingQuestionRun[] {
  const pending = Object.values(subagentRuns ?? {}).filter(
    (run): run is PendingQuestionRun => run.pendingTool !== null,
  )
  pending.sort(
    (a, b) =>
      a.pendingTool.requestedAt - b.pendingTool.requestedAt || a.runId.localeCompare(b.runId),
  )
  return pending
}

interface ChatTranscriptViewportProps {
  activeChatId: string | null
  listRef: React.RefObject<LegendListRef | null>
  messages: KannaState["messages"]
  transcriptPaddingBottom: number
  isHistoryLoading: boolean
  hasOlderHistory: boolean
  loadOlderHistory: () => Promise<void>
  showScrollButton: boolean
  onIsAtEndChange: (isAtEnd: boolean) => void
  scrollToBottom: () => void
  typedEmptyStateText: string
  isEmptyStateTypingComplete: boolean
  isPageFileDragActive: boolean
  showEmptyState: boolean
  onOpenLocalLink: KannaState["handleOpenLocalLink"]
  headerOffsetPx?: number
  ports?: ChatTranscriptViewportPorts
}

export const ChatTranscriptViewport = memo(({
  activeChatId,
  listRef,
  messages,
  transcriptPaddingBottom,
  isHistoryLoading,
  hasOlderHistory,
  loadOlderHistory,
  showScrollButton,
  onIsAtEndChange,
  scrollToBottom,
  typedEmptyStateText,
  isEmptyStateTypingComplete,
  isPageFileDragActive,
  showEmptyState,
  onOpenLocalLink,
  headerOffsetPx = CHAT_NAVBAR_OFFSET_PX,
  ports,
}: ChatTranscriptViewportProps) => {
  const {
    localPath,
    latestToolIds,
    isProcessing,
    queuedMessages,
    runtimeStatus,
    isDraining,
    commandError,
    onStopDraining,
    onSteerQueuedMessage,
    onRemoveQueuedMessage,
    onAskUserQuestionSubmit,
    onSubagentAskUserQuestionSubmit,
    onSubagentExitPlanModeSubmit,
    schedules,
    cronJobs,
    onAutoContinueAccept,
    tunnels,
    liveTunnelId,
    onTunnelAccept,
    onTunnelStop,
    onTunnelRetry,
    subagentRuns,
    onCancelSubagentRun,
    loopProgress,
    workflowRuns,
    backgroundTasks,
    getWorkflowRunDetail,
    getSubagentTranscript,
    editorPreset,
    editorCommandTemplate,
    platform,
  } = useTranscriptActions()

  const dom = ports?.dom ?? domAdapter
  const timer = ports?.timer ?? timerAdapter
  const previousRowCountRef = useRef(0)
  const localLinkMenuTriggerRef = useRef<HTMLSpanElement | null>(null)
  const toolGroupExpanded = ChatTabScopedStore.useScopedStore((s) => s.toolGroupExpanded)
  const resetToolGroupExpanded = ChatTabScopedStore.useScopedStore((s) => s.resetToolGroupExpanded)
  const localLinkMenuTarget = useChatPageStore((s) => s.localLinkMenuTarget)
  const setLocalLinkMenuTarget = useChatPageStore((s) => s.setLocalLinkMenuTarget)
  const setLocalLinkMenuOpen = useChatPageStore((s) => s.setLocalLinkMenuOpen)
  const isMac = platform === "darwin"

  const rawRows = useMemo(() => buildResolvedTranscriptRows(messages, {
    isLoading: isProcessing,
    localPath: localPath ?? undefined,
    latestToolIds,
  }), [isProcessing, latestToolIds, localPath, messages])
  const resolvedRows = useStableResolvedRows(rawRows)
  // Kept beside the rows rather than written onto them: useStableResolvedRows
  // reuses unchanged row objects, so a gap stored on a row would go stale
  // whenever only its neighbour changed.
  const gapClassByRowId = useMemo(() => buildTranscriptGapClassMap(resolvedRows), [resolvedRows])

  useEffect(() => {
    resetToolGroupExpanded()
  }, [activeChatId, resetToolGroupExpanded])

  useEffect(() => {
    const previousRowCount = previousRowCountRef.current
    previousRowCountRef.current = resolvedRows.length

    if (previousRowCount > 0 || resolvedRows.length === 0) {
      return
    }

    onIsAtEndChange(true)
    const frameId = timer.requestAnimationFrame(() => {
      void listRef.current?.scrollToEnd?.({ animated: false })
    })
    return () => timer.cancelAnimationFrame(frameId)
  }, [listRef, onIsAtEndChange, resolvedRows.length, timer])

  const { runsByDelegateToolId, childrenByParentRunId } = useMemo(() => {
    const delegateCalls = extractDelegateCalls(messages)
    const topLevelRuns = Object.values(subagentRuns).filter((r) => r.parentRunId === null)
    const { matched } = matchRunsToDelegateCalls(delegateCalls, topLevelRuns)

    const byParent = new Map<string, SubagentRunSnapshot[]>()
    for (const run of Object.values(subagentRuns)) {
      if (run.parentRunId === null) continue
      const list = byParent.get(run.parentRunId) ?? []
      list.push(run)
      byParent.set(run.parentRunId, list)
    }
    const cmp = (a: SubagentRunSnapshot, b: SubagentRunSnapshot) =>
      a.startedAt - b.startedAt || a.runId.localeCompare(b.runId)
    for (const list of byParent.values()) list.sort(cmp)

    return { runsByDelegateToolId: matched, childrenByParentRunId: byParent }
  }, [messages, subagentRuns])

  // Any subagent run (top-level or nested) awaiting a user response. Surfaced
  // at the footer so a question never stays buried under its historical
  // user_prompt anchor. See adr-20260618-subagent-pending-question-footer-surface.
  const pendingQuestionRuns = useMemo(() => collectPendingQuestionRuns(subagentRuns), [subagentRuns])
  const pendingMainQuestion = useMemo(
    () => selectPendingMainQuestion(messages, latestToolIds),
    [messages, latestToolIds],
  )

  const renderRunTree = useMemo(
    () =>
      function renderRun(run: SubagentRunSnapshot, depth: number): React.ReactNode {
        const children = childrenByParentRunId.get(run.runId) ?? []
        return (
          <React.Fragment key={run.runId}>
            <SubagentMessage
              run={run}
              indentDepth={depth}
              localPath={localPath ?? ""}
              onSubagentAskUserQuestionSubmit={onSubagentAskUserQuestionSubmit}
              onSubagentExitPlanModeSubmit={onSubagentExitPlanModeSubmit}
              onCancelSubagentRun={onCancelSubagentRun}
              suppressPendingTool
            />
            {children.map((child) => renderRun(child, depth + 1))}
          </React.Fragment>
        )
      },
    [childrenByParentRunId, localPath, onSubagentAskUserQuestionSubmit, onSubagentExitPlanModeSubmit, onCancelSubagentRun],
  )

  const handleScroll = useCallback((event?: ScrollEventLike) => {
    const currentTarget = event?.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : listRef.current?.getScrollableNode?.()

    if (currentTarget instanceof HTMLElement) {
      const distanceFromEnd = currentTarget.scrollHeight - currentTarget.clientHeight - currentTarget.scrollTop
      onIsAtEndChange(distanceFromEnd <= 4)
      return
    }

    const state = listRef.current?.getState?.()
    if (state) {
      onIsAtEndChange(state.isAtEnd)
    }
  }, [listRef, onIsAtEndChange])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    const frameId = timer.requestAnimationFrame(() => {
      const scrollNode = listRef.current?.getScrollableNode?.()
      if (!(scrollNode instanceof HTMLElement)) {
        return
      }

      const handleNativeScroll = () => {
        handleScroll({ currentTarget: scrollNode })
      }

      scrollNode.addEventListener("scroll", handleNativeScroll, { passive: true })
      handleNativeScroll()
      cleanup = () => {
        scrollNode.removeEventListener("scroll", handleNativeScroll)
      }
    })

    return () => {
      timer.cancelAnimationFrame(frameId)
      cleanup?.()
    }
  }, [activeChatId, handleScroll, listRef, resolvedRows.length, timer])

  // LegendList's maintainVisibleContentPosition corrects scroll position by
  // calling scrollBy() whenever an off-screen row's measured height differs
  // from its estimate. On a long chat that fires every frame of a drag, and
  // a programmatic scrollBy mid-gesture aborts native touch momentum on iOS/
  // Android — making long chats impossible to scroll by touch (desktop wheel
  // unaffected). Suppress only those corrections while a finger gesture and
  // its inertia own the scroll; MVCP stays fully enabled for non-touch updates.
  useEffect(() => {
    let cleanup: (() => void) | undefined
    const frameId = timer.requestAnimationFrame(() => {
      const scrollNode = listRef.current?.getScrollableNode?.()
      if (!(scrollNode instanceof HTMLElement)) return

      const nativeScrollBy = scrollNode.scrollBy
      if (typeof nativeScrollBy !== "function") return

      let gestureActive = false
      let settleTimer: number | undefined

      const armSettle = () => {
        if (settleTimer !== undefined) timer.clearTimeout(settleTimer)
        settleTimer = timer.setTimeout(() => {
          settleTimer = undefined
          gestureActive = false
        }, 120)
      }

      function guardedScrollBy(options?: ScrollToOptions): void
      function guardedScrollBy(x: number, y: number): void
      function guardedScrollBy(...args: [ScrollToOptions?] | [number, number]): void {
        if (!gestureActive) Reflect.apply(nativeScrollBy, scrollNode, args)
      }
      scrollNode.scrollBy = guardedScrollBy

      const onTouchStart = () => {
        if (settleTimer !== undefined) {
          timer.clearTimeout(settleTimer)
          settleTimer = undefined
        }
        gestureActive = true
      }
      const onTouchEnd = () => { armSettle() }
      const onScrollWhileGesturing = () => { if (gestureActive) armSettle() }

      scrollNode.addEventListener("touchstart", onTouchStart, { passive: true })
      scrollNode.addEventListener("touchend", onTouchEnd, { passive: true })
      scrollNode.addEventListener("touchcancel", onTouchEnd, { passive: true })
      scrollNode.addEventListener("scroll", onScrollWhileGesturing, { passive: true })

      cleanup = () => {
        if (settleTimer !== undefined) timer.clearTimeout(settleTimer)
        scrollNode.removeEventListener("touchstart", onTouchStart)
        scrollNode.removeEventListener("touchend", onTouchEnd)
        scrollNode.removeEventListener("touchcancel", onTouchEnd)
        scrollNode.removeEventListener("scroll", onScrollWhileGesturing)
        if (scrollNode.scrollBy === guardedScrollBy) {
          Reflect.deleteProperty(scrollNode, "scrollBy")
        }
      }
    })

    return () => {
      timer.cancelAnimationFrame(frameId)
      cleanup?.()
    }
  }, [activeChatId, listRef, timer])

  const handleStartReached = useCallback(() => {
    if (isHistoryLoading || !hasOlderHistory) {
      return
    }
    void loadOlderHistory()
  }, [hasOlderHistory, isHistoryLoading, loadOlderHistory])

  const handleOpenLocalLinkClick = useCallback((target: OpenLocalLinkTarget) => {
    if (target.trigger !== "contextmenu") {
      const action = shouldOpenLocalFileLinkInEditor(target.path) ? "open_editor" : "open_default"
      void onOpenLocalLink(target, action)
      return
    }

    setLocalLinkMenuTarget(target)
    timer.requestAnimationFrame(() => {
      const trigger = localLinkMenuTriggerRef.current
      if (!trigger) return
      const clientX = target.clientX ?? dom.getInnerWidth() / 2
      const clientY = target.clientY ?? dom.getInnerHeight() / 2
      dom.dispatchContextMenuEvent(trigger, clientX, clientY)
    })
  }, [dom, onOpenLocalLink, setLocalLinkMenuTarget, timer])

  const arrivingRows = useArrivingRows(resolvedRows, activeChatId)

  const renderItem = useCallback(({ item }: { item: ResolvedTranscriptRow }) => {
    const delegateToolId = delegateRunIdOf(item)
    const run = delegateToolId != null ? runsByDelegateToolId.get(delegateToolId) : null
    return (
      <TranscriptRowFrame
        row={item}
        gapClass={gapClassByRowId.get(item.id) ?? "pt-4"}
        arriveIndex={arrivingRows.indexOf(item.id)}
        toolGroupExpanded={item.kind === "tool-group" ? (toolGroupExpanded[item.id] ?? false) : undefined}
        runTree={run ? renderRunTree(run, 0) : null}
      />
    )
  }, [toolGroupExpanded, runsByDelegateToolId, renderRunTree, gapClassByRowId, arrivingRows])

  const listHeader = (
    <div className="mx-auto w-full max-w-[800px]" style={{ paddingTop: `${headerOffsetPx}px` }}>
      {isHistoryLoading ? (
        <div className="flex justify-center pb-4">
          <span className="text-sm translate-y-[-0.5px]">
            <AnimatedShinyText
              animate
              shimmerWidth={Math.max(20, "Loading more messages...".length * 3)}
            >
              Loading more messages...
            </AnimatedShinyText>
          </span>
        </div>
      ) : null}
    </div>
  )

  const liveTunnelRecord = liveTunnelId && tunnels ? tunnels[liveTunnelId] : undefined

  const listFooter = (
    // pt-4 replaces the trailing air the last row used to provide via pb-5.
    <div className="mx-auto w-full max-w-[800px] pt-4">
      <PluginsFooterSlot />
      {loopProgress && (loopProgress.armed || loopProgress.rows.length > 0) ? (
        <div className="pb-4">
          <LoopProgressSection
            loopProgress={loopProgress}
            onResume={onAutoContinueAccept}
          />
        </div>
      ) : null}
      {activeChatId && cronJobs.length > 0 ? (
        <div className="pb-4">
          <CronJobsSection jobs={cronJobs} chatId={activeChatId} />
        </div>
      ) : null}
      {workflowRuns && workflowRuns.length > 0 && getWorkflowRunDetail ? (
        <div className="pb-4">
          <WorkflowsSectionWithDetail
            runs={workflowRuns}
            getRunDetail={getWorkflowRunDetail}
          />
        </div>
      ) : null}
      {liveTunnelRecord && onTunnelAccept && onTunnelStop && onTunnelRetry && (
        <div className="pb-4">
          <CloudflareTunnelCard
            record={liveTunnelRecord}
            onAccept={onTunnelAccept}
            onStop={onTunnelStop}
            onRetry={onTunnelRetry}
            onDismiss={onTunnelStop}
          />
        </div>
      )}
      {activeChatId && backgroundTasks && backgroundTasks.length > 0 ? (
        <div className="pb-4">
          <BackgroundTasksSection chatId={activeChatId} tasks={backgroundTasks} />
        </div>
      ) : null}
      {isProcessing ? <ProcessingMessage status={runtimeStatus ?? undefined} /> : null}
      {queuedMessages.map((message) => (
        <QueuedUserMessage
          key={message.id}
          message={message}
          onRemove={() => void onRemoveQueuedMessage(message.id)}
          onSendNow={() => void onSteerQueuedMessage(message.id)}
        />
      ))}
      {!isProcessing && isDraining ? (
        <DrainingIndicator onStop={() => void onStopDraining()} />
      ) : null}
      {commandError ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive whitespace-pre-wrap">
          {renderChatLinks(commandError)}
        </div>
      ) : null}
      {pendingMainQuestion ? (
        <div className="mb-3" data-testid={`main-pending-footer:${pendingMainQuestion.toolId}`}>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0" />
            <span><span className="text-foreground">Claude</span> needs your input</span>
          </div>
          {/* Reset to "inline" so this instance renders the actionable card;
              the transcript row above degrades to a pointer. */}
          <TranscriptRenderOptionsProvider value={INLINE_SURFACE_OPTIONS}>
            <AskUserQuestionMessage
              message={pendingMainQuestion}
              onSubmit={onAskUserQuestionSubmit}
              isLatest
            />
          </TranscriptRenderOptionsProvider>
        </div>
      ) : null}
      {pendingQuestionRuns.length > 0 && onSubagentAskUserQuestionSubmit && onSubagentExitPlanModeSubmit
        ? pendingQuestionRuns.map((run) => (
            <div
              key={run.runId}
              data-testid={`subagent-pending-footer:${run.runId}`}
              className="mb-3"
            >
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Bot className="h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="text-foreground">{run.subagentName}</span> needs your input
                </span>
              </div>
              <SubagentPendingToolCard
                pendingTool={run.pendingTool}
                onAskUserQuestionSubmit={(toolUseId, questions, answers) =>
                  onSubagentAskUserQuestionSubmit(run.runId, toolUseId, questions, answers)
                }
                onExitPlanModeSubmit={(toolUseId, response) =>
                  onSubagentExitPlanModeSubmit(run.runId, toolUseId, response)
                }
              />
            </div>
          ))
        : null}
    </div>
  )

  return (
    <>
      <SubagentTranscriptFetchProvider value={getSubagentTranscript ?? null}>
      <OpenLocalLinkProvider onOpenLocalLink={handleOpenLocalLinkClick}>
      {/* Always mounted — only the VALUE flips. Mounting conditionally would
          change the tree shape and remount every row, resetting per-row
          scoped stores (tool-group expansion, in-progress answer drafts). */}
      <TranscriptRenderOptionsProvider
        value={pendingMainQuestion ? FOOTER_SURFACE_OPTIONS : INLINE_SURFACE_OPTIONS}
      >
        <LegendList<ResolvedTranscriptRow>
          ref={listRef}
          data={resolvedRows}
          extraData={{ toolGroupExpanded, schedules, tunnels, liveTunnelId }}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={48}
          initialScrollAtEnd
          maintainScrollAtEnd
          maintainScrollAtEndThreshold={0.1}
          maintainVisibleContentPosition
          onScroll={handleScroll}
          onStartReached={handleStartReached}
          onStartReachedThreshold={0.1}
          className="h-full flex-1 overflow-x-hidden overscroll-y-contain touch-pan-y px-3 scroll-pt-[72px] [scrollbar-gutter:auto]"
          // Rows now pad above rather than below, so the last row contributes no
          // trailing air of its own; make up the difference here.
          contentContainerStyle={{ paddingBottom: transcriptPaddingBottom + 30 }}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
        />
      </TranscriptRenderOptionsProvider>
      </OpenLocalLinkProvider>
      </SubagentTranscriptFetchProvider>

      <ContextMenu onOpenChange={setLocalLinkMenuOpen}>
        <ContextMenuTrigger asChild>
          <span
            ref={localLinkMenuTriggerRef}
            aria-hidden="true"
            className="pointer-events-none fixed size-px opacity-0"
            style={{
              left: localLinkMenuTarget?.clientX ?? 0,
              top: localLinkMenuTarget?.clientY ?? 0,
            }}
          />
        </ContextMenuTrigger>
        {localLinkMenuTarget ? (
          <OpenExternalContextMenuContent
            isMac={isMac}
            editorPreset={editorPreset}
            editorCommandTemplate={editorCommandTemplate}
            includeFinder
            includePreview
            includeDefault
            onOpenExternal={(action, editor) => {
              void onOpenLocalLink(localLinkMenuTarget, action, editor)
            }}
          />
        ) : null}
      </ContextMenu>

      {showEmptyState ? (
        <div
          className="pointer-events-none absolute inset-x-4 animate-fade-in"
          style={{
            top: headerOffsetPx,
            bottom: transcriptPaddingBottom,
          }}
        >
          <div className="mx-auto flex h-full max-w-[800px] items-center justify-center">
            <div className="flex flex-col items-center justify-center gap-4 text-muted-foreground opacity-70">
              <Flower strokeWidth={1.5} className="kanna-empty-state-flower size-8 text-muted-foreground" />
              <div
                className="kanna-empty-state-text flex max-w-xs items-center text-center text-base font-normal text-muted-foreground"
                aria-label={EMPTY_STATE_TEXT}
              >
                <span className="relative inline-grid place-items-start">
                  <span className="invisible col-start-1 row-start-1 flex items-center whitespace-pre">
                    <span>{EMPTY_STATE_TEXT}</span>
                    <span className="kanna-typewriter-cursor-slot" aria-hidden="true" />
                  </span>
                  <span className="col-start-1 row-start-1 flex items-center whitespace-pre">
                    <span>{typedEmptyStateText}</span>
                    <span className="kanna-typewriter-cursor-slot" aria-hidden="true">
                      <span
                        className="kanna-typewriter-cursor"
                        data-typing-complete={isEmptyStateTypingComplete ? "true" : "false"}
                      />
                    </span>
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isPageFileDragActive ? (
        <div className="pointer-events-none absolute inset-0 z-30">
          <div className="absolute inset-0 bg-background/70" />
          <div className="absolute inset-6 ">
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center justify-center gap-3 text-center">
                <Upload className="mx-auto size-14 text-foreground" strokeWidth={1.75} />
                <div className="text-xl font-medium text-foreground">Drop up to 10 files</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div
        style={{ bottom: transcriptPaddingBottom - 20 }}
        className={cn(
          "absolute left-1/2 z-10 -translate-x-1/2 transition-[transform,opacity] motion-reduce:transition-none",
          showScrollButton
            ? "scale-100 opacity-100 duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
            : "pointer-events-none scale-75 opacity-0 duration-200 ease-out",
        )}
      >
        <button
          onClick={scrollToBottom}
          aria-label="Scroll to latest message"
          className="flex size-11 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-sm text-foreground transition-colors hover:bg-muted md:size-9"
        >
          <ArrowDown aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
    </>
  )
})

function keyExtractor(item: ResolvedTranscriptRow) {
  return item.id
}
