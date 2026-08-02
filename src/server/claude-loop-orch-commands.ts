/**
 * Standalone loop-orchestration command handlers for AgentCoordinator.
 *
 * Extracted from agent.ts so the 11 related private/public methods live in
 * their own testable module. The coordinator delegates to these functions by
 * passing an object literal that satisfies `LoopOrchCommandDeps`.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * the deps interface — including `ensureTrackingFile` which is the sole IO
 * operation used by `setupLoop`.
 */

import type { TranscriptEntry } from "../shared/types"
import type { Subagent, AgentProvider } from "../shared/types"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "./auto-continue/events"
import { deriveChatSchedules, deriveLoopState, type LoopState } from "./auto-continue/read-model"
import { timestamped } from "./claude-message-normalizer"
import { buildTaskNotification } from "./claude-session-config"
import { validateLoopSetup, reconcileTrackingFile, type LoopSetupInput } from "./loop-template"
import type { EnsureTrackingFileArgs, EnsureTrackingFileResult } from "./loop-template-io.adapter"
import type { BackgroundRunOutcome } from "./subagent-orchestrator"
import type { ClaudeSessionState } from "./claude-session-state"
import type { SetupLoopHandlerResult } from "./kanna-mcp"
import { log } from "../shared/log"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the operations this module calls.
// ---------------------------------------------------------------------------

/** Subset of EventStore used by these handlers. */
interface LoopOrchCommandStore {
  getChat(chatId: string): { id: string; projectId: string } | null
  getProject(projectId: string): { localPath: string; id: string } | null
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
  setSessionTokenForProvider(chatId: string, provider: AgentProvider, token: string | null): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
}

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface LoopOrchCommandDeps {
  /** EventStore — subset used by these handlers. */
  store: LoopOrchCommandStore

  /** Live Claude sessions map owned by the coordinator (read-only). */
  claudeSessions: Pick<Map<string, ClaudeSessionState>, "get">

  /** Active turns map — `.has()` to check existence. */
  activeTurns: Pick<Map<string, unknown>, "has">

  /** Returns all configured subagents. */
  getSubagents(): Subagent[]

  /** Returns the current app settings snapshot for subagentRuntime config. */
  getAppSettingsSnapshot(): {
    subagentRuntime?: {
      defaultLoopSubagentId?: string | null
    } | null
  }

  /**
   * Tears down the given Claude session. No permit semantics here — caller
   * must ensure the session is in a stable state before calling.
   */
  closeClaudeSession(chatId: string, session: ClaudeSessionState): void

  /**
   * Appends an AutoContinueEvent to the store, notifies the schedule manager,
   * and emits a state-change event for the chat.
   */
  emitAutoContinueEvent(event: AutoContinueEvent): Promise<void>

  /**
   * IO adapter: create or reconcile the loop tracking file on disk. Injected
   * so this module stays IO-free. See `loop-template-io.adapter.ts`.
   */
  ensureTrackingFile(args: EnsureTrackingFileArgs): Promise<EnsureTrackingFileResult>

  /**
   * Returns the current armed-loop state for a chat, or null if disarmed.
   * Injected (rather than calling the module-level `isLoopArmed` fn) so
   * AgentCoordinator can be monkey-patched in tests via
   * `coordinator.isLoopArmed = () => ({...})`.
   */
  isLoopArmed(chatId: string): LoopState | null
}

// ---------------------------------------------------------------------------
// Exported standalone functions
// ---------------------------------------------------------------------------

// ── Loop + background delivery ──────────────────────────────────────────────

/**
 * Wipe the main-agent's Claude session context (the /clear equivalent).
 *
 * Three things happen:
 * - The persisted session token is set to null (so the next spawn starts fresh).
 * - The live session's `suppressSessionTokenPersist` flag is set to true so the
 *   in-flight stream cannot overwrite the null we just wrote (avoids a
 *   121 ms race on setup_loop /clear).
 * - An idle warm SDK session is torn down so it cannot be reused in-band by
 *   the next turn (which would make the /clear a no-op).
 */
