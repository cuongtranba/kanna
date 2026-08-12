/**
 * Standalone autonomous-loop + subagent-delivery command handlers for
 * AgentCoordinator.
 *
 * Extracted from agent.ts so the related private/public methods live in
 * their own testable module. The coordinator delegates to these functions by
 * passing an object literal that satisfies `LoopCommandDeps`.
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
import { clearClaudeSessionContext } from "./claude-context-commands"
import { timestamped } from "./claude-message-normalizer"
import { buildTaskNotification } from "./claude-session-config"
import {
  assertTrackingFileSafe,
  auditOracle,
  extractOracleScriptPath,
  validateLoopSetup,
  reconcileTrackingFile,
  type LoopSetupInput,
} from "./loop-template"
import type {
  EnsureTrackingFileArgs,
  EnsureTrackingFileResult,
  TrackingFileInspection,
} from "./loop-template-io.adapter"
import type { RunVerifyArgs, RunVerifyResult } from "./loop-verify-io.adapter"
import type { BackgroundRunOutcome } from "./subagent-orchestrator"
import type { ClaudeSessionState } from "./claude-session-state"
import type { ArmedLoopInfo, SetupLoopHandlerResult } from "./kanna-mcp"
import { log } from "../shared/log"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the operations this module calls.
// ---------------------------------------------------------------------------

/** Subset of EventStore used by these handlers. */
interface LoopCommandStore {
  getChat(chatId: string): { id: string; projectId: string } | null
  getProject(projectId: string): { localPath: string; id: string } | null
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
  setSessionTokenForProvider(chatId: string, provider: AgentProvider, token: string | null): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
}

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface LoopCommandDeps {
  /** EventStore — subset used by these handlers. */
  store: LoopCommandStore

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
   * IO adapter: read the tracking file + ask git whether it is tracked, so
   * `assertTrackingFileSafe` can refuse to clobber committed history.
   */
  inspectTrackingFile(absPath: string): Promise<TrackingFileInspection>

  /**
   * IO adapter: true when `workdir` is the project checkout or a git worktree
   * of the same repository. Bounds where a loop may be pointed.
   */
  isWorktreeOfSameRepo(projectCwd: string, workdir: string): Promise<boolean>

  /**
   * IO adapter: run the loop's verify command (the oracle). Used at arm time
   * to prove the oracle can fail before the loop is armed.
   */
  runVerifyCommand(args: RunVerifyArgs): Promise<RunVerifyResult>

  /**
   * IO adapter: read the shell script the verify command references, confined
   * to the loop's workdir, for the arm-time oracle audit. Null when missing,
   * unreadable, or escaping the workdir.
   */
  readOracleScript(workdirAbs: string, scriptPath: string): Promise<string | null>

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

export { clearClaudeSessionContext } from "./claude-context-commands"

/**
 * Consecutive failed iterations after which the host disarms the loop itself.
 * A backstop, not a tuning knob: three back-to-back failures means the loop is
 * not making progress, and re-firing it only burns tokens. The model is told
 * (in the rendered prompt) to retry infra failures rather than stop, so
 * something has to bound that retry.
 */
export const MAX_CONSECUTIVE_LOOP_FAILURES = 3

/**
 * Budget for the one-shot oracle run at arm time. Generous — a real gate is
 * lint + typecheck + the full suite — but bounded, so a hanging verify command
 * fails `setup_loop` fast instead of wedging the arming turn.
 */
const ARM_VERIFY_TIMEOUT_MS = 300_000

/**
 * Disarm a loop that has failed `MAX_CONSECUTIVE_LOOP_FAILURES` times running,
 * and hand the chat back to the user with the reason. Deliberately still fires
 * an auto-continue so the failure surfaces in the transcript rather than the
 * chat simply going quiet.
 */
async function disarmFailingLoop(
  deps: LoopCommandDeps,
  chatId: string,
  runId: string,
  failures: number,
  notification: string,
): Promise<void> {
  try {
    const now = Date.now()
    await deps.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_disarmed",
      timestamp: now,
      chatId,
      scheduleId: crypto.randomUUID(),
      reason: "repeated_failures",
    })
    await clearClaudeSessionContext(deps, chatId)
    await deps.store.appendMessage(chatId, timestamped({ kind: "context_cleared" }))
    await deps.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      timestamp: now,
      chatId,
      scheduleId: crypto.randomUUID(),
      scheduledAt: now,
      tz: "system",
      source: "subagent_background",
      resetAt: now,
      detectedAt: now,
      prompt:
        `${notification}\n\nThe loop has been DISARMED automatically after ${failures}`
        + " consecutive failed iterations. Do not re-arm it blindly: report the failure"
        + " reason above to the user and say what needs fixing first.",
    })
  } catch (err) {
    log.warn(`[kanna] disarmFailingLoop failed`, { chatId, runId, err })
  }
}

/**
 * Deliver a finished `run_in_background` subagent's result back into the
 * main chat as a fresh turn AND clear the main-agent's Claude session so the
 * next turn starts with a fresh context window. Wired as the orchestrator's
 * `onBackgroundRunComplete` hook.
 *
 * Loop-orchestration invariant: main is stateless-in-context / stateful-in-file.
 * The tracking file is the durability contract; every delivery re-reads it.
 * Subagent output is NOT carried forward as prompt content — the subagent is
 * expected to have written its findings into the tracking file before
 * terminating.
 *
 * See adr-20260711-notification-driven-loop-orchestration.
 */
