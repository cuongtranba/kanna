/**
 * Session-rebuild helpers extracted from AgentCoordinator (agent.ts).
 *
 * Pure coordination logic — no direct IO. All side-effectful dependencies are
 * injected via `SessionRebuildDeps` so this module stays testable and sealed.
 */
import type { AgentProvider } from "../shared/types"
import type { HarnessEvent, HarnessTurn } from "./harness-types"
import type { ActiveTurn, ClaudeSessionState } from "./claude-session-state"

/** Minimal message shape consumed by findLastUserMessageId. */
export interface MessageEntry {
  kind: string
  _id: string
}

/** Injected dependencies — no concrete IO allowed in this module. */
export interface SessionRebuildDeps {
  claudeSessions: Map<string, ClaudeSessionState>
  activeTurns: Map<string, ActiveTurn>
  providerUsesSdkSession: (provider: AgentProvider) => boolean
  getMessages: (chatId: string) => readonly MessageEntry[]
}

/** Args forwarded from AgentCoordinator.recreateActiveTurnFromSession. */
export interface RecreateActiveTurnArgs {
  chatId: string
  provider: AgentProvider
  model: string
  effort?: string
  serviceTier?: "fast"
  planMode: boolean
  clientTraceId?: string
}

/**
 * Re-creates an ActiveTurn from an existing Claude session (SDK providers only).
 * Returns `undefined` when the provider does not use an SDK session or when no
 * live session is found for the chat.
 *
 * Side-effect: mutates `deps.activeTurns` (sets the reconstructed turn).
 */
export function recreateActiveTurnFromSession(
  deps: SessionRebuildDeps,
  args: RecreateActiveTurnArgs,
): ActiveTurn | undefined {
  if (!deps.providerUsesSdkSession(args.provider)) return undefined
  const session = deps.claudeSessions.get(args.chatId)
  if (!session) return undefined

  const ghostTurn: HarnessTurn = {
    provider: args.provider,
    stream: {
      async *[Symbol.asyncIterator](): AsyncGenerator<HarnessEvent> {
        // intentionally empty — ghost turn emits no events
      },
    },
    getAccountInfo: session.session.getAccountInfo,
    interrupt: session.session.interrupt,
    close: () => {
      // no-op — session lifetime is managed by AgentCoordinator
    },
  }

  const active: ActiveTurn = {
    chatId: args.chatId,
    provider: args.provider,
    turn: ghostTurn,
    model: session.model,
    effort: session.effort,
    serviceTier: args.serviceTier,
    planMode: session.planMode,
    status: "waiting_for_user",
    pendingTool: null,
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    clientTraceId: args.clientTraceId,
    waitStartedAt: null,
    userMessageId: findLastUserMessageId(deps, args.chatId),
  }
  deps.activeTurns.set(args.chatId, active)
  return active
}

/**
 * Scans the chat transcript backwards and returns the `_id` of the most recent
 * `user_prompt` entry, or `null` when the transcript contains no user prompts.
 */
export function findLastUserMessageId(
  deps: Pick<SessionRebuildDeps, "getMessages">,
  chatId: string,
): string | null {
  const messages = deps.getMessages(chatId)
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const entry = messages[i]
    if (entry.kind === "user_prompt") return entry._id
  }
  return null
}