export async function clearClaudeSessionContext(
  deps: LoopOrchCommandDeps,
  chatId: string,
): Promise<void> {
  await deps.store.setSessionTokenForProvider(chatId, "claude", null)
  const session = deps.claudeSessions.get(chatId)
  if (!session) return
  session.suppressSessionTokenPersist = true
  if (!deps.activeTurns.has(chatId)) {
    deps.closeClaudeSession(chatId, session)
  }
}

/**
 * Deliver a finished `run_in_background` subagent's result back into the
 * main chat as a fresh turn AND clear the main-agent's Claude session so the
 * next turn starts with a fresh context window. Wired as the orchestrator's
 * `onBackgroundRunComplete` hook.
 *
 * Loop-orchestration invariant: main is stateless-in-context / stateful-in-file.
 * PROGRESS.md is the durability contract; every delivery re-reads it. Subagent
 * output is NOT carried forward as prompt content — the subagent is expected
 * to have written its findings into PROGRESS.md before terminating.
 *
 * See adr-20260711-notification-driven-loop-orchestration.
 */
export async function deliverSubagentToMain(
  deps: LoopOrchCommandDeps,
  chatId: string,
  runId: string,
  outcome: BackgroundRunOutcome,
): Promise<void> {
  if (!deps.store.getChat(chatId)) return

  // Structured re-entry: the completion is delivered as the same
  // <task-notification> XML Claude Code's own background agents use
  // (LocalAgentTask), so the model parses task identity/status with the
  // format it already knows from native training.
  //
  // When a loop is armed, the FULL loop discipline prompt follows the
  // notification on every wake — not a generic "decide next action" string,
  // which drifted into self-implementation (the 7.5h marathon-turn bug).
  // Armed notifications carry NO <result> body: PROGRESS.md is the loop's
  // only durability contract. Non-loop deliveries include the (truncated)
  // result since ad-hoc background delegations have no tracking file.
  const armed = isLoopArmed(deps, chatId)
  const notification = buildTaskNotification(runId, outcome, { includeResult: !armed })
  let prompt: string
  if (armed) {
    prompt = `${notification}\n\n${armed.prompt}`
  } else if (outcome.status === "completed") {
    prompt = `${notification}\n\nYour Claude context has been cleared. Read PROGRESS.md if present, then decide the next action.`
  } else {
    prompt = `${notification}\n\nYour Claude context has been cleared. Read PROGRESS.md if present; decide whether to retry, try another approach, or stop.`
  }

  try {
    // Wipe the main-agent's Claude session token so the next spawn starts
    // fresh (the /clear equivalent). Codex path is unaffected.
    await clearClaudeSessionContext(deps, chatId)
    await deps.store.appendMessage(chatId, timestamped({ kind: "context_cleared" }))

    const now = Date.now()
    const scheduleId = crypto.randomUUID()
    await deps.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      timestamp: now,
      chatId,
      scheduleId,
      scheduledAt: now,
      tz: "system",
      source: "subagent_background",
      resetAt: now,
      detectedAt: now,
      prompt,
    })
  } catch (err) {
    log.warn(`[kanna] deliverSubagentToMain failed`, { chatId, runId, err })
  }
}

/**
 * Arm an autonomous loop on the main chat. Validates the loop spec, ensures
 * the tracking file exists (writes a skeleton if absent), then /clears the
 * main-agent Claude session and enqueues the templated recurring prompt so
 * the next turn starts the loop. Backs `mcp__kanna__setup_loop`. See
 * adr-20260711-setup-loop-template.
 */
