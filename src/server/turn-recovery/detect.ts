import type { AgentProvider, TranscriptEntry } from "../../shared/types"
import type { ChatRecord } from "../events"

/**
 * A chat whose most recent turn did not finish before the server stopped, and
 * which turn-recovery should resume on boot.
 *
 *  - `reason: "crash"` — the process died uncleanly (SIGKILL/OOM/power loss):
 *    the transcript ends on a `user_prompt` with no terminal `result` /
 *    `interrupted` after it.
 *  - `reason: "shutdown"` — a graceful stop (SIGTERM/deploy) cancelled the turn
 *    with `reason: "shutdown"` (distinct from an explicit user Stop).
 */
export interface ResumableTurn {
  chatId: string
  provider: AgentProvider
  reason: "crash" | "shutdown"
  /** True when a session token exists for the provider, so `--resume` can restore context. */
  hasSessionToken: boolean
  /** The interrupted turn's original prompt text, for the no-session-token fallback. */
  lastUserPromptContent: string | null
}

const TERMINAL_KINDS: ReadonlySet<TranscriptEntry["kind"]> = new Set(["result", "interrupted"])

/**
 * True when the transcript's last `user_prompt` has no terminal entry after it
 * — the signature of a turn that was still in flight when the process died.
 */
export function isTurnDangling(entries: readonly TranscriptEntry[]): boolean {
  let lastUserPromptIdx = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].kind === "user_prompt") {
      lastUserPromptIdx = i
      break
    }
  }
  if (lastUserPromptIdx === -1) return false
  for (let i = lastUserPromptIdx + 1; i < entries.length; i++) {
    if (TERMINAL_KINDS.has(entries[i].kind)) return false
  }
  return true
}

function lastUserPromptContent(entries: readonly TranscriptEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.kind === "user_prompt") return entry.content
  }
  return null
}

/**
 * Pure detection: which chats have an unfinished turn eligible for boot resume.
 *
 * A dangling transcript (`crash`) always wins — it reflects the newest turn —
 * so a crash that landed after an older user-cancel is still resumed. Only when
 * the transcript is NOT dangling do we consult `lastTurnOutcome`: a `shutdown`
 * cancel is resumable, an explicit `user` cancel is never resumed (wall 3).
 */
export function detectResumableTurns(
  chats: readonly ChatRecord[],
  getMessages: (chatId: string) => readonly TranscriptEntry[],
): ResumableTurn[] {
  const out: ResumableTurn[] = []
  for (const chat of chats) {
    if (chat.deletedAt || chat.archivedAt) continue
    const provider = chat.provider
    if (!provider) continue

    const entries = getMessages(chat.id)
    const crash = isTurnDangling(entries)

    let reason: "crash" | "shutdown"
    if (crash) {
      reason = "crash"
    } else if (chat.lastTurnOutcome === "cancelled" && chat.lastTurnCancelReason === "shutdown") {
      reason = "shutdown"
    } else {
      // Finished, failed, or an explicit user cancel → nothing to resume.
      continue
    }

    out.push({
      chatId: chat.id,
      provider,
      reason,
      hasSessionToken: Boolean(chat.sessionTokensByProvider[provider]),
      lastUserPromptContent: lastUserPromptContent(entries),
    })
  }
  return out
}

/**
 * The prompt to replay for a resumed turn.
 *
 * With a session token, `--resume` restores the full prior session (the
 * original prompt and any committed tool results already live in the session
 * transcript), so we send a short continuation nudge rather than re-sending the
 * prompt — re-sending would risk re-triggering already-committed tool calls
 * (wall 1). Without a token there is no session to restore, so we replay the
 * original prompt as a fresh turn. Returns null when there is nothing to replay.
 */
export function buildResumePrompt(turn: ResumableTurn): string | null {
  if (turn.hasSessionToken) {
    return "Your previous turn was interrupted before it finished because the Kanna server stopped (a crash or a deploy). Pick up exactly where you left off and complete the task. Do not repeat steps you already finished."
  }
  return turn.lastUserPromptContent
}
