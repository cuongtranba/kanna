
import type { AgentProvider, ChatBackgroundTask, KannaStatus, PendingToolSnapshot } from "../shared/types"
import type { ActiveTurn, ClaudeSessionState, StartingTurn } from "./claude-session-state"
import type { PendingToolSlots } from "./pending-tool-slot"


export interface SessionStateQueryDeps {
  activeTurns: Map<string, ActiveTurn>
  startingTurns: Map<string, StartingTurn>
  pendingTools: PendingToolSlots
  claudeSessions: Map<string, ClaudeSessionState>
  drainingStreams: { keys(): IterableIterator<string> }
  isClaudeSdkProvider: (provider: AgentProvider) => boolean
  hasPendingBackgroundTask: (session: ClaudeSessionState, now: number) => boolean
  resolveClaudeIdleMs: () => number
  resolveBackgroundTaskMaxMs: () => number
  resolveBackgroundTaskMaxWakes: () => number
  hasLiveWorkflow: (chatId: string) => boolean
  closeClaudeSession: (chatId: string, session: ClaudeSessionState) => void
  emitStateChange: (chatId: string) => void
  wakeBackgroundTaskSession: (
    chatId: string,
    taskIds: string[],
    wakeNumber: number,
    maxWakes: number,
  ) => void
  notifyBackgroundTasksAbandoned: (chatId: string, taskIds: string[]) => void
}


export interface ChatBusyDeps {
  activeTurns: { has(chatId: string): boolean }
  startingTurns: { has(chatId: string): boolean }
  pendingTools: { has(chatId: string): boolean }
  claudeSessions: { get(chatId: string): { selfWakeActive: boolean } | undefined }
}

export function isChatBusy(deps: ChatBusyDeps, chatId: string): boolean {
  return deps.activeTurns.has(chatId)
    || deps.startingTurns.has(chatId)
    || deps.pendingTools.has(chatId)
    || deps.claudeSessions.get(chatId)?.selfWakeActive === true
}

export function getActiveStatuses(deps: SessionStateQueryDeps): Map<string, KannaStatus> {
  const statuses = new Map<string, KannaStatus>()
  for (const [chatId, turn] of deps.activeTurns.entries()) {
    statuses.set(chatId, turn.status)
  }
  for (const chatId of deps.startingTurns.keys()) {
    if (statuses.has(chatId)) continue
    statuses.set(chatId, "starting")
  }
  for (const chatId of deps.pendingTools.chatIds()) {
    if (statuses.has(chatId)) continue
    statuses.set(chatId, "waiting_for_user")
  }
  for (const [chatId, session] of deps.claudeSessions.entries()) {
    if (statuses.has(chatId)) continue
    if (session.selfWakeActive) statuses.set(chatId, "running")
  }
  return statuses
}

export function getBackgroundTasksByChatId(
  deps: SessionStateQueryDeps,
): Map<string, ChatBackgroundTask[]> {
  const out = new Map<string, ChatBackgroundTask[]>()
  for (const [chatId, session] of deps.claudeSessions.entries()) {
    if (!session.hasBackgroundTasks()) continue
    const tasks: ChatBackgroundTask[] = session.getBackgroundTaskEntries()
      .map(([id, meta]) => ({
        id,
        taskType: meta.taskType,
        description: meta.description,
        startedAt: meta.startedAt,
        hasOutput: meta.outputPath != null,
      }))
      .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
    out.set(chatId, tasks)
  }
  return out
}

export function getWaitStartedAtByChatId(deps: SessionStateQueryDeps): Map<string, number> {
  const out = new Map<string, number>()
  for (const [chatId, turn] of deps.activeTurns.entries()) {
    if (turn.waitStartedAt != null) out.set(chatId, turn.waitStartedAt)
  }
  for (const chatId of deps.pendingTools.chatIds()) {
    if (out.has(chatId)) continue
    const parked = deps.pendingTools.get(chatId)
    if (parked) out.set(chatId, parked.parkedAt)
  }
  return out
}

export function getPendingTool(
  deps: SessionStateQueryDeps,
  chatId: string,
): PendingToolSnapshot | null {
  const pending = deps.pendingTools.get(chatId)
  if (!pending) return null
  return { toolUseId: pending.toolUseId, toolKind: pending.tool.toolKind }
}

export function getDrainingChatIds(deps: SessionStateQueryDeps): Set<string> {
  return new Set(deps.drainingStreams.keys())
}