export async function setupLoop(
  deps: LoopOrchCommandDeps,
  args: {
    chatId: string
    input: LoopSetupInput
  },
): Promise<SetupLoopHandlerResult> {
  const chat = deps.store.getChat(args.chatId)
  if (!chat) return { ok: false, errors: [`chat ${args.chatId} not found`] }
  const project = deps.store.getProject(chat.projectId)
  if (!project) return { ok: false, errors: [`project ${chat.projectId} not found`] }

  const validation = validateLoopSetup(args.input, project.localPath, {
    roster: deps.getSubagents().map((s) => ({ id: s.id, name: s.name })),
    defaultLoopSubagentId: deps.getAppSettingsSnapshot().subagentRuntime?.defaultLoopSubagentId ?? null,
  })
  if (!validation.ok) return { ok: false, errors: validation.errors }

  const resolved = validation.resolved
  let created: boolean
  let reconciled: boolean
  let reconcileActions: string[]
  try {
    const ensureResult = await deps.ensureTrackingFile({
      absPath: resolved.trackingFileAbs,
      skeleton: resolved.skeleton,
      // Deterministic schema reconcile of an EXISTING tracking file: pure
      // string transform — server-owned sections rewritten to the inputs,
      // loop history preserved. No model judgement involved.
      reconcile: (existing) =>
        reconcileTrackingFile(existing, {
          goal: resolved.goal,
          verifyCommand: resolved.verifyCommand,
          chunkHint: resolved.chunkHint,
        }),
    })
    created = ensureResult.created
    reconciled = ensureResult.reconciled
    reconcileActions = ensureResult.actions
  } catch (err) {
    return {
      ok: false,
      errors: [`ensureTrackingFile failed: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  try {
    // Wipe main-agent Claude session so the next turn starts fresh with the
    // rendered loop prompt. Codex untouched. setup_loop runs from INSIDE a
    // live turn, so the suppression half of clearClaudeSessionContext is
    // what keeps the wipe from being overwritten by the in-flight stream.
    await clearClaudeSessionContext(deps, args.chatId)
    await deps.store.appendMessage(args.chatId, timestamped({ kind: "context_cleared" }))

    const now = Date.now()
    // Arm the loop durably: every subsequent background-completion wake
    // re-injects THIS prompt (not the generic one) and loop turns are
    // tool-blocked. Superseded by a later setup_loop or cleared by stop_loop
    // / a real user send. Replays from the auto-continue log on restart.
    await deps.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_armed",
      timestamp: now,
      chatId: args.chatId,
      scheduleId: crypto.randomUUID(),
      subagentId: resolved.subagentId,
      prompt: resolved.prompt,
    })

    const scheduleId = crypto.randomUUID()
    await deps.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      timestamp: now,
      chatId: args.chatId,
      scheduleId,
      scheduledAt: now,
      tz: "system",
      source: "subagent_background",
      resetAt: now,
      detectedAt: now,
      prompt: resolved.prompt,
    })
  } catch (err) {
    return {
      ok: false,
      errors: [`enqueue failed: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  return {
    ok: true,
    trackingFileRel: resolved.trackingFileRel,
    created,
    reconciled,
    reconcileActions,
    prompt: resolved.prompt,
  }
}

/** Current armed-loop state for a chat, or null. Pure replay of the auto-continue log. */
export function isLoopArmed(deps: LoopOrchCommandDeps, chatId: string): LoopState | null {
  return deriveLoopState(deps.store.getAutoContinueEvents(chatId), chatId)
}

/**
 * Disarm an armed loop (restores tools + stops prompt re-injection). Backs
 * the `stop_loop` MCP tool (called by the model on GOAL MET) and the
 * user-send takeover path. No-op when no loop is armed.
 */
export async function stopLoop(
  deps: LoopOrchCommandDeps,
  chatId: string,
  reason: "goal_met" | "user_send" | "chat_deleted",
): Promise<void> {
  if (!isLoopArmed(deps, chatId)) return
  await deps.emitAutoContinueEvent({
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "loop_disarmed",
    timestamp: Date.now(),
    chatId,
    scheduleId: crypto.randomUUID(),
    reason,
  })
}

/** Returns live schedule IDs (proposed or scheduled) for the given chat. */
export function listLiveSchedules(deps: LoopOrchCommandDeps, chatId: string): string[] {
  const { schedules } = deriveChatSchedules(deps.store.getAutoContinueEvents(chatId), chatId)
  return Object.values(schedules)
    .filter((s) => s.state === "proposed" || s.state === "scheduled")
    .map((s) => s.scheduleId)
    .sort()
}
