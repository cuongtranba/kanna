import { useCallback, useEffect, useMemo, useRef } from "react"
import { CornerDownLeft, Plus, Search, Star } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog"
import { Kbd, KbdGroup } from "../ui/kbd"
import { StateMark } from "../ui/state-mark"
import { useKannaStateStore } from "../../stores/kannaStateStore"
import { useQuickSwitcherStore } from "../../stores/quickSwitcherStore"
import { useNow } from "../../hooks/useNow"
import { statusLabel, statusTone, statusToneClass } from "../../lib/statusLabel"
import { formatSidebarAgeLabel } from "../../lib/formatters"
import { cn } from "../../lib/utils"
import {
  filterProjects,
  filterSessions,
  isMacUserAgent,
  shortenHomePath,
  toQuickSwitcherProjects,
  toQuickSwitcherSessions,
  type QuickSwitcherProject,
  type QuickSwitcherSession,
} from "../../lib/quickSwitcher"
import type { DomPort } from "../../ports/domPort"
import { domAdapter } from "../../adapters/dom.adapter"
import type { LocalProjectSummary } from "../../../shared/types"

const LIST_ID = "quick-switcher-list"

export interface QuickSwitcherProps {
  homeDir: string
  localProjects: readonly LocalProjectSummary[]
  onOpenChat: (chatId: string) => void
  onCreateChat: (projectId: string) => void
  onOpenProjectPath: (localPath: string) => void
  ports?: { dom?: DomPort }
}

