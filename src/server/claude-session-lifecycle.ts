/**
 * Standalone session-lifecycle helpers for AgentCoordinator.
 *
 * Extracted from agent.ts so the eight related private methods live in their
 * own testable module. The coordinator delegates to these functions by passing
 * an object literal that satisfies `SessionLifecycleDeps`.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * the deps interface, including the `homeDir` used by computeWorkflowsDir so
 * tests can control it without real OS calls.
 */

import type { ClaudeDriverPreference } from "../shared/types"
import type { ClaudeSessionState, ActiveTurn } from "./claude-session-state"
import type { TokenUnavailability } from "./oauth-pool/oauth-token-pool"
import { computeWorkflowsDir } from "./claude-pty/jsonl-path.adapter"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the operations this module calls.
// ---------------------------------------------------------------------------

/** Subset of OAuthTokenPool used by the lifecycle helpers. */
interface LifecycleOAuthPool {
  release(chatId: string): void
  describeUnavailability(reservedFor?: string): TokenUnavailability[]
}

/** Subset of WorkflowRegistry used by the lifecycle helpers. */
interface LifecycleWorkflowRegistry {
  hasActiveRun(chatId: string, freshnessMs: number, now: number): boolean
  register(chatId: string, workflowsDir: string): void
  unregister(chatId: string): void
}

/** Subset of EventStore used by buildPoolUnavailableMessage. */
interface LifecycleStore {
  getChat(id: string): { title?: string | null } | null | undefined
}

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface SessionLifecycleDeps {
  /** Returns the current app settings snapshot. Only lifecycle + driver slices are read. */
  getAppSettingsSnapshot(): {
    claudeDriver?: {
      lifecycle?: {
        idleTimeoutMs?: number
        maxConcurrent?: number
      }
    }
  }

  /** Default idle timeout (from claudeSessionLifecycle.idleMs constructor arg). */
  defaultIdleMs: number
  /** Default max resident sessions (from claudeSessionLifecycle.maxResidentSessions). */
  defaultMaxResidentSessions: number

  /** The live claudeSessions map owned by the coordinator. */
  claudeSessions: Map<string, ClaudeSessionState>
  /** Active turns map — only `.has()` is called. */
  activeTurns: Pick<Map<string, ActiveTurn>, "has">

  /** OAuth token pool, or null when no pool is configured. */
  oauthPool: LifecycleOAuthPool | null

  /** Workflow registry, or null when not configured. */
  workflowRegistry: LifecycleWorkflowRegistry | null

  /** Returns the currently resolved Claude driver preference. */
  resolveClaudeDriverPreference(): ClaudeDriverPreference

  /** Emit a state-change event for a chat (called after evictions). */
  emitStateChange(chatId: string): void

  /** Store — used by buildPoolUnavailableMessage to resolve chat titles. */
  store: LifecycleStore

  /** Home directory — injected so tests do not need a real OS call. */
  homeDir: string
}

// ---------------------------------------------------------------------------
// Exported standalone functions
// ---------------------------------------------------------------------------

/**
 * Resolve the effective Claude idle timeout. Prefers the user-configured
 * override in app settings; falls back to the constructor default.
 */
export function resolveClaudeIdleMs(deps: SessionLifecycleDeps): number {
  const fromSettings = deps.getAppSettingsSnapshot().claudeDriver?.lifecycle?.idleTimeoutMs
  if (typeof fromSettings === "number" && Number.isFinite(fromSettings) && fromSettings > 0) {
    return Math.round(fromSettings)
  }
  return deps.defaultIdleMs
}

/**
 * Resolve the effective max-resident-sessions cap. Prefers the user-configured
 * override in app settings; falls back to the constructor default.
 */
export function resolveClaudeMaxResident(deps: SessionLifecycleDeps): number {
  const fromSettings = deps.getAppSettingsSnapshot().claudeDriver?.lifecycle?.maxConcurrent
  if (typeof fromSettings === "number" && Number.isFinite(fromSettings) && fromSettings > 0) {
    return Math.round(fromSettings)
  }
  return deps.defaultMaxResidentSessions
}

