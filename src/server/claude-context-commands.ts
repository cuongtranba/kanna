
import { AGENT_PROVIDERS, type AgentProvider } from "../shared/core-types"
import type { TranscriptEntry } from "../shared/types"
import { timestamped } from "./claude-message-normalizer"
import type { ClaudeSessionState } from "./claude-session-state"
import { isSessionInUse } from "./claude-session-state-queries"

export interface ClearClaudeContextDeps {
  store: {
    setSessionTokenForProvider(
      chatId: string,
      provider: AgentProvider,
      token: string | null,
    ): Promise<void>
  }
  claudeSessions: { get(chatId: string): ClaudeSessionState | undefined }
  activeTurns: { has(chatId: string): boolean }
  startingTurns: { has(chatId: string): boolean }
  pendingTools: { has(chatId: string): boolean }
  hasLiveWorkflow: (chatId: string) => boolean
  hasPendingBackgroundTask: (session: ClaudeSessionState, now: number) => boolean
  closeClaudeSession(chatId: string, session: ClaudeSessionState): void
}

export interface ClearChatContextDeps extends ClearClaudeContextDeps {
  store: ClearClaudeContextDeps["store"] & {
    appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  }
  stopCodexSession(chatId: string): void
  emitStateChange(chatId: string): void
}

export async function clearClaudeSessionContext(
  deps: ClearClaudeContextDeps,
  chatId: string,
): Promise<void> {
  await deps.store.setSessionTokenForProvider(chatId, "claude", null)
  const session = deps.claudeSessions.get(chatId)
  if (!session) return
  session.suppressSessionTokenPersist = true
  if (!isSessionInUse(deps, chatId, session, Date.now())) {
    deps.closeClaudeSession(chatId, session)
  }
}

export async function clearChatContext(
  deps: ClearChatContextDeps,
  chatId: string,
): Promise<void> {
  for (const provider of AGENT_PROVIDERS) {
    if (provider === "claude") continue
    await deps.store.setSessionTokenForProvider(chatId, provider, null)
  }
  await clearClaudeSessionContext(deps, chatId)
  deps.stopCodexSession(chatId)
  await deps.store.appendMessage(chatId, timestamped({ kind: "context_cleared" }))
  deps.emitStateChange(chatId)
}
