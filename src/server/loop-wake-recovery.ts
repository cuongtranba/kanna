
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

type RearmScheduler = (rearm: () => Promise<void>, delayMs: number) => void

const REARM_AFTER_FAILURE_MS = 3_000

const defaultRearmScheduler: RearmScheduler = (rearm, delayMs) => {
  const timer = setTimeout(() => {
    void rearm().catch((err) => log.warn("[kanna] loop wake re-arm failed", { err }))
  }, delayMs)
  if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref()
}

export async function handleFailedLoopTurn(
  deps: LoopCommandDeps,
  chatId: string,
  schedule: RearmScheduler = defaultRearmScheduler,
): Promise<void> {
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

export type ResumeLoopResult =
  | { resumed: true; trackingFileRel: string | null; workdirAbs: string | null }
  | { resumed: false; reason: "already_armed" | "no_previous_loop" }

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

  await rearmLoopWakeIfLost(deps, chatId, "server_restart")
  return { resumed: true, trackingFileRel: spec.trackingFileRel, workdirAbs: spec.workdirAbs }
}
