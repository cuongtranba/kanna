/**
 * Standalone respondTool handler for AgentCoordinator.
 *
 * Extracted from agent.ts so the pending-tool resolution logic lives in its
 * own testable module. The coordinator delegates to `respondTool` by passing
 * an object literal that satisfies `ToolRespondDeps`.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * the deps interface.
 */

import type { AgentProvider, TranscriptEntry } from "../shared/types"
import type { AnyValue } from "../shared/errors"
import { isRecord } from "../shared/errors"
import type { ActiveTurn } from "./claude-session-state"
import { timestamped, normalizeToolContent } from "./claude-message-normalizer"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the slices this module calls.
// ---------------------------------------------------------------------------

/** Subset of EventStore required by the tool-respond handler. */
interface ToolRespondStore {
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  setSessionTokenForProvider(
    chatId: string,
    provider: AgentProvider,
    sessionToken: string | null,
  ): Promise<void>
}

/** Subset of the activeTurns map used by the tool-respond handler. */
interface ToolRespondActiveTurnsMap {
  get(chatId: string): ActiveTurn | undefined
}

// ---------------------------------------------------------------------------
// Command shape (inlined to avoid protocol import cycle)
// ---------------------------------------------------------------------------

/** The slice of ClientCommand that this handler processes. */
export interface RespondToolCommand {
  type: "chat.respondTool"
  chatId: string
  toolUseId: string
  result: AnyValue
}

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface ToolRespondDeps {
  /** The shared in-memory active-turns map owned by AgentCoordinator. */
  activeTurns: ToolRespondActiveTurnsMap

  /** Persists transcript entries and session tokens. */
  store: ToolRespondStore

  /** Notify subscribers that a chat's observable state has changed. */
  emitStateChange(chatId: string): void
}

// ---------------------------------------------------------------------------
// Exported handler
// ---------------------------------------------------------------------------

/**
 * Resolve a pending tool request (AskUserQuestion / ExitPlanMode) coming back
 * from the UI.
 *
 * @throws if there is no pending tool for the chat or the toolUseId does not
 *         match.
 */
export async function respondTool(
  deps: ToolRespondDeps,
  command: RespondToolCommand,
): Promise<void> {
  const { activeTurns, store, emitStateChange } = deps

  const active = activeTurns.get(command.chatId)
  if (!active || !active.pendingTool) {
    throw new Error("No pending tool request")
  }

  const pending = active.pendingTool
  if (pending.toolUseId !== command.toolUseId) {
    throw new Error("Tool response does not match active request")
  }

  await store.appendMessage(
    command.chatId,
    timestamped({
      kind: "tool_result",
      toolId: command.toolUseId,
      content: normalizeToolContent(command.result),
    }),
  )

  active.pendingTool = null
  active.status = "running"
  active.waitStartedAt = null

  if (pending.tool.toolKind === "exit_plan_mode") {
    const resultRec: Record<string, unknown> = isRecord(command.result)
      ? command.result
      : {}
    const confirmed = Boolean(resultRec.confirmed)
    const clearContext = Boolean(resultRec.clearContext)
    const message =
      typeof resultRec.message === "string" ? resultRec.message : ""

    if (confirmed && clearContext) {
      await store.setSessionTokenForProvider(command.chatId, active.provider, null)
      await store.appendMessage(
        command.chatId,
        timestamped({ kind: "context_cleared" }),
      )
    }

    if (active.provider === "codex") {
      active.postToolFollowUp = confirmed
        ? {
            content: message
              ? `Proceed with the approved plan. Additional guidance: ${message}`
              : "Proceed with the approved plan.",
            planMode: false,
          }
        : {
            content: message
              ? `Revise the plan using this feedback: ${message}`
              : "Revise the plan using this feedback.",
            planMode: true,
          }
    }
  }

  pending.resolve(command.result)

  emitStateChange(command.chatId)
}
