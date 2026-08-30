/**
 * The armed-loop wake invariant: an ARMED loop always holds exactly one pending
 * wake — a running subagent, a queued message, or an active turn. Losing that
 * one wake strands the loop silently, which is indistinguishable from a loop
 * that has finished.
 *
 * Two windows can drop it, and this module owns both so they cannot drift:
 * `recoverArmedLoopWakes` covers a wake lost WITH the server (boot), and
 * `handleFailedLoopTurn` covers one lost while the server kept running.
 *
 * Side-effect seal: no direct IO. Everything effectful is injected through
 * `LoopCommandDeps`; the only host primitive is the re-arm timer, which is
 * injectable so tests never wait on a clock.
 */

import { AUTO_CONTINUE_EVENT_VERSION } from "./auto-continue/events"
import { deriveChatSchedules, deriveLastLoopSpec } from "./auto-continue/read-model"
import { clearClaudeSessionContext } from "./claude-context-commands"
import { timestamped } from "./claude-message-normalizer"
import {
  disarmFailingLoop,
  MAX_CONSECUTIVE_LOOP_FAILURES,
  type LoopCommandDeps,
} from "./claude-loop-commands"
import { log } from "../shared/log"
import { addCounter } from "./observability"

/**
 * Boot recovery for the OTHER lost-wake window: a loop whose background
 * subagent died WITH the server. `recoverQueuedMessages` replays a wake that
 * reached the queue; this covers the wake that never got that far — the run
 * was in flight (or its delivery was mid-write in `deliverSubagentToMain`,
 * whose four steps are not atomic) when the process died. Observed twice as a
 * silently-stalled loop: chat c87ab0ad on 2026-08-13 (OOM at 09:31 killed run
 * fc17bee6 seven minutes in) and chat 5cea83a7 on 2026-08-14 (OOM at 18:40:13
 * landed 118 ms after `loop_run_outcome`, before `auto_continue_accepted`).
 *
 * The invariant this restores: an ARMED loop always has exactly one pending
 * wake — a running subagent, a queued message, or an active turn. At boot no
 * subagent survives the dead process, so armed + idle + empty queue proves
 * the wake is lost, and the recovery re-emits it from the durable
 * `LoopState.prompt`. Idempotent by construction: the orchestrator re-reads
 * the tracking file and re-delegates whatever the plan still lists.
 *
 * Best-effort and per-chat isolated, like `recoverQueuedMessages` — a chat
 * that refuses to recover is logged and skipped, never fatal to boot.
 */
export async function recoverArmedLoopWakes(deps: LoopCommandDeps): Promise<string[]> {
  const recovered: string[] = []
  for (const chatId of deps.store.listAutoContinueChats()) {
    try {
      if (await rearmLoopWakeIfLost(deps, chatId, "server_restart")) recovered.push(chatId)
    } catch (err) {
      log.warn("[kanna] armed-loop wake recovery failed", { chatId, err })
    }
  }
  return recovered
}

/** Why a lost wake is being re-armed. Selects the notice prepended to the prompt. */
type RearmReason = "server_restart" | "orchestrator_turn_failed"

const REARM_NOTICE: Record<RearmReason, string> = {
  server_restart:
    "The server was restarted while your loop's wake was in flight, so the"
    + " previous background run's outcome may be missing from the plan."
    + " Re-read the tracking file and continue from what it records.",
  orchestrator_turn_failed:
    "Your previous loop turn ended in an error before it could delegate any"
    + " work, so the loop was left with nothing to wake it. The plan is"
    + " unchanged. Re-read the tracking file and continue from what it records.",
}

/**
 * Re-emit an armed loop's wake when the loop provably holds none — the single
 * enforcement of "an ARMED loop always holds exactly one pending wake", shared
 * by the boot pass and the failed-turn pass so the two cannot drift.
 *
 * Every guard below proves the wake is held by someone else; clearing all of
 * them proves it is lost. `running` subagent runs are only consulted at
 * runtime — see `LoopCommandStore.getSubagentRuns`. The live-schedule guard is
 * what keeps this off a rate-limited turn, which arms its own resume through
 * `handleLimitDetection`.
 *
 * Idempotent by construction: the re-emitted prompt drives the orchestrator to
 * re-read the tracking file and re-delegate whatever the plan still lists, so a
 * redundant call costs one read, never a duplicated write.
 */
async function rearmLoopWakeIfLost(
  deps: LoopCommandDeps,
  chatId: string,
  reason: RearmReason,
): Promise<boolean> {
  const armed = deps.isLoopArmed(chatId)
  if (!armed) return false
  if (deps.isChatBusy(chatId)) return false
  if (deps.store.getQueuedMessages(chatId).length > 0) return false
  if (reason === "orchestrator_turn_failed") {
    const runs = Object.values(deps.store.getSubagentRuns(chatId))
    if (runs.some((run) => run.status === "running")) return false
  }
  if (deriveChatSchedules(deps.store.getAutoContinueEvents(chatId), chatId).liveScheduleId !== null) {
    return false
  }

  await clearClaudeSessionContext(deps, chatId)
  await deps.store.appendMessage(chatId, timestamped({ kind: "context_cleared" }))
  const now = Date.now()
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
    prompt: `${REARM_NOTICE[reason]}\n\n${armed.prompt}`,
  })
  addCounter("kanna.loop.wake.recovered", 1, { reason })
  return true
}

/** Schedules the deferred re-arm. Injected so tests drive it without a timer. */
type RearmScheduler = (rearm: () => Promise<void>, delayMs: number) => void

