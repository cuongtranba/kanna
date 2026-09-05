
import type { ClaudeDriverPreference, TranscriptEntry } from "../shared/types"
import type { ActiveTurn, ClaudeSessionState, StartingTurn } from "./claude-session-state"
import type { PendingToolSlots } from "./pending-tool-slot"
import type { HarnessTurn } from "./harness-types"
import { logClaudeSteer } from "./claude-steer-log"
import { discardedToolResult } from "./claude-sdk-queue"
import { timestamped } from "./claude-message-normalizer"


interface DrainingStreamsMap {
  get(chatId: string): { turn: HarnessTurn } | undefined
  delete(chatId: string): boolean
}

interface CancelStore {
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  recordTurnCancelled(chatId: string): Promise<void>
}

interface ActiveTurnsMap {
  get(chatId: string): ActiveTurn | undefined
  delete(chatId: string): boolean
}

interface StartingTurnsMap {
  get(chatId: string): StartingTurn | undefined
  delete(chatId: string): boolean
}

interface ClaudeSessionsMap {
  get(chatId: string): ClaudeSessionState | undefined
}


export interface CancelHandlerDeps {
  drainingStreams: DrainingStreamsMap

  rejectPendingResolversForChat(chatId: string): void

  cancelChatInOrchestrator(chatId: string): void

  activeTurns: ActiveTurnsMap

  pendingTools: PendingToolSlots

  startingTurns: StartingTurnsMap

  store: CancelStore

  claudeSessions: ClaudeSessionsMap

  emitStateChange(chatId: string): void

  resolveClaudeDriverPreference(): ClaudeDriverPreference

  closeClaudeSession(chatId: string, session: ClaudeSessionState): void
}


export async function cancelChat(
  deps: CancelHandlerDeps,
  chatId: string,
  options?: { hideInterrupted?: boolean },
): Promise<void> {
  const draining = deps.drainingStreams.get(chatId)
  if (draining) {
    draining.turn.close()
    deps.drainingStreams.delete(chatId)
  }

  deps.rejectPendingResolversForChat(chatId)
  deps.cancelChatInOrchestrator(chatId)

  const parked = deps.pendingTools.takeAny(chatId)
  if (parked) {
    const result = discardedToolResult(parked.tool)
    await deps.store.appendMessage(
      chatId,
      timestamped({
        kind: "tool_result",
        toolId: parked.toolUseId,
        content: result,
      }),
    )
    parked.resolve(result)
  }

  const active = deps.activeTurns.get(chatId)
  if (!active) {
    const starting = deps.startingTurns.get(chatId)
    if (starting) {
      starting.cancelRequested = true
      deps.startingTurns.delete(chatId)
      await deps.store.appendMessage(
        chatId,
        timestamped({ kind: "interrupted", hidden: options?.hideInterrupted }),
      )
      await deps.store.recordTurnCancelled(chatId)
      deps.emitStateChange(chatId)
      return
    }

    const session = deps.claudeSessions.get(chatId)
    if (session?.selfWakeActive) {
      session.selfWakeActive = false
      if (session.hasBackgroundTasks()) {
        session.backgroundTaskWakeSuppressed = true
      }
      session.cancelledResultPending += 1
      await deps.store.appendMessage(
        chatId,
        timestamped({ kind: "interrupted", hidden: options?.hideInterrupted }),
      )
      deps.emitStateChange(chatId)
      try {
        await Promise.race([
          session.session.interrupt(),
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ])
      } catch {
      }
      if (deps.resolveClaudeDriverPreference() === "pty") {
        deps.closeClaudeSession(chatId, session)
        deps.emitStateChange(chatId)
      }
    }
    return
  }

  logClaudeSteer("cancel_requested", {
    chatId,
    provider: active.provider,
    activePromptSeq: active.claudePromptSeq ?? null,
  })

  if (active.cancelRequested) return
  active.cancelRequested = true

  await deps.store.appendMessage(
    chatId,
    timestamped({ kind: "interrupted", hidden: options?.hideInterrupted }),
  )
  await deps.store.recordTurnCancelled(chatId)
  active.cancelRecorded = true
  active.hasFinalResult = true

  deps.activeTurns.delete(chatId)

  if (active.provider === "claude") {
    const sessionForWakeGate = deps.claudeSessions.get(chatId)
    if (sessionForWakeGate && sessionForWakeGate.hasBackgroundTasks()) {
      sessionForWakeGate.backgroundTaskWakeSuppressed = true
    }
  }

  if (active.provider === "claude" && active.claudePromptSeq != null) {
    const session = deps.claudeSessions.get(chatId)
    if (session) {
      const idx = session.pendingPromptSeqs.indexOf(active.claudePromptSeq)
      if (idx >= 0) session.pendingPromptSeqs.splice(idx, 1)
      session.cancelledResultPending += 1
    }
  }

  deps.emitStateChange(chatId)
  logClaudeSteer("cancel_active_turn_deleted", {
    chatId,
    provider: active.provider,
    activePromptSeq: active.claudePromptSeq ?? null,
  })

  try {
    await Promise.race([
      active.turn.interrupt(),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ])
  } catch {
  }
  active.turn.close()

  if (active.provider === "claude" && deps.resolveClaudeDriverPreference() === "pty") {
    const session = deps.claudeSessions.get(chatId)
    if (session) {
      deps.closeClaudeSession(chatId, session)
    }
  }

}