/**
 * True when the chat is hosting an in-flight background Workflow. A live
 * workflow runs inside the warm PTY claude process but registers no
 * activeTurn, pendingPromptSeq, or lastUsedAt bump, so without this signal
 * the idle reaper / budget enforcer would tear the process down mid-run and
 * abort the workflow.
 *
 * Liveness comes from the registry's live-run-dir probe, NOT the terminal
 * `wf_<runId>.json` sidecar: Claude only flushes that sidecar at/near
 * termination, so a sidecar-only check is blind for the entire run (the
 * window the guard must cover). `hasActiveRun` reads the live
 * `subagents/workflows/wf_*` transcript dirs (written from second one) and
 * requires activity within one idle window so a stalled/crashed run still
 * eventually reaps.
 */
export function hasLiveWorkflow(deps: SessionLifecycleDeps, chatId: string): boolean {
  return deps.workflowRegistry?.hasActiveRun(chatId, resolveClaudeIdleMs(deps), Date.now()) ?? false
}

/**
 * True while the session has at least one Claude-Code background Bash task
 * that has not yet settled. Primary gate is set size > 0: settle events
 * (task_notification) remove their id from the set, so the guard clears the
 * moment the last task reports. The deadline is a zombie backstop only —
 * it fires when a settle notification is genuinely lost (SDK crash / dropped
 * message) and is reset on every launch and settle, so it never expires
 * during normal execution regardless of task duration.
 */
export function hasPendingBackgroundTask(session: ClaudeSessionState, now: number): boolean {
  if (session.backgroundTaskIds.size === 0) return false
  if (now < session.backgroundTaskDeadlineAt) return true
  session.backgroundTaskIds.clear()
  session.backgroundTaskDeadlineAt = 0
  return false
}

/**
 * Tear down a Claude session and (by default) release the OAuth-pool
 * reservation owned by the chat.
 *
 * `keepReservation: true` — used by rate-limit / auth-error rotation
 * paths that have ALREADY claimed a fresh token via `pickActive(chatId)`
 * before calling close. Without this flag, `release(chatId)` would
 * scan reservedBy for `owner === chatId` and drop the *new* token the
 * rotation just claimed, leaking the rotation's reservation (audit #9d).
 */
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
  // For SDK sessions, unregister the workflow dir here. PTY sessions unregister
  // inside the driver's cleanupResources (driver.ts) — do not double-fire.
  if (deps.resolveClaudeDriverPreference() !== "pty") {
    deps.workflowRegistry?.unregister(chatId)
  }
}

/**
 * Register the workflow disk-watch dir for an SDK session once the session
 * token is known. No-op if the registry is absent, already registered, or
 * the driver preference is PTY (the PTY driver registers from its own
 * resolved transcript path in driver.ts cleanup and must not be double-fired).
 */
export function maybeRegisterSdkWorkflowsDir(
  deps: SessionLifecycleDeps,
  session: ClaudeSessionState,
): void {
  if (!deps.workflowRegistry) return
  if (session.workflowsDirRegistered) return
  // PTY registers from its own resolved transcript path; SDK derives from session_token.
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

/**
 * Evict LRU idle sessions when the resident count exceeds the configured cap.
 * Never evicts: the protected chat, chats with an active turn, chats with
 * queued prompts, chats with a live workflow, or chats with a pending
 * background task.
 */
export function enforceClaudeSessionBudget(
  deps: SessionLifecycleDeps,
  protectedChatId?: string,
): void {
  const max = resolveClaudeMaxResident(deps)
  if (max <= 0 || deps.claudeSessions.size <= max) return

  const now = Date.now()
  const candidates = [...deps.claudeSessions.entries()]
    .filter(([chatId, session]) => (
      chatId !== protectedChatId
      && !deps.activeTurns.has(chatId)
      && session.pendingPromptSeqs.length === 0
      && !hasLiveWorkflow(deps, chatId)
      && !hasPendingBackgroundTask(session, now)
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

/**
 * Format a refusal message when `pickActive(chatId)` returned null but the
 * pool has tokens. Names the offending tokens so the user knows which
 * chat to close or which token to add a quota to, instead of seeing the
 * generic "all tokens unavailable" line that doesn't say what's holding
 * them. `scopeSuffix` lets the subagent path tag its variant.
 */
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