/**
 * How long to wait before re-arming. The turn's terminal observer fires BEFORE
 * the runner deletes the ActiveTurn and before it drains the queued-message
 * queue, so an immediate re-arm would read a chat that is still busy. The
 * guards make the exact delay uncritical — this only has to outlast the
 * runner's own unwind.
 */
const REARM_AFTER_FAILURE_MS = 3_000

const defaultRearmScheduler: RearmScheduler = (rearm, delayMs) => {
  const timer = setTimeout(() => {
    void rearm().catch((err) => log.warn("[kanna] loop wake re-arm failed", { err }))
  }, delayMs)
  // Never hold the process open for a re-arm; a pending one is recovered at boot.
  if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref()
}

/**
 * The runtime half of the armed-loop wake invariant. `recoverArmedLoopWakes`
 * covers a wake lost WITH the server; this covers one lost while the server
 * kept running — an orchestrator turn that died before it could delegate.
 *
 * Observed twice in chat 108b8a13 (2026-08-28 and 2026-08-29): a transport
 * `ENOTFOUND` failed the wake turn, which matches neither the rate-limit nor
 * the auth detector, so nothing re-armed. The loop sat armed and silent — 16 h
 * the first time (broken only by a server restart) and 55 min the second, until
 * the user typed "resume", which disarmed it instead.
 *
 * The failed iteration is recorded as a `loop_run_outcome` so a *repeatedly*
 * crashing orchestrator still trips `MAX_CONSECUTIVE_LOOP_FAILURES` and is
 * disarmed with a visible reason. Without that this fix would convert a silent
 * stall into a silent hot loop.
 */
export async function handleFailedLoopTurn(
  deps: LoopCommandDeps,
  chatId: string,
  schedule: RearmScheduler = defaultRearmScheduler,
): Promise<void> {
  // Swallows its own failures: this runs from the store's turn-terminal
  // observer, which every provider path funnels through. A loop re-arm is
  // best-effort bookkeeping, and letting it escape would break the terminal
  // path of turns that have nothing to do with a loop.
  try {
    const armed = deps.isLoopArmed(chatId)
    if (!armed) return

    const failures = armed.consecutiveFailures + 1
    try {
      await deps.emitAutoContinueEvent({
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "loop_run_outcome",
        timestamp: Date.now(),
        chatId,
        scheduleId: crypto.randomUUID(),
        ok: false,
        errorCode: "orchestrator_turn_failed",
      })
    } catch (err) {
      // Non-fatal: losing one outcome row only weakens the backstop.
      log.warn("[kanna] loop_run_outcome emit failed", { chatId, err })
    }

    if (failures >= MAX_CONSECUTIVE_LOOP_FAILURES) {
      await disarmFailingLoop(
        deps,
        chatId,
        "orchestrator",
        failures,
        "The loop's own orchestrator turn failed before it could delegate any work.",
      )
      return
    }

    schedule(async () => {
      await rearmLoopWakeIfLost(deps, chatId, "orchestrator_turn_failed")
    }, REARM_AFTER_FAILURE_MS)
  } catch (err) {
    log.warn("[kanna] handleFailedLoopTurn failed", { chatId, err })
  }
}

/** Outcome of a `resume_loop` attempt. `reason` explains a refusal. */
export type ResumeLoopResult =
  | { resumed: true; trackingFileRel: string | null; workdirAbs: string | null }
  | { resumed: false; reason: "already_armed" | "no_previous_loop" }

/**
 * Re-arm the loop a chat most recently ran. Backs the `resume_loop` MCP tool.
 *
 * Exists because a disarm used to be terminal: any user message disarms (a
 * takeover), and re-arming meant re-stating goal, oracle, workdir and tracking
 * file to `setup_loop` from scratch — through refusals that then need `force`.
 * Someone typing "resume" to nudge a stalled loop got the opposite of what they
 * asked for, with no way back.
 *
 * Re-arms from the `loop_armed` tombstone rather than re-validating: the spec
 * already passed `setup_loop`'s gates when it was first armed, and re-running
 * them would refuse a loop whose oracle now passes — the very state a resume is
 * for. `consecutiveFailures` resets, because `deriveLoopState` restarts the
 * count at every `loop_armed`; a resume is a deliberate human decision to try
 * again, so the previous streak is spent.
 *
 * Idempotent: an already-armed chat is refused, not double-armed.
 */
export async function resumeLoop(
  deps: LoopCommandDeps,
  chatId: string,
): Promise<ResumeLoopResult> {
  if (deps.isLoopArmed(chatId)) return { resumed: false, reason: "already_armed" }

  const spec = deriveLastLoopSpec(deps.store.getAutoContinueEvents(chatId), chatId)
  if (!spec) return { resumed: false, reason: "no_previous_loop" }

  await deps.emitAutoContinueEvent({
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "loop_armed",
    timestamp: Date.now(),
    chatId,
    scheduleId: crypto.randomUUID(),
    subagentId: spec.subagentId,
    prompt: spec.prompt,
    ...(spec.verifyCommand !== null ? { verifyCommand: spec.verifyCommand } : {}),
    ...(spec.workdirAbs !== null ? { workdirAbs: spec.workdirAbs } : {}),
    ...(spec.trackingFileRel !== null ? { trackingFileRel: spec.trackingFileRel } : {}),
  })

  // Arming alone starts nothing — the loop is driven by wakes. Hand it the same
  // re-arm every other lost-wake path uses, which no-ops if the chat is already
  // busy (the resuming turn itself) and will then be covered by the failed-turn
  // or boot pass.
  await rearmLoopWakeIfLost(deps, chatId, "server_restart")
  return { resumed: true, trackingFileRel: spec.trackingFileRel, workdirAbs: spec.workdirAbs }
}