export async function deliverSubagentToMain(
  deps: LoopCommandDeps,
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

  // Record the iteration's outcome so a loop that cannot make progress is
  // disarmed by the HOST rather than by the model's judgement. Previously a
  // single transient AUTH_REQUIRED was enough for the orchestrator to call
  // stop_loop and park the run until a human noticed; now the prompt tells it
  // to retry infra failures, and this counter is what stops an infinite retry.
  let failuresAfterThisRun = 0
  if (armed) {
    const ok = outcome.status === "completed"
    failuresAfterThisRun = ok ? 0 : armed.consecutiveFailures + 1
    try {
      await deps.emitAutoContinueEvent({
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "loop_run_outcome",
        timestamp: Date.now(),
        chatId,
        scheduleId: crypto.randomUUID(),
        ok,
        errorCode: outcome.status === "failed" ? outcome.errorCode : undefined,
      })
    } catch (err) {
      // Non-fatal: losing one outcome row only weakens the backstop.
      log.warn(`[kanna] loop_run_outcome emit failed`, { chatId, runId, err })
    }
  }

  if (armed && failuresAfterThisRun >= MAX_CONSECUTIVE_LOOP_FAILURES) {
    await disarmFailingLoop(deps, chatId, runId, failuresAfterThisRun, notification)
    return
  }

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
  deps: LoopCommandDeps,
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
    // triggerMode MUST be carried: dropping it here is what let a
    // manual-trigger subagent arm a loop that could never delegate.
    roster: deps.getSubagents().map((s) => ({ id: s.id, name: s.name, triggerMode: s.triggerMode })),
    defaultLoopSubagentId: deps.getAppSettingsSnapshot().subagentRuntime?.defaultLoopSubagentId ?? null,
  })
  if (!validation.ok) return { ok: false, errors: validation.errors }

  const resolved = validation.resolved

  // A workdir outside the project must still be the SAME repository — a
  // sibling worktree is the supported case, an arbitrary directory is not.
  if (resolved.workdirAbs !== project.localPath) {
    const sameRepo = await deps.isWorktreeOfSameRepo(project.localPath, resolved.workdirAbs)
    if (!sameRepo) {
      return {
        ok: false,
        errors: [
          `workdir ${resolved.workdirAbs} is not this project's checkout or a git worktree of it`,
        ],
      }
    }
  }

  // Refuse to reconcile a COMMITTED tracking file that records a different
  // goal — that is a previous loop's record, and rewriting it is data loss.
  const inspection = await deps.inspectTrackingFile(resolved.trackingFileAbs)
  if (inspection.content !== null) {
    const safety = assertTrackingFileSafe(inspection.content, {
      goal: resolved.goal,
      gitTracked: inspection.gitTracked,
      force: args.input.force === true,
    })
    if (!safety.ok) return { ok: false, errors: [safety.error] }
  }

  // Prove the oracle can FAIL before arming. A verify command that already
  // exits 0 means either the goal is done or the oracle is too weak to define
  // it — arming on that produces an instant, meaningless "GOAL MET" and wipes
  // the context for nothing. This is the check a careful operator does by hand.
  const armCheck = await deps.runVerifyCommand({
    command: resolved.verifyCommand,
    cwd: resolved.workdirAbs,
    timeoutMs: ARM_VERIFY_TIMEOUT_MS,
  })
  if (armCheck.exitCode === 0 && args.input.force !== true) {
    return {
      ok: false,
      errors: [
        "the verify command already exits 0, so the loop would declare GOAL MET on its"
        + " first iteration without doing any work. Either the goal is already met, or"
        + " the oracle is too weak to define it — tighten the command (prefer a test in"
        + " the repo over a grep), or pass force: true if this is intentional.",
      ],
    }
  }

  // Static oracle-strength audit — the already-green refusal above proves the
  // oracle can FAIL; this asks whether it can only pass for the right reason.
  // Non-fatal: warnings ride the ok result into the tool reply.
  const scriptPath = extractOracleScriptPath(resolved.verifyCommand)
  const scriptContent = scriptPath === null
    ? null
    : await deps.readOracleScript(resolved.workdirAbs, scriptPath)
  const oracleWarnings = auditOracle({
    verifyCommand: resolved.verifyCommand,
    scriptPath,
    scriptContent,
  })
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
      verifyCommand: resolved.verifyCommand,
      workdirAbs: resolved.workdirAbs,
      trackingFileRel: resolved.trackingFileRel,
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
    oracleWarnings,
    prompt: resolved.prompt,
  }
}

/** Current armed-loop state for a chat, or null. Pure replay of the auto-continue log. */
export function isLoopArmed(deps: LoopCommandDeps, chatId: string): LoopState | null {
  return deriveLoopState(deps.store.getAutoContinueEvents(chatId), chatId)
}

/**
 * Narrow the armed loop to the slice the kanna-mcp tools need. Pure, and the
 * single adapter between the read model and the MCP host so the two spawn
 * paths (main turn + subagent run) cannot drift.
 */
export function toArmedLoopInfo(state: LoopState | null): ArmedLoopInfo | null {
  if (!state) return null
  return {
    verifyCommand: state.verifyCommand,
    workdirAbs: state.workdirAbs,
    trackingFileRel: state.trackingFileRel,
  }
}

/**
 * Disarm an armed loop (restores tools + stops prompt re-injection). Backs
 * the `stop_loop` MCP tool (called by the model on GOAL MET) and the
 * user-send takeover path. No-op when no loop is armed.
 */
export async function stopLoop(
  deps: LoopCommandDeps,
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
export function listLiveSchedules(deps: LoopCommandDeps, chatId: string): string[] {
  const { schedules } = deriveChatSchedules(deps.store.getAutoContinueEvents(chatId), chatId)
  return Object.values(schedules)
    .filter((s) => s.state === "proposed" || s.state === "scheduled")
    .map((s) => s.scheduleId)
    .sort()
}
