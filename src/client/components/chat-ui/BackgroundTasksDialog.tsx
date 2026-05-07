import { memo, useCallback, useId, useRef, useState } from "react"
import { ChevronRight, Square } from "lucide-react"
import type { BackgroundTask } from "../../../shared/types"
import type { ClientCommand } from "../../../shared/protocol"
import { useNow } from "../../hooks/useNow"
import { formatAge, formatStartedClock } from "../../lib/formatters"
import { useBackgroundTasksStore } from "../../stores/backgroundTasksStore"
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip"
import { cn } from "../../lib/utils"

// ---------------------------------------------------------------------------
// Socket interface — minimal surface used by the dialog
// ---------------------------------------------------------------------------

interface SocketLike {
  command: (command: ClientCommand) => Promise<unknown>
}

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
  onFocus: (id: string) => void
  onToggleExpand: (id: string) => void
  onStop: (id: string) => void
}

export const TaskRow = memo(function TaskRow({
  task,
  index,
  now,
  isFocused,
  isExpanded,
  onFocus,
  onToggleExpand,
  onStop,
}: TaskRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const label = taskLabel(task)
  const typeTag = taskTypeTag(task)
  const chatId = taskChatId(task)
  const status = taskStatus(task)
  const age = formatAge(task.startedAt, now)
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault()
        onToggleExpand(task.id)
      }
      const isStop = (e.metaKey || e.ctrlKey) && e.key === "."
      if (isStop) {
        e.preventDefault()
        onStop(task.id)
      }
    },
    [task.id, onToggleExpand, onStop],
  )

  const handleExpandClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onToggleExpand(task.id)
    },
    [task.id, onToggleExpand],
  )

  const handleStopClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onStop(task.id)
    },
    [task.id, onStop],
  )

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
        "group relative flex flex-col px-3 py-2.5 rounded-md transition-colors cursor-default",
        "hover:bg-secondary focus-visible:bg-secondary",
        "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",
        isFocused && "bg-secondary",
      )}
      style={enterStyle}
    >
      {/* Line 1: label + age + expand chevron */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Status dot */}
        <span
          className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 mt-px"
          style={{
            backgroundColor:
              status === "stopping"
                ? "var(--muted-foreground)"
                : "var(--warning)",
          }}
          aria-hidden
        />
        {/* Command/label — mono 14px weight 600 */}
        <span className="flex-1 min-w-0 truncate font-mono text-sm font-semibold leading-snug">
          {label}
        </span>
        {/* Age — mono 13px weight 500 tabular-nums */}
        <span className="flex-shrink-0 font-mono text-[13px] font-medium tabular-nums text-muted-foreground leading-snug">
          {age}
        </span>
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

      {/* Line 2: type tag + chat link + started clock + stop button */}
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
          style={status !== "stopping" ? { color: "var(--warning)" } : undefined}
        >
          {status === "stopping" ? "stopping" : "running"}
        </span>
        {/* Spacer */}
        <span className="flex-1" />
        {/* Stop button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Stop task"
              onClick={handleStopClick}
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
          <TooltipContent side="top">
            Stop task (⌘.)
          </TooltipContent>
        </Tooltip>
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
}

export function BackgroundTasksDialogBody({ tasks, onStop }: BodyProps) {
  const now = useNow(1_000)
  const listRef = useRef<HTMLDivElement>(null)
  const headingId = useId()

  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const focusedIndex = tasks.findIndex((t) => t.id === focusedId)
  const effectiveFocusedId = focusedIndex >= 0 ? focusedId : (tasks[0]?.id ?? null)

  const handleFocus = useCallback((id: string) => {
    setFocusedId(id)
  }, [])

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  const handleStop = useCallback(
    (id: string) => {
      onStop(id, false)
    },
    [onStop],
  )

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
                  onFocus={handleFocus}
                  onToggleExpand={handleToggleExpand}
                  onStop={handleStop}
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
}

export function BackgroundTasksDialogView({ open, onOpenChange, tasks, onStop }: ViewProps) {
  const headingId = useId()

  const handleStop = useCallback(
    (id: string) => {
      onStop(id, false)
    },
    [onStop],
  )

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
          <BackgroundTasksDialogBody tasks={tasks} onStop={handleStop} />
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
  socket?: SocketLike
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
@media (prefers-reduced-motion: reduce) {
  @keyframes bg-task-row-enter {
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
