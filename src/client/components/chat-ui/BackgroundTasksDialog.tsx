import { memo, useCallback, useEffect, useId, useRef, useState } from "react"
import { ChevronRight, Square } from "lucide-react"
import type { BackgroundTask } from "../../../shared/types"
import type { ClientCommand } from "../../../shared/protocol"
import type { KannaSocket } from "../../app/socket"
import { useIsMobile } from "../../hooks/useIsMobile"
import { useNow } from "../../hooks/useNow"
import { formatAge, formatStartedClock } from "../../lib/formatters"
import { useBackgroundTasksStore } from "../../stores/backgroundTasksStore"
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip"
import { cn } from "../../lib/utils"

// ---------------------------------------------------------------------------
// Stop state machine
// ---------------------------------------------------------------------------

type StopPhase =
  | { phase: "idle" }
  | { phase: "confirm" }
  | { phase: "stopping"; startedAt: number }
  | { phase: "forceAvailable" }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function taskLabel(task: BackgroundTask): string {
  switch (task.kind) {
    case "bash_shell":
      return task.command
    case "terminal_pty":
      return `PTY: ${task.cwd}`
    case "codex_session":
      return "Codex session"
    case "draining_stream":
      return "Draining stream"
  }
}

export function taskTypeTag(task: BackgroundTask): string {
  switch (task.kind) {
    case "bash_shell":
      return "bash"
    case "terminal_pty":
      return "terminal"
    case "codex_session":
      return "codex"
    case "draining_stream":
      return "stream"
  }
}

function taskChatId(task: BackgroundTask): string | null {
  if ("chatId" in task) return task.chatId ?? null
  return null
}

export function taskStatus(task: BackgroundTask): "running" | "stopping" | "active" {
  if (task.kind === "bash_shell") {
    return task.status === "stopping" ? "stopping" : "running"
  }
  return "active"
}

