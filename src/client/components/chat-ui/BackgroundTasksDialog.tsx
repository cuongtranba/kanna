import { memo, useCallback, useEffect, useId, useRef, useState } from "react"
import { ChevronRight, Square } from "lucide-react"
import type { BackgroundTask } from "../../../shared/types"
import type { ClientCommand } from "../../../shared/protocol"
import type { KannaSocket } from "../../app/socket"
import { useNow } from "../../hooks/useNow"
import { formatAge, formatStartedClock } from "../../lib/formatters"
import { useBackgroundTasksStore } from "../../stores/backgroundTasksStore"
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog"
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

  // Render the stop-area for line 2 based on current phase
  const renderStopArea = () => {
    if (stopState.phase === "idle") {
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
                "text-muted-foreground hover:text-destructive",
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
            style={{ color: "var(--destructive)" }}
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
              style={{ color: "var(--destructive)" }}
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
// BackgroundTasksDialogBody — pure inner content without Portal wrapper.
// Exported for testing (renderToStaticMarkup works on portal-free content).
// ---------------------------------------------------------------------------

interface BodyProps {
  tasks: BackgroundTask[]
  onStop: (id: string, force: boolean) => void
  /** Grace period in ms before Force kill button appears. Default 3000. */
  graceMs?: number
}

export function BackgroundTasksDialogBody({ tasks, onStop, graceMs = 3_000 }: BodyProps) {
  const now = useNow(1_000)
  const listRef = useRef<HTMLDivElement>(null)
  const headingId = useId()

  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Track which row (if any) is in confirm phase — used to dim other rows
  const [confirmingRowId, setConfirmingRowId] = useState<string | null>(null)

  const focusedIndex = tasks.findIndex((t) => t.id === focusedId)
  const effectiveFocusedId = focusedIndex >= 0 ? focusedId : (tasks[0]?.id ?? null)

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
      if (tasks.length === 0) return
      const currentIndex = tasks.findIndex((t) => t.id === effectiveFocusedId)
      if (e.key === "ArrowDown") {
        e.preventDefault()
        const nextIndex = Math.min(currentIndex + 1, tasks.length - 1)
        const nextId = tasks[nextIndex]?.id
        if (nextId) {
          setFocusedId(nextId)
          const el = listRef.current?.querySelector<HTMLElement>(`[data-task-id="${nextId}"]`)
          el?.focus()
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        const prevIndex = Math.max(currentIndex - 1, 0)
        const prevId = tasks[prevIndex]?.id
        if (prevId) {
          setFocusedId(prevId)
          const el = listRef.current?.querySelector<HTMLElement>(`[data-task-id="${prevId}"]`)
          el?.focus()
        }
      }
    },
    [tasks, effectiveFocusedId],
  )

  const runningCount = tasks.length

  return (
    <TooltipProvider>
      <div>
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
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No background tasks. Anything an agent leaves running here will appear so you can stop it.
            </p>
          ) : (
            <div
              ref={listRef}
              role="listbox"
              aria-label="Background tasks"
              aria-labelledby={headingId}
              onKeyDown={handleListKeyDown}
              className="flex flex-col gap-0.5"
            >
              {tasks.map((task, index) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  index={index}
                  now={now}
                  isFocused={task.id === effectiveFocusedId}
                  isExpanded={task.id === expandedId}
                  isDimmed={confirmingRowId !== null && confirmingRowId !== task.id}
                  graceMs={graceMs}
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
}

export function BackgroundTasksDialogView({ open, onOpenChange, tasks, onStop, graceMs }: ViewProps) {
  const headingId = useId()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(720px,calc(100vw-2rem))]"
        size="lg"
        aria-labelledby={headingId}
      >
        <DialogHeader className="flex-row items-center justify-between gap-4">
          <DialogTitle id={headingId} className="text-[18px] font-medium leading-none">
            Background tasks
          </DialogTitle>
          {tasks.length > 0 && (
            <span className="text-xs text-muted-foreground font-sans tabular-nums flex-shrink-0 mr-6">
              {tasks.length} running
            </span>
          )}
        </DialogHeader>

        <DialogBody className="pt-2">
          <BackgroundTasksDialogBody tasks={tasks} onStop={onStop} graceMs={graceMs} />
        </DialogBody>
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
}

export function BackgroundTasksDialog({
  open,
  onOpenChange,
  socket,
}: BackgroundTasksDialogConnectedProps) {
  const tasks = useBackgroundTasksStore((state) => state.tasks)

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
@media (prefers-reduced-motion: reduce) {
  @keyframes bg-task-row-enter {
    from { opacity: 1; transform: none; }
    to   { opacity: 1; transform: none; }
  }
  @keyframes bg-task-confirm-slide-in {
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
