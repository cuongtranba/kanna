
import type { AgentProvider, TranscriptEntry } from "../shared/types"
import { billedUsageOfResult } from "../shared/token-pricing"
import { errorMessage, toError } from "../shared/errors"
import type { HarnessTurn } from "./harness-types"
import type { ActiveTurn } from "./claude-session-state"
import type { LimitDetector } from "./auto-continue/limit-detector"
import type { StartTurnForChatArgs } from "./claude-turn-starter"
import { timestamped } from "./claude-message-normalizer"


interface RunTurnStore {
  setSessionTokenForProvider(
    chatId: string,
    provider: AgentProvider,
    sessionToken: string | null,
  ): Promise<void>
  getChat(chatId: string): { pendingForkSessionToken?: { provider: AgentProvider; token: string } | null } | null | undefined
  setPendingForkSessionToken(
    chatId: string,
    value: { provider: AgentProvider; token: string } | null,
  ): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  recordTurnFailed(chatId: string, error: string): Promise<void>
  recordTurnFinished(chatId: string): Promise<void>
  recordTurnCancelled(chatId: string): Promise<void>
}

interface RunTurnOAuthPool {
  release(chatId: string): void
}


export interface RunTurnDeps {
  store: RunTurnStore
  activeTurns: Map<string, ActiveTurn>
  drainingStreams: Map<string, { turn: HarnessTurn }>
  oauthPool: RunTurnOAuthPool | null
  codexLimitDetector: LimitDetector
  handleLimitError: (chatId: string, detector: LimitDetector, error: Error) => Promise<boolean>
  emitStateChange: (chatId: string) => void
  clearDrainingStream: (chatId: string) => void
  startTurnForChat: (args: StartTurnForChatArgs) => Promise<void>
  maybeStartNextQueuedMessage: (chatId: string) => Promise<boolean | void>
  stopCodexSession: (chatId: string) => void
}


async function finalizeCodexSummary(
  deps: RunTurnDeps,
  active: ActiveTurn,
  summaryParts: readonly string[],
): Promise<void> {
  if (active.compactionTurn !== "codex_summary") return
  const summary = summaryParts.join("\n\n").trim()
  if (!summary) return

  await deps.store.appendMessage(active.chatId, timestamped({ kind: "compact_boundary" }))
  await deps.store.appendMessage(active.chatId, timestamped({ kind: "compact_summary", summary }))
  await deps.store.setSessionTokenForProvider(active.chatId, "codex", null)
  deps.stopCodexSession(active.chatId)
}

export async function runTurn(deps: RunTurnDeps, active: ActiveTurn): Promise<void> {
  const isCodexSummary = active.compactionTurn === "codex_summary"
  const summaryParts: string[] = []
  try {
    for await (const event of active.turn.stream) {
      if (active.cancelRequested) break

      switch (event.type) {
        case "session_token": {
          await deps.store.setSessionTokenForProvider(active.chatId, active.provider, event.sessionToken)
          const chat = deps.store.getChat(active.chatId)
          if (
            chat?.pendingForkSessionToken
            && event.sessionToken !== chat.pendingForkSessionToken.token
          ) {
            await deps.store.setPendingForkSessionToken(active.chatId, null)
          }
          deps.emitStateChange(active.chatId)
          continue
        }

        case "rate_limit": break

        case "transcript": {
          if (isCodexSummary && event.entry.kind === "assistant_text") {
            summaryParts.push(event.entry.text)
            continue
          }

          await deps.store.appendMessage(active.chatId, event.entry)

          if (event.entry.kind === "system_init") {
            active.status = "running"
          }

          if (event.entry.kind === "result") {
            active.hasFinalResult = true
            active.usage = billedUsageOfResult(event.entry)
            if (event.entry.isError) {
              await deps.store.recordTurnFailed(active.chatId, event.entry.result || "Turn failed")
            } else if (!active.cancelRequested) {
              await deps.store.recordTurnFinished(active.chatId)
              await finalizeCodexSummary(deps, active, summaryParts)
            }
            deps.activeTurns.delete(active.chatId)
            deps.drainingStreams.set(active.chatId, { turn: active.turn })
          }

          deps.emitStateChange(active.chatId)
          break
        }

        default: {
          const _never: never = event
          void _never
        }
      }
    }
  } catch (caught) {
    const error = toError(caught)
    if (!active.cancelRequested) {
      const handled = await deps.handleLimitError(active.chatId, deps.codexLimitDetector, error)
      if (!handled) {
        const message = error.message
        await deps.store.appendMessage(
          active.chatId,
          timestamped({
            kind: "result",
            subtype: "error",
            isError: true,
            durationMs: 0,
            result: message,
          })
        )
        await deps.store.recordTurnFailed(active.chatId, message)
      } else {
        await deps.store.recordTurnFailed(active.chatId, "rate_limit")
      }
    }
  } finally {
    if (active.cancelRequested && !active.cancelRecorded) {
      await deps.store.recordTurnCancelled(active.chatId)
    }
    active.turn.close()
    if (deps.activeTurns.get(active.chatId) === active) {
      deps.activeTurns.delete(active.chatId)
    }
    deps.clearDrainingStream(active.chatId)
    deps.oauthPool?.release(active.chatId)
    deps.emitStateChange(active.chatId)

    if (active.postToolFollowUp && !active.cancelRequested) {
      try {
        await deps.startTurnForChat({
          chatId: active.chatId,
          provider: active.provider,
          content: active.postToolFollowUp.content,
          attachments: [],
          model: active.model,
          effort: active.effort,
          serviceTier: active.serviceTier,
          planMode: active.postToolFollowUp.planMode,
          appendUserPrompt: false,
        })
      } catch (error) {
        const message = errorMessage(error)
        await deps.store.appendMessage(
          active.chatId,
          timestamped({
            kind: "result",
            subtype: "error",
            isError: true,
            durationMs: 0,
            result: message,
          })
        )
        await deps.store.recordTurnFailed(active.chatId, message)
        deps.emitStateChange(active.chatId)
      }
    } else if (!active.cancelRequested) {
      try {
        await deps.maybeStartNextQueuedMessage(active.chatId)
      } catch (error) {
        const message = errorMessage(error)
        await deps.store.appendMessage(
          active.chatId,
          timestamped({
            kind: "result",
            subtype: "error",
            isError: true,
            durationMs: 0,
            result: message,
          })
        )
        await deps.store.recordTurnFailed(active.chatId, message)
        deps.emitStateChange(active.chatId)
      }
    }
  }
}