function lastOutputLines(task: BackgroundTask): string[] {
  const raw = task.lastOutput ?? ""
  const lines = raw.split("\n")
  return lines.slice(-12)
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

// ---------------------------------------------------------------------------
// TaskRow — memoized per-task to prevent thrash on age tick
// ---------------------------------------------------------------------------

interface TaskRowProps {
  task: BackgroundTask
  index: number
  now: number
  isFocused: boolean
  isExpanded: boolean
  isDimmed: boolean
  graceMs: number
  /** Desktop (2-line) or mobile (3-line + details fallback) layout */
  variant?: "desktop" | "mobile"
  onFocus: (id: string) => void
  onToggleExpand: (id: string) => void
  /** Called when stop is confirmed; dispatches bg-tasks.stop { force: false } */
  onStopConfirmed: (id: string) => void
  /** Called when force-kill is clicked; dispatches bg-tasks.stop { force: true } */
  onForceKill: (id: string) => void
  /** Called when this row enters confirm phase — notifies parent to dim others */
  onConfirmStart: (id: string) => void
  /** Called when this row leaves confirm phase */
  onConfirmEnd: () => void
  /** Ref for the stop button so focus can be restored on cancel */
  stopButtonRef?: React.RefObject<HTMLButtonElement | null>
  /**
   * Override the initial stop phase. Used only in tests to render a specific
   * phase via SSR without simulating user interaction.
   */
  _testInitialPhase?: StopPhase["phase"]
}

export const TaskRow = memo(function TaskRow({
  task,
  index,
  now,
  isFocused,
  isExpanded,
  isDimmed,
  graceMs,
  variant = "desktop",
  onFocus,
  onToggleExpand,
  onStopConfirmed,
  onForceKill,
  onConfirmStart,
  onConfirmEnd,
  stopButtonRef: externalStopButtonRef,
  _testInitialPhase,
}: TaskRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const internalStopButtonRef = useRef<HTMLButtonElement>(null)
  const stopButtonRef = externalStopButtonRef ?? internalStopButtonRef
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const [stopState, setStopState] = useState<StopPhase>(() => {
    if (_testInitialPhase === "confirm") return { phase: "confirm" }
    if (_testInitialPhase === "stopping") return { phase: "stopping", startedAt: 0 }
    if (_testInitialPhase === "forceAvailable") return { phase: "forceAvailable" }
    return { phase: "idle" }
  })

  const label = taskLabel(task)
  const typeTag = taskTypeTag(task)
  const chatId = taskChatId(task)
  const status = taskStatus(task)
  const ageText = stopState.phase === "stopping" || stopState.phase === "forceAvailable"
    ? null
    : formatAge(task.startedAt, now)
  const startedClock = formatStartedClock(task.startedAt)
  const outputLines = lastOutputLines(task)
  const reducedMotion = prefersReducedMotion()
  const staggerDelay = reducedMotion || index >= 8 ? 0 : index * 24

  // Animate row entry
  const enterStyle: React.CSSProperties = reducedMotion
    ? {}
    : {
        animationName: "bg-task-row-enter",
        animationDuration: "180ms",
        animationTimingFunction: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        animationFillMode: "both",
        animationDelay: `${staggerDelay}ms`,
      }

  // 3s grace timer: idle → stopping → forceAvailable
  useEffect(() => {
    if (stopState.phase !== "stopping") return
    const timer = setTimeout(() => {
      setStopState({ phase: "forceAvailable" })
    }, graceMs)
    return () => clearTimeout(timer)
  }, [stopState.phase, graceMs])

  // Move focus to Confirm button when entering confirm phase
  useEffect(() => {
    if (stopState.phase === "confirm") {
      confirmButtonRef.current?.focus()
    }
  }, [stopState.phase])

  const handleEnterConfirm = useCallback(() => {
    setStopState({ phase: "confirm" })
    onConfirmStart(task.id)
  }, [task.id, onConfirmStart])

  const handleCancelConfirm = useCallback(() => {
    setStopState({ phase: "idle" })
    onConfirmEnd()
    // restore focus to stop button
    stopButtonRef.current?.focus()
  }, [onConfirmEnd, stopButtonRef])

  const handleConfirmStop = useCallback(() => {
    setStopState({ phase: "stopping", startedAt: Date.now() })
    onConfirmEnd()
    onStopConfirmed(task.id)
  }, [task.id, onConfirmEnd, onStopConfirmed])

  const handleForceKill = useCallback(() => {
    onForceKill(task.id)
  }, [task.id, onForceKill])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (stopState.phase === "confirm") {
          e.preventDefault()
          e.stopPropagation()
          handleCancelConfirm()
          return
        }
      }
      if (e.key === "Enter") {
        e.preventDefault()
        onToggleExpand(task.id)
      }
      const isCmdDot = (e.metaKey || e.ctrlKey) && e.key === "."
      if (isCmdDot) {
        e.preventDefault()
        if (stopState.phase === "idle") {
          handleEnterConfirm()
        } else if (stopState.phase === "confirm") {
          handleConfirmStop()
        } else if (stopState.phase === "forceAvailable") {
          handleForceKill()
        }
      }
    },
    [task.id, onToggleExpand, stopState.phase, handleEnterConfirm, handleConfirmStop, handleCancelConfirm, handleForceKill],
  )

  const handleExpandClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onToggleExpand(task.id)
    },
    [task.id, onToggleExpand],
  )

  // Slide-in animation style for confirm buttons
  const confirmSlideStyle: React.CSSProperties = reducedMotion
    ? {}
    : {
        animationName: "bg-task-confirm-slide-in",
        animationDuration: "180ms",
        animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        animationFillMode: "both",
      }

  // Render the stop-area for line 2 (desktop) or line 3 (mobile) based on current phase
  const renderStopArea = () => {
    if (stopState.phase === "idle") {
      if (variant === "mobile") {
        return (
          <button
            ref={stopButtonRef as React.RefObject<HTMLButtonElement>}
            type="button"
            aria-label="Stop task"
            onClick={(e) => {
              e.stopPropagation()
              handleEnterConfirm()
            }}
            disabled={status === "stopping"}
            className={cn(
              "w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md",
              "text-sm text-muted-foreground hover:text-destructive-text border border-border/60 hover:border-destructive-text/40",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              "disabled:opacity-40 disabled:pointer-events-none",
              "transition-colors",
            )}
            data-mobile-stop-line
          >
            <Square className="w-3 h-3 fill-current" aria-hidden />
            Stop
          </button>
        )
      }
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={stopButtonRef as React.RefObject<HTMLButtonElement>}
              type="button"
              aria-label="Stop task"
              onClick={(e) => {
                e.stopPropagation()
                handleEnterConfirm()
              }}
              disabled={status === "stopping"}
              className={cn(
                "flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-sm",
                "text-muted-foreground hover:text-destructive-text",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                "disabled:opacity-40 disabled:pointer-events-none",
                "transition-colors",
              )}
            >
              <Square className="w-3 h-3 fill-current" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Stop (⌘.)</TooltipContent>
        </Tooltip>
      )
    }

    if (stopState.phase === "confirm") {
      if (variant === "mobile") {
        return (
          <span
            className="grid grid-cols-2 gap-2 w-full"
            style={confirmSlideStyle}
            data-confirm-area
            data-mobile-stop-line
          >
            <button
              ref={confirmButtonRef}
              type="button"
              aria-label="Confirm stop"
              onClick={(e) => {
                e.stopPropagation()
                handleConfirmStop()
              }}
              className={cn(
                "flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium border",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                "transition-colors",
              )}
              style={{ color: "var(--destructive-text)", borderColor: "var(--destructive-text)" }}
            >
              Confirm stop?
            </button>
            <button
              type="button"
              aria-label="Cancel stop"
              onClick={(e) => {
                e.stopPropagation()
                handleCancelConfirm()
              }}
              className={cn(
                "flex items-center justify-center rounded-md px-3 py-2 text-sm",
                "text-muted-foreground hover:text-foreground",
                "border border-border/60 hover:border-border",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                "transition-colors",
              )}
            >
              Cancel
            </button>
          </span>
        )
      }
      return (
        <span
          className="flex items-center gap-1.5 flex-shrink-0"
          style={confirmSlideStyle}
          data-confirm-area
        >
          <button
            ref={confirmButtonRef}
            type="button"
            aria-label="Confirm stop"
            onClick={(e) => {
              e.stopPropagation()
              handleConfirmStop()
            }}
            className={cn(
              "inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              "transition-colors",
            )}
            style={{ color: "var(--destructive-text)" }}
          >
            Confirm stop?
          </button>
          <button
            type="button"
            aria-label="Cancel stop"
            onClick={(e) => {
              e.stopPropagation()
              handleCancelConfirm()
            }}
            className={cn(
              "inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs",
              "text-muted-foreground hover:text-foreground",
              "border border-border/60 hover:border-border",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              "transition-colors",
            )}
          >
            Cancel
          </button>
        </span>
      )
    }

    if (stopState.phase === "forceAvailable") {
      if (variant === "mobile") {
        return (
          <button
            type="button"
            aria-label="Force kill task"
            onClick={(e) => {
              e.stopPropagation()
              handleForceKill()
            }}
            className={cn(
              "w-full flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium border",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              "transition-colors",
            )}
            style={{ color: "var(--destructive-text)", borderColor: "var(--destructive-text)" }}
            data-mobile-stop-line
          >
            Force kill
          </button>
        )
      }
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Force kill task"
              onClick={(e) => {
                e.stopPropagation()
                handleForceKill()
              }}
              className={cn(
                "flex-shrink-0 inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                "transition-colors",
              )}
              style={{ color: "var(--destructive-text)" }}
            >
              Force kill
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Send SIGKILL immediately</TooltipContent>
        </Tooltip>
      )
    }

    // stopping phase — no interactive element
    return null
  }

  if (variant === "mobile") {
    return (
      <div
        ref={rowRef}
        role="option"
        aria-selected={isFocused}
        tabIndex={isFocused ? 0 : -1}
        data-task-id={task.id}
        data-row-enter
        data-mobile-row
        onFocus={() => onFocus(task.id)}
        onKeyDown={handleKeyDown}
        className={cn(
          "group relative flex flex-col px-3 py-3 rounded-md transition-all cursor-default gap-1.5",
          "hover:bg-secondary focus-visible:bg-secondary",
          "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",
          isFocused && "bg-secondary",
        )}
        style={{
          ...enterStyle,
          ...(isDimmed ? { opacity: 0.6, pointerEvents: "none" } : {}),
        }}
      >
        {/* Line 1: status dot + command + age */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 mt-px"
            style={{
              backgroundColor:
                stopState.phase === "stopping" || status === "stopping"
                  ? "var(--muted-foreground)"
                  : "var(--warning)",
            }}
            aria-hidden
          />
          <span className="flex-1 min-w-0 truncate font-mono text-sm font-semibold leading-snug">
            {label}
          </span>
          {ageText !== null ? (
            <span className="flex-shrink-0 font-mono text-[13px] font-medium tabular-nums text-muted-foreground leading-snug">
              {ageText}
            </span>
          ) : (
            <span className="flex-shrink-0 font-mono text-[13px] italic text-muted-foreground leading-snug">
              stopping…
            </span>
          )}
        </div>

        {/* Line 2: type tag + chat + started + status word; full command <details> */}
        <div className="flex items-center gap-1.5 pl-[14px] min-w-0 flex-wrap">
          <span className="text-xs text-muted-foreground font-sans leading-none flex-shrink-0">
            {typeTag}
          </span>
          {chatId && (
            <>
              <span className="text-xs text-muted-foreground leading-none flex-shrink-0" aria-hidden>
                ·
              </span>
              <a
                href={`/chat/${chatId}`}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 leading-none truncate max-w-[160px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded-sm"
                onClick={(e) => e.stopPropagation()}
              >
                chat
              </a>
            </>
          )}
          <span className="text-xs text-muted-foreground leading-none flex-shrink-0" aria-hidden>
            ·
          </span>
          <span className="text-xs text-muted-foreground font-sans tabular-nums leading-none flex-shrink-0">
            started {startedClock}
          </span>
          <span
            className="text-xs font-sans leading-none flex-shrink-0"
            style={
              stopState.phase === "stopping" || stopState.phase === "forceAvailable"
                ? { color: "var(--muted-foreground)" }
                : status !== "stopping"
                  ? { color: "var(--warning)" }
                  : undefined
            }
          >
            {stopState.phase === "stopping" || stopState.phase === "forceAvailable"
              ? "stopping"
              : status === "stopping"
                ? "stopping"
                : "running"}
          </span>
        </div>

        {/* Full command <details> fallback for long-press / tap */}
        {task.kind === "bash_shell" && label.length > 40 && (
          <details className="pl-[14px]" data-full-command>
            <summary className="text-xs text-muted-foreground cursor-pointer select-none list-none underline underline-offset-2">
              full command
            </summary>
            <pre className="mt-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
              {label}
            </pre>
          </details>
        )}

        {/* Line 3: full-width stop area */}
        <div className="pl-[14px]" data-mobile-stop-line-wrapper>
          {renderStopArea()}
        </div>

        {/* Expanded output */}
        {isExpanded && (
          <pre
            className="mt-1 pl-[14px] text-xs font-mono leading-[1.55] text-muted-foreground max-h-[240px] overflow-y-auto whitespace-pre-wrap break-all"
            aria-label="Last output"
          >
            {outputLines.join("\n") || "(no output)"}
          </pre>
        )}
      </div>
    )
  }

  // Desktop variant (original layout)
  return (
    <div
      ref={rowRef}
      role="option"
      aria-selected={isFocused}
      tabIndex={isFocused ? 0 : -1}
      data-task-id={task.id}
      data-row-enter
      onFocus={() => onFocus(task.id)}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative flex flex-col px-3 py-2.5 rounded-md transition-all cursor-default",
        "hover:bg-secondary focus-visible:bg-secondary",
        "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",
        isFocused && "bg-secondary",
      )}
      style={{
        ...enterStyle,
        ...(isDimmed ? { opacity: 0.6, pointerEvents: "none" } : {}),
      }}
    >
      {/* Line 1: label + age + expand chevron */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Status dot — static 8px, muted when stopping */}
        <span
          className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 mt-px"
          style={{
            backgroundColor:
              stopState.phase === "stopping" || status === "stopping"
                ? "var(--muted-foreground)"
                : "var(--warning)",
          }}
          aria-hidden
        />
        {/* Command/label — mono 14px weight 600 */}
        <span className="flex-1 min-w-0 truncate font-mono text-sm font-semibold leading-snug">
          {label}
        </span>
        {/* Age — mono 13px weight 500 tabular-nums; hidden while stopping */}
        {ageText !== null ? (
          <span className="flex-shrink-0 font-mono text-[13px] font-medium tabular-nums text-muted-foreground leading-snug">
            {ageText}
          </span>
        ) : (
          <span className="flex-shrink-0 font-mono text-[13px] italic text-muted-foreground leading-snug">
            {stopState.phase === "forceAvailable" ? "stopping…" : "stopping…"}
          </span>
        )}
        {/* Expand chevron */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={isExpanded ? "Collapse output" : "Expand output"}
              onClick={handleExpandClick}
              className={cn(
                "flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-sm",
                "text-muted-foreground hover:text-foreground",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                "transition-transform duration-150",
                isExpanded && "rotate-90",
              )}
            >
              <ChevronRight className="w-3.5 h-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {isExpanded ? "Collapse output" : "Expand output"} (Enter)
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Line 2: type tag + chat link + started clock + stop area */}
      <div className="flex items-center gap-1.5 mt-0.5 pl-[14px] min-w-0">
        {/* Type tag */}
        <span className="text-xs text-muted-foreground font-sans leading-none flex-shrink-0">
          {typeTag}
        </span>
        {chatId && (
          <>
            <span className="text-xs text-muted-foreground leading-none flex-shrink-0" aria-hidden>
              ·
            </span>
            <a
              href={`/chat/${chatId}`}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 leading-none truncate max-w-[200px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded-sm"
              onClick={(e) => e.stopPropagation()}
            >
              chat
            </a>
          </>
        )}
        <span className="text-xs text-muted-foreground leading-none flex-shrink-0" aria-hidden>
          ·
        </span>
        <span className="text-xs text-muted-foreground font-sans tabular-nums leading-none flex-shrink-0">
          started {startedClock}
        </span>
        {/* Status word — never color-only signal */}
        <span
          className="text-xs font-sans leading-none flex-shrink-0"
          style={
            stopState.phase === "stopping" || stopState.phase === "forceAvailable"
              ? { color: "var(--muted-foreground)" }
              : status !== "stopping"
                ? { color: "var(--warning)" }
                : undefined
          }
        >
          {stopState.phase === "stopping" || stopState.phase === "forceAvailable"
            ? "stopping"
            : status === "stopping"
              ? "stopping"
              : "running"}
        </span>
        {/* Spacer */}
        <span className="flex-1" />
        {/* Stop area — changes per phase */}
        {renderStopArea()}
      </div>

      {/* Expanded output */}
      {isExpanded && (
        <pre
          className="mt-2 pl-[14px] text-xs font-mono leading-[1.55] text-muted-foreground max-h-[240px] overflow-y-auto whitespace-pre-wrap break-all"
          aria-label="Last output"
        >
          {outputLines.join("\n") || "(no output)"}
        </pre>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// OrphanSection — tasks from a previous session
// ---------------------------------------------------------------------------

type KillAllPhase = "idle" | "confirm"

interface OrphanSectionProps {
  orphans: BackgroundTask[]
  now: number
  variant: "desktop" | "mobile"
  onStop: (id: string, force: boolean) => void
  graceMs: number
}

export function OrphanSection({ orphans, now, variant, onStop, graceMs }: OrphanSectionProps) {
  const [killAllPhase, setKillAllPhase] = useState<KillAllPhase>("idle")
  const [confirmingRowId, setConfirmingRowId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const headingId = useId()

  const handleKillAllClick = useCallback(() => {
    setKillAllPhase("confirm")
  }, [])

  const handleKillAllCancel = useCallback(() => {
    setKillAllPhase("idle")
  }, [])

  const handleKillAllConfirm = useCallback(() => {
    setKillAllPhase("idle")
    for (const orphan of orphans) {
      onStop(orphan.id, false)
    }
  }, [orphans, onStop])

  const handleConfirmStart = useCallback((id: string) => {
    setConfirmingRowId(id)
  }, [])

  const handleConfirmEnd = useCallback(() => {
    setConfirmingRowId(null)
  }, [])

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  if (orphans.length === 0) return null

  return (
    <div className="mb-3" data-orphan-section>
      {/* Section header */}
      <div className="flex items-center justify-between px-3 py-1.5 mb-1">
        <span
          id={headingId}
          className="text-xs text-muted-foreground font-sans"
          data-orphan-header
        >
          Found from previous session
        </span>
        {killAllPhase === "idle" ? (
          <button
            type="button"
            onClick={handleKillAllClick}
            className={cn(
              "text-xs text-muted-foreground hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded-sm",
              "transition-colors",
            )}
            data-kill-all-btn
          >
            Kill all
          </button>
        ) : (
          <span className="flex items-center gap-2" data-kill-all-confirm>
            <button
              type="button"
              onClick={handleKillAllConfirm}
              className={cn(
                "text-xs font-medium",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded-sm",
                "transition-colors",
              )}
              style={{ color: "var(--destructive-text)" }}
            >
              Kill {orphans.length} orphan{orphans.length !== 1 ? "s" : ""}?
            </button>
            <button
              type="button"
              onClick={handleKillAllCancel}
              className={cn(
                "text-xs text-muted-foreground hover:text-foreground",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded-sm",
                "transition-colors",
              )}
            >
              Cancel
            </button>
          </span>
        )}
      </div>
      {/* Orphan rows — visually muted */}
      <div
        role="listbox"
        aria-labelledby={headingId}
        aria-label="Orphan tasks from previous session"
        className="flex flex-col gap-0.5"
        style={{ opacity: 0.85 }}
      >
        {orphans.map((task, index) => (
          <TaskRow
            key={task.id}
            task={task}
            index={index}
            now={now}
            isFocused={false}
            isExpanded={task.id === expandedId}
            isDimmed={confirmingRowId !== null && confirmingRowId !== task.id}
            graceMs={graceMs}
            variant={variant}
            onFocus={() => {}}
            onToggleExpand={handleToggleExpand}
            onStopConfirmed={(id) => onStop(id, false)}
            onForceKill={(id) => onStop(id, true)}
            onConfirmStart={handleConfirmStart}
            onConfirmEnd={handleConfirmEnd}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// BackgroundTasksDialogBody — pure inner content without Portal wrapper.
// Exported for testing (renderToStaticMarkup works on portal-free content).
// ---------------------------------------------------------------------------

interface BodyProps {
  tasks: BackgroundTask[]
  onStop: (id: string, force: boolean) => void
  /** Grace period in ms before Force kill button appears. Default 3000. */
  graceMs?: number
  /** Desktop (default) or mobile 3-line layout */
  variant?: "desktop" | "mobile"
}

export function BackgroundTasksDialogBody({ tasks, onStop, graceMs = 3_000, variant = "desktop" }: BodyProps) {
  const now = useNow(1_000)
  const listRef = useRef<HTMLDivElement>(null)
  const headingId = useId()

  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Track which row (if any) is in confirm phase — used to dim other rows
  const [confirmingRowId, setConfirmingRowId] = useState<string | null>(null)

  // Split tasks into orphans and regular
  const orphanTasks = tasks.filter(
    (t): t is Extract<BackgroundTask, { kind: "bash_shell" }> =>
      t.kind === "bash_shell" && t.orphan === true,
  )
  const regularTasks = tasks.filter(
    (t) => !(t.kind === "bash_shell" && t.orphan === true),
  )

  const focusedIndex = regularTasks.findIndex((t) => t.id === focusedId)
  const effectiveFocusedId = focusedIndex >= 0 ? focusedId : (regularTasks[0]?.id ?? null)

  const handleFocus = useCallback((id: string) => {
    setFocusedId(id)
  }, [])

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  const handleStopConfirmed = useCallback(
    (id: string) => {
      onStop(id, false)
    },
    [onStop],
  )

  const handleForceKill = useCallback(
    (id: string) => {
      onStop(id, true)
    },
    [onStop],
  )

  const handleConfirmStart = useCallback((id: string) => {
    setConfirmingRowId(id)
  }, [])

  const handleConfirmEnd = useCallback(() => {
    setConfirmingRowId(null)
  }, [])

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (regularTasks.length === 0) return
      const currentIndex = regularTasks.findIndex((t) => t.id === effectiveFocusedId)
      if (e.key === "ArrowDown") {
        e.preventDefault()
        const nextIndex = Math.min(currentIndex + 1, regularTasks.length - 1)
        const nextId = regularTasks[nextIndex]?.id
        if (nextId) {
          setFocusedId(nextId)
          const el = listRef.current?.querySelector<HTMLElement>(`[data-task-id="${nextId}"]`)
          el?.focus()
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        const prevIndex = Math.max(currentIndex - 1, 0)
        const prevId = regularTasks[prevIndex]?.id
        if (prevId) {
          setFocusedId(prevId)
          const el = listRef.current?.querySelector<HTMLElement>(`[data-task-id="${prevId}"]`)
          el?.focus()
        }
      }
    },
    [regularTasks, effectiveFocusedId],
  )

  const runningCount = tasks.length

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full min-h-0">
        {/* Header section — mirrors DialogHeader layout */}
        <div className="flex flex-row items-center justify-between gap-4 shrink-0 p-4 border-b border-border">
          <h2 id={headingId} className="text-[18px] font-medium leading-none">
            Background tasks
          </h2>
          {runningCount > 0 && (
            <span className="text-xs text-muted-foreground font-sans tabular-nums flex-shrink-0 mr-6">
              {runningCount} running
            </span>
          )}
        </div>

        {/* Body section */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-3.5">
          {/* Orphan section (shown above regular tasks when present) */}
          {orphanTasks.length > 0 && (
            <OrphanSection
              orphans={orphanTasks}
              now={now}
              variant={variant}
              onStop={onStop}
              graceMs={graceMs}
            />
          )}

          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No background tasks. Anything an agent leaves running here will appear so you can stop it.
            </p>
          ) : regularTasks.length === 0 ? null : (
            <div
              ref={listRef}
              role="listbox"
              aria-label="Background tasks"
              aria-labelledby={headingId}
              onKeyDown={handleListKeyDown}
              className="flex flex-col gap-0.5"
            >
              {regularTasks.map((task, index) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  index={index}
                  now={now}
                  isFocused={task.id === effectiveFocusedId}
                  isExpanded={task.id === expandedId}
                  isDimmed={confirmingRowId !== null && confirmingRowId !== task.id}
                  graceMs={graceMs}
                  variant={variant}
                  onFocus={handleFocus}
                  onToggleExpand={handleToggleExpand}
                  onStopConfirmed={handleStopConfirmed}
                  onForceKill={handleForceKill}
                  onConfirmStart={handleConfirmStart}
                  onConfirmEnd={handleConfirmEnd}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// BackgroundTasksDialogView — wraps body in the Dialog shell.
// Desktop: centered dialog. Mobile (< 640px): bottom sheet via Tailwind.
// The View is the "pure-prop" testable surface; use BackgroundTasksDialogBody
// for SSR-based tests.
// ---------------------------------------------------------------------------

interface ViewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: BackgroundTask[]
  onStop: (id: string, force: boolean) => void
  /** Grace period in ms before Force kill button appears. Default 3000. */
  graceMs?: number
  /** Desktop or mobile layout variant — defaults to "desktop". */
  variant?: "desktop" | "mobile"
}

export function BackgroundTasksDialogView({ open, onOpenChange, tasks, onStop, graceMs, variant = "desktop" }: ViewProps) {
  const headingId = useId()

  // Mobile sheet: override the centered positioning to slide from bottom.
  // max-sm: classes apply at < 640px (Tailwind's "max-sm" variant).
  const mobileSheetClasses = variant === "mobile"
    ? "max-w-none w-full rounded-t-xl rounded-b-none left-0 right-0 bottom-0 top-auto translate-x-0 translate-y-0 max-h-[80vh]"
    : ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "w-[min(720px,calc(100vw-2rem))] p-0",
          mobileSheetClasses,
          variant === "mobile" && "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-left-0 data-[state=closed]:slide-out-to-left-0 data-[state=open]:slide-in-from-top-[0%] data-[state=closed]:slide-out-to-top-[0%]",
        )}
        size="lg"
        aria-labelledby={headingId}
        data-variant={variant}
      >
        <DialogTitle id={headingId} className="sr-only">
          Background tasks
        </DialogTitle>
        <BackgroundTasksDialogBody tasks={tasks} onStop={onStop} graceMs={graceMs} variant={variant} />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// BackgroundTasksDialog — connected variant; reads from singleton store
// ---------------------------------------------------------------------------

interface BackgroundTasksDialogConnectedProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  socket?: KannaSocket
  /** Override layout variant. When omitted, auto-detected via useIsMobile(). */
  variant?: "desktop" | "mobile"
}

export function BackgroundTasksDialog({
  open,
  onOpenChange,
  socket,
  variant: variantProp,
}: BackgroundTasksDialogConnectedProps) {
  const tasks = useBackgroundTasksStore((state) => state.tasks)
  const isMobile = useIsMobile()
  const variant = variantProp ?? (isMobile ? "mobile" : "desktop")

  // Wrap stop dispatch so Task 11 can swap in confirm UI here without changing TaskRow
  const handleStop = useCallback(
    (id: string, force: boolean) => {
      if (!socket) return
      const cmd: ClientCommand = { type: "bg-tasks.stop", id, force }
      void socket.command(cmd).catch(() => {})
    },
    [socket],
  )

  return (
    <BackgroundTasksDialogView
      open={open}
      onOpenChange={onOpenChange}
      tasks={tasks}
      onStop={handleStop}
      variant={variant}
    />
  )
}

// ---------------------------------------------------------------------------
// CSS keyframe for row entry (injected once, respects prefers-reduced-motion)
// ---------------------------------------------------------------------------

const BG_TASK_ROW_KEYFRAME = `
@keyframes bg-task-row-enter {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes bg-task-confirm-slide-in {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes bg-task-sheet-slide-in {
  from { opacity: 0; transform: translateY(100%); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes bg-task-row-enter {
    from { opacity: 1; transform: none; }
    to   { opacity: 1; transform: none; }
  }
  @keyframes bg-task-confirm-slide-in {
    from { opacity: 1; transform: none; }
    to   { opacity: 1; transform: none; }
  }
  @keyframes bg-task-sheet-slide-in {
    from { opacity: 1; transform: none; }
    to   { opacity: 1; transform: none; }
  }
}
`

let keyframeInjected = false

if (typeof document !== "undefined" && !keyframeInjected) {
  keyframeInjected = true
  const style = document.createElement("style")
  style.textContent = BG_TASK_ROW_KEYFRAME
  document.head.appendChild(style)
}
