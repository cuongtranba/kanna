
import type { ClaudeDriverPreference } from "../shared/types"
import type { ClaudeSessionState, ActiveTurn } from "./claude-session-state"
import type { TokenUnavailability } from "./oauth-pool/oauth-token-pool"
import { computeWorkflowsDir } from "./claude-pty/jsonl-path.adapter"
import {
  hasPendingBackgroundTask,
  backgroundTaskGuardExpired,
  isSessionInUse,
} from "./claude-session-state-queries"

export { hasPendingBackgroundTask, backgroundTaskGuardExpired }


interface LifecycleOAuthPool {
  release(chatId: string): void
  describeUnavailability(reservedFor?: string): TokenUnavailability[]
}

interface LifecycleWorkflowRegistry {
  hasActiveRun(chatId: string, freshnessMs: number, now: number): boolean
  register(chatId: string, workflowsDir: string): void
  unregister(chatId: string): void
}

interface LifecycleStore {
  getChat(id: string): { title?: string | null } | null | undefined
}


export interface SessionLifecycleDeps {
  getAppSettingsSnapshot(): {
    claudeDriver?: {
      lifecycle?: {
        idleTimeoutMs?: number
        maxConcurrent?: number
      }
    }
  }

  defaultIdleMs: number
  defaultMaxResidentSessions: number

  claudeSessions: Map<string, ClaudeSessionState>
  activeTurns: Pick<Map<string, ActiveTurn>, "has">
  startingTurns: { has(chatId: string): boolean }
  pendingTools: { has(chatId: string): boolean }

  oauthPool: LifecycleOAuthPool | null

  workflowRegistry: LifecycleWorkflowRegistry | null

  resolveClaudeDriverPreference(): ClaudeDriverPreference

  emitStateChange(chatId: string): void

  store: LifecycleStore

  homeDir: string
}


export function resolveClaudeIdleMs(deps: SessionLifecycleDeps): number {
  const fromSettings = deps.getAppSettingsSnapshot().claudeDriver?.lifecycle?.idleTimeoutMs
  if (typeof fromSettings === "number" && Number.isFinite(fromSettings) && fromSettings > 0) {
    return Math.round(fromSettings)
  }
  return deps.defaultIdleMs
}

export function resolveClaudeMaxResident(deps: SessionLifecycleDeps): number {
  const fromSettings = deps.getAppSettingsSnapshot().claudeDriver?.lifecycle?.maxConcurrent
  if (typeof fromSettings === "number" && Number.isFinite(fromSettings) && fromSettings > 0) {
    return Math.round(fromSettings)
  }
  return deps.defaultMaxResidentSessions
}

export function hasLiveWorkflow(deps: SessionLifecycleDeps, chatId: string): boolean {
  return deps.workflowRegistry?.hasActiveRun(chatId, resolveClaudeIdleMs(deps), Date.now()) ?? false
}

export function closeClaudeSession(
  deps: SessionLifecycleDeps,
  chatId: string,
  session: ClaudeSessionState,
  opts?: { keepReservation?: boolean },
): void {
  if (deps.claudeSessions.get(chatId) === session) {
    deps.claudeSessions.delete(chatId)
  }
  if (!opts?.keepReservation) {
    deps.oauthPool?.release(chatId)
  }
  session.session.close()
  if (deps.resolveClaudeDriverPreference() !== "pty") {
    deps.workflowRegistry?.unregister(chatId)
  }
}

export function maybeRegisterSdkWorkflowsDir(
  deps: SessionLifecycleDeps,
  session: ClaudeSessionState,
): void {
  if (!deps.workflowRegistry) return
  if (session.workflowsDirRegistered) return
  if (deps.resolveClaudeDriverPreference() === "pty") return
  if (!session.sessionToken) return
  const dir = computeWorkflowsDir({
    homeDir: deps.homeDir,
    cwd: session.localPath,
    sessionId: session.sessionToken,
  })
  deps.workflowRegistry.register(session.chatId, dir)
  session.workflowsDirRegistered = true
}

export function enforceClaudeSessionBudget(
  deps: SessionLifecycleDeps,
  protectedChatId?: string,
): void {
  const max = resolveClaudeMaxResident(deps)
  if (max <= 0 || deps.claudeSessions.size <= max) return

  const now = Date.now()
  const sessionInUseDeps = {
    activeTurns: deps.activeTurns,
    startingTurns: deps.startingTurns,
    pendingTools: deps.pendingTools,
    hasLiveWorkflow: (chatId: string) => hasLiveWorkflow(deps, chatId),
    hasPendingBackgroundTask: (session: ClaudeSessionState, n: number) => hasPendingBackgroundTask(session, n),
  }

  const candidates = [...deps.claudeSessions.entries()]
    .filter(([chatId, session]) => (
      chatId !== protectedChatId
      && !isSessionInUse(sessionInUseDeps, chatId, session, now)
    ))
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)

  while (deps.claudeSessions.size > max && candidates.length > 0) {
    const next = candidates.shift()
    if (!next) break
    const [chatId, session] = next
    closeClaudeSession(deps, chatId, session)
    deps.emitStateChange(chatId)
  }
}

export function buildPoolUnavailableMessage(
  deps: SessionLifecycleDeps,
  reservedFor: string,
  scopeSuffix: string,
): string {
  const pool = deps.oauthPool
  if (!pool) {
    return `All OAuth tokens are unavailable${scopeSuffix} (rate-limited, errored, or in use).`
  }
  const now = Date.now()
  const fmtTime = (ms: number): string => {
    const mins = Math.max(0, Math.round((ms - now) / 60_000))
    if (mins < 60) return `${mins}m`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m === 0 ? `${h}h` : `${h}h${m}m`
  }
  const lines: string[] = []
  for (const u of pool.describeUnavailability(reservedFor)) {
    if (u.reason === "available") continue
    const label = u.label || u.tokenId.slice(0, 8)
    if (u.reason === "limited") {
      lines.push(`  - ${label}: rate-limited (~${fmtTime(u.until)} remaining)`)
    } else if (u.reason === "reserved") {
      const refs = u.byChatIds.map((id) => {
        const chat = deps.store.getChat(id)
        const title = chat?.title || `chat ${id.slice(0, 8)}`
        return `[${title}](/chat/${id})`
      })
      const joined = refs.length === 0 ? "another chat" : refs.join(", ")
      lines.push(`  - ${label}: in use by ${joined}`)
    } else if (u.reason === "error") {
      lines.push(`  - ${label}: errored${u.message ? ` (${u.message})` : ""}`)
    } else if (u.reason === "disabled") {
      lines.push(`  - ${label}: disabled`)
    }
  }
  const header = `All OAuth tokens are unavailable${scopeSuffix}:`
  const footer = "Close the chat holding a contested token, wait for the rate-limit to reset, or add another token."
  return [header, ...lines, footer].join("\n")
}