export function getClaudeSessionStates(
  deps: SessionStateQueryDeps,
): Map<string, "warming" | "active" | "idle"> {
  const out = new Map<string, "warming" | "active" | "idle">()
  const now = Date.now()
  for (const [chatId, session] of deps.claudeSessions) {
    const activeProv = deps.activeTurns.get(chatId)?.provider
    if (activeProv !== undefined && deps.isClaudeSdkProvider(activeProv)) {
      out.set(chatId, "active")
    } else if (session.selfWakeActive) {
      out.set(chatId, "active")
    } else if (deps.hasPendingBackgroundTask(session, now)) {
      out.set(chatId, "warming")
    } else if (now - session.lastUsedAt >= deps.resolveClaudeIdleMs()) {
      out.set(chatId, "idle")
    } else {
      out.set(chatId, "warming")
    }
  }
  return out
}


export function hasPendingBackgroundTask(session: ClaudeSessionState, now: number): boolean {
  return session.isHoldingWork(now)
}

export function backgroundTaskGuardExpired(session: ClaudeSessionState, now: number): boolean {
  return session.guardExpired(now)
}


export interface SessionInUseDeps {
  activeTurns: { has(chatId: string): boolean }
  startingTurns: { has(chatId: string): boolean }
  pendingTools: { has(chatId: string): boolean }
  hasLiveWorkflow: (chatId: string) => boolean
  hasPendingBackgroundTask: (session: ClaudeSessionState, now: number) => boolean
}

export function isSessionInUse(
  deps: SessionInUseDeps,
  chatId: string,
  session: ClaudeSessionState,
  now: number,
): boolean {
  if (deps.activeTurns.has(chatId)) return true
  if (deps.startingTurns.has(chatId)) return true
  if (deps.pendingTools.has(chatId)) return true
  if (session.pendingPromptSeqs.length > 0) return true
  if (deps.hasLiveWorkflow(chatId)) return true
  if (deps.hasPendingBackgroundTask(session, now)) return true
  if (session.selfWakeActive) return true
  return false
}


export function isClaudeSessionIdle(
  deps: SessionStateQueryDeps,
  chatId: string,
  session: ClaudeSessionState,
  now = Date.now(),
): boolean {
  const activeProv = deps.activeTurns.get(chatId)?.provider
  if (activeProv !== undefined && deps.isClaudeSdkProvider(activeProv)) return false
  if (isSessionInUse(deps, chatId, session, now)) return false
  return now - session.lastUsedAt >= deps.resolveClaudeIdleMs()
}

function escalateExpiredBackgroundTaskGuard(
  deps: SessionStateQueryDeps,
  chatId: string,
  session: ClaudeSessionState,
  now: number,
): void {
  const activeProv = deps.activeTurns.get(chatId)?.provider
  const hasActiveClaudeTurn = activeProv !== undefined && deps.isClaudeSdkProvider(activeProv)
  const busy = hasActiveClaudeTurn
    || session.pendingPromptSeqs.length > 0
    || deps.hasLiveWorkflow(chatId)
  if (busy) {
    session.backgroundTaskDeadlineAt = now + deps.resolveBackgroundTaskMaxMs()
    return
  }
  const maxWakes = deps.resolveBackgroundTaskMaxWakes()
  if (session.backgroundTaskWakeCount < maxWakes) {
    session.backgroundTaskWakeCount += 1
    session.backgroundTaskDeadlineAt = now + deps.resolveBackgroundTaskMaxMs()
    deps.wakeBackgroundTaskSession(
      chatId,
      session.getBackgroundTaskIds(),
      session.backgroundTaskWakeCount,
      maxWakes,
    )
    return
  }
  if (now - session.lastUsedAt < deps.resolveClaudeIdleMs()) return
  const abandonedIds = session.abandonBackgroundTasks()
  deps.closeClaudeSession(chatId, session)
  deps.notifyBackgroundTasksAbandoned(chatId, abandonedIds)
  deps.emitStateChange(chatId)
}

export function sweepIdleClaudeSessions(
  deps: SessionStateQueryDeps,
  now = Date.now(),
): void {
  for (const [chatId, session] of [...deps.claudeSessions.entries()]) {
    if (backgroundTaskGuardExpired(session, now)) {
      escalateExpiredBackgroundTaskGuard(deps, chatId, session, now)
      continue
    }
    if (!isClaudeSessionIdle(deps, chatId, session, now)) continue
    deps.closeClaudeSession(chatId, session)
    deps.emitStateChange(chatId)
  }
}