export function QuickSwitcher({
  homeDir,
  localProjects,
  onOpenChat,
  onCreateChat,
  onOpenProjectPath,
  ports,
}: QuickSwitcherProps) {
  const dom = ports?.dom ?? domAdapter
  const open = useQuickSwitcherStore((state) => state.open)
  const step = useQuickSwitcherStore((state) => state.step)
  const query = useQuickSwitcherStore((state) => state.query)
  const highlight = useQuickSwitcherStore((state) => state.highlight)
  const projectId = useQuickSwitcherStore((state) => state.projectId)
  const projectName = useQuickSwitcherStore((state) => state.projectName)
  const closeSwitcher = useQuickSwitcherStore((state) => state.closeSwitcher)
  const setQuery = useQuickSwitcherStore((state) => state.setQuery)
  const setHighlight = useQuickSwitcherStore((state) => state.setHighlight)
  const moveHighlight = useQuickSwitcherStore((state) => state.moveHighlight)
  const drillIntoProject = useQuickSwitcherStore((state) => state.drillIntoProject)
  const backToProjects = useQuickSwitcherStore((state) => state.backToProjects)

  const sidebarData = useKannaStateStore((state) => state.sidebarData)
  const nowMs = useNow(30_000)
  const listRef = useRef<HTMLUListElement | null>(null)

  const projects = useMemo(
    () => filterProjects(toQuickSwitcherProjects(sidebarData, localProjects), query),
    [sidebarData, localProjects, query],
  )
  const sessions = useMemo(() => {
    if (step !== "sessions" || projectId === null) return []
    return filterSessions(toQuickSwitcherSessions(sidebarData, projectId), query)
  }, [sidebarData, projectId, query, step])

  const rowCount = step === "projects" ? projects.length : sessions.length + 1
  const isMac = isMacUserAgent(dom.getUserAgent())

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) closeSwitcher()
  }, [closeSwitcher])

  const startNewChat = useCallback((targetProjectId: string) => {
    closeSwitcher()
    onCreateChat(targetProjectId)
  }, [closeSwitcher, onCreateChat])

  const openSession = useCallback((chatId: string) => {
    closeSwitcher()
    onOpenChat(chatId)
  }, [closeSwitcher, onOpenChat])

  const startProjectChat = useCallback((project: QuickSwitcherProject) => {
    closeSwitcher()
    if (project.projectId === null) {
      onOpenProjectPath(project.localPath)
      return
    }
    onCreateChat(project.projectId)
  }, [closeSwitcher, onCreateChat, onOpenProjectPath])

  const commitProject = useCallback((project: QuickSwitcherProject) => {
    if (project.sessionCount === 0 || project.projectId === null) {
      startProjectChat(project)
      return
    }
    drillIntoProject(project.projectId, project.name)
  }, [drillIntoProject, startProjectChat])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector('[data-quick-switcher-active="true"]')
    if (active instanceof HTMLElement) active.scrollIntoView({ block: "nearest" })
  }, [highlight, step, query])

  const activeId = activeOptionId(step, highlight, projects, sessions)

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      moveHighlight(1, rowCount)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      moveHighlight(-1, rowCount)
      return
    }
    if (event.key === "Escape" && step === "sessions") {
      event.preventDefault()
      event.stopPropagation()
      backToProjects()
      return
    }
    if (event.key === "Backspace" && query === "" && step === "sessions") {
      event.preventDefault()
      backToProjects()
      return
    }
    if (event.key !== "Enter") return

    event.preventDefault()
    if (step === "projects") {
      const project = projects[highlight]
      if (!project) return
      if (event.metaKey || event.ctrlKey) {
        startProjectChat(project)
        return
      }
      commitProject(project)
      return
    }

    if (projectId === null) return
    if (event.metaKey || event.ctrlKey || highlight >= sessions.length) {
      startNewChat(projectId)
      return
    }
    const session = sessions[highlight]
    if (session) openSession(session.chatId)
  }, [backToProjects, commitProject, highlight, moveHighlight, openSession, projectId, projects, query, rowCount, sessions, startNewChat, startProjectChat, step])

  const handleQueryChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
  }, [setQuery])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[640px] gap-0 p-0 md:top-[12vh] md:translate-y-0"
      >
        <DialogTitle className="sr-only">
          {step === "projects" ? "Switch project" : `Sessions in ${projectName}`}
        </DialogTitle>

        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={LIST_ID}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={step === "projects" ? "Search projects" : `Search sessions in ${projectName}`}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder={step === "projects" ? "Search projects…" : `Search sessions in ${projectName}…`}
            className="min-w-0 flex-1 bg-transparent pr-8 text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </div>

        {step === "sessions" ? (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <span className="truncate font-medium text-foreground">{projectName}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{sessions.length} {sessions.length === 1 ? "session" : "sessions"}</span>
          </div>
        ) : null}

        <ul
          ref={listRef}
          id={LIST_ID}
          role="listbox"
          aria-label={step === "projects" ? "Projects" : `Sessions in ${projectName}`}
          className="max-h-[min(24rem,50vh)] min-h-0 flex-1 overflow-y-auto py-1"
        >
          {step === "projects" ? projects.map((project, index) => (
            <ProjectOption
              key={project.localPath}
              project={project}
              homeDir={homeDir}
              active={index === highlight}
              index={index}
              onHighlight={setHighlight}
              onCommit={commitProject}
            />
          )) : null}

          {step === "sessions" ? sessions.map((session, index) => (
            <SessionOption
              key={session.chatId}
              session={session}
              nowMs={nowMs}
              active={index === highlight}
              index={index}
              onHighlight={setHighlight}
              onCommit={openSession}
            />
          )) : null}

          {step === "sessions" && projectId !== null ? (
            <NewChatOption
              projectId={projectId}
              projectName={projectName}
              active={highlight >= sessions.length}
              index={sessions.length}
              separated={sessions.length > 0}
              onHighlight={setHighlight}
              onCommit={startNewChat}
            />
          ) : null}
        </ul>

        {rowCount === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No project matches “{query}”.
          </p>
        ) : null}

        <p aria-live="polite" className="sr-only">
          {rowCount} {rowCount === 1 ? "result" : "results"}
        </p>

        <FooterHints isMac={isMac} step={step} />
      </DialogContent>
    </Dialog>
  )
}

function activeOptionId(
  step: "projects" | "sessions",
  highlight: number,
  projects: readonly QuickSwitcherProject[],
  sessions: readonly QuickSwitcherSession[],
): string | undefined {
  if (step === "projects") {
    const project = projects[highlight]
    return project ? projectOptionId(project) : undefined
  }
  if (highlight >= sessions.length) return "quick-switcher-new-chat"
  const session = sessions[highlight]
  return session ? `quick-switcher-session-${session.chatId}` : undefined
}

function projectOptionId(project: QuickSwitcherProject): string {
  return `quick-switcher-project-${project.localPath}`
}

const OPTION_CLASS = "flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left"

function ProjectOption({ project, homeDir, active, index, onHighlight, onCommit }: {
  project: QuickSwitcherProject
  homeDir: string
  active: boolean
  index: number
  onHighlight: (index: number) => void
  onCommit: (project: QuickSwitcherProject) => void
}) {
  const handleEnter = useCallback(() => onHighlight(index), [index, onHighlight])
  const handleClick = useCallback(() => onCommit(project), [onCommit, project])

  return (
    <li
      id={projectOptionId(project)}
      role="option"
      aria-selected={active}
      data-quick-switcher-active={active}
      onMouseEnter={handleEnter}
      onClick={handleClick}
      className={cn(OPTION_CLASS, active ? "bg-muted" : "hover:bg-muted/40")}
    >
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-sm", active ? "font-semibold" : "font-medium")}>
            {project.name}
          </span>
          {project.starred ? (
            <Star aria-label="Starred" className="size-3 shrink-0 fill-current text-muted-foreground" />
          ) : null}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {shortenHomePath(project.localPath, homeDir)}
        </span>
      </span>
      {project.sessionCount > 0 ? (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {project.sessionCount}
        </span>
      ) : null}
    </li>
  )
}

function SessionOption({ session, nowMs, active, index, onHighlight, onCommit }: {
  session: QuickSwitcherSession
  nowMs: number
  active: boolean
  index: number
  onHighlight: (index: number) => void
  onCommit: (chatId: string) => void
}) {
  const handleEnter = useCallback(() => onHighlight(index), [index, onHighlight])
  const handleClick = useCallback(() => onCommit(session.chatId), [onCommit, session.chatId])
  const tone = statusTone(session.status)
  const age = formatSidebarAgeLabel(session.lastMessageAt, nowMs)

  return (
    <li
      id={`quick-switcher-session-${session.chatId}`}
      role="option"
      aria-selected={active}
      data-quick-switcher-active={active}
      onMouseEnter={handleEnter}
      onClick={handleClick}
      className={cn(OPTION_CLASS, active ? "bg-muted" : "hover:bg-muted/40")}
    >
      <StateMark tone={tone} className={cn("shrink-0", statusToneClass(tone))} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className={cn("truncate text-sm", active ? "font-semibold" : "font-medium")}>
          {session.title}
        </span>
        <span className={cn("truncate text-xs", statusToneClass(tone))}>
          {statusLabel(session.status)}
        </span>
      </span>
      {age ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{age}</span> : null}
    </li>
  )
}

function NewChatOption({ projectId, projectName, active, index, separated, onHighlight, onCommit }: {
  projectId: string
  projectName: string
  active: boolean
  index: number
  separated: boolean
  onHighlight: (index: number) => void
  onCommit: (projectId: string) => void
}) {
  const handleEnter = useCallback(() => onHighlight(index), [index, onHighlight])
  const handleClick = useCallback(() => onCommit(projectId), [onCommit, projectId])

  return (
    <li
      id="quick-switcher-new-chat"
      role="option"
      aria-selected={active}
      data-quick-switcher-active={active}
      onMouseEnter={handleEnter}
      onClick={handleClick}
      className={cn(
        OPTION_CLASS,
        separated ? "mt-1 border-t border-border pt-2.5" : "",
        active ? "bg-muted" : "hover:bg-muted/40",
      )}
    >
      <Plus aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        New chat in {projectName}
      </span>
    </li>
  )
}

function FooterHints({ isMac, step }: { isMac: boolean; step: "projects" | "sessions" }) {
  const modifier = isMac ? "⌘" : "Ctrl"
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground">
      <Hint keys={["↑", "↓"]}>Navigate</Hint>
      <Hint keys={[<CornerDownLeft key="enter" aria-hidden className="size-3" />]}>
        {step === "projects" ? "Open" : "Open session"}
      </Hint>
      <Hint keys={[modifier, <CornerDownLeft key="enter" aria-hidden className="size-3" />]}>New chat</Hint>
      <Hint keys={["Esc"]}>{step === "projects" ? "Close" : "Back"}</Hint>
    </div>
  )
}

function Hint({ keys, children }: { keys: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <KbdGroup>
        {keys.map((key, index) => <Kbd key={index}>{key}</Kbd>)}
      </KbdGroup>
      <span>{children}</span>
    </span>
  )
}
