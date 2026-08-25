import { log } from "../shared/log"
import type { AgentProvider } from "../shared/types"
import type { ImportableSession, SessionSource } from "./session-source"

export interface FollowedSessionRegistryDeps {
  statFile: (path: string) => { size: number; mtimeMs: number } | null
  /**
   * Re-imports the delta grown onto `sourcePath`.
   *
   * Answers whether the delta actually LANDED. The registry needs that: a
   * non-throwing failure (source refused the file, chat row gone, rollout over
   * the size cap) leaves the file growing on every tick, and if growth alone
   * refreshed the idle timer such a session would be followed for the life of
   * the process — polling forever, appending nothing, saying nothing.
   */
  runDelta: (chatId: string, sourcePath: string) => Promise<boolean>
  isTurnActive: (chatId: string) => boolean
  now: () => number
  onChange: (followedChatIds: string[]) => void
  activeWindowMs: number
  idleMs: number
  /**
   * Consecutive failed deltas before the registry gives up on a chat.
   *
   * Required rather than defaulted: the idle timer cannot bound a session whose
   * file keeps growing, so this is the ONLY stop for a permanently-failing
   * source. A missing wiring must be a compile error, not a silent forever-poll.
   */
  maxConsecutiveFailures: number
}

export interface FollowedSessionRegistry {
  consider(info: { chatId: string; sessionId: string; sourcePath: string; sourceMtimeMs: number }): void
  stop(chatId: string, reason: "user_takeover" | "chat_deleted"): void
  tick(): Promise<void>
  isFollowing(chatId: string): boolean
  followedChatIds(): string[]
}

interface FollowedEntry {
  sourcePath: string
  lastSize: number
  /** Refreshed only by a delta that SUCCEEDED — see `runDelta`. */
  lastGrowthAt: number
  consecutiveFailures: number
}

export function createFollowedSessionRegistry(deps: FollowedSessionRegistryDeps): FollowedSessionRegistry {
  const entries = new Map<string, FollowedEntry>()
  const permanentlyStopped = new Set<string>()

  function emitChange(): void {
    deps.onChange(Array.from(entries.keys()))
  }

  return {
    consider(info) {
      if (permanentlyStopped.has(info.chatId)) return
      if (deps.now() - info.sourceMtimeMs > deps.activeWindowMs) return
      const wasFollowing = entries.has(info.chatId)
      const stat = deps.statFile(info.sourcePath)
      entries.set(info.chatId, {
        sourcePath: info.sourcePath,
        lastSize: stat ? stat.size : 0,
        lastGrowthAt: deps.now(),
        consecutiveFailures: 0,
      })
      if (!wasFollowing) emitChange()
    },

    stop(chatId, reason) {
      if (reason === "user_takeover") permanentlyStopped.add(chatId)
      const existed = entries.delete(chatId)
      if (existed) emitChange()
    },

    async tick() {
      let changed = false
      for (const [chatId, entry] of entries) {
        const stat = deps.statFile(entry.sourcePath)
        if (!stat) {
          entries.delete(chatId)
          changed = true
          continue
        }
        if (deps.isTurnActive(chatId)) continue
        if (stat.size > entry.lastSize) {
          let applied = false
          try {
            applied = await deps.runDelta(chatId, entry.sourcePath)
          } catch (error) {
            // a bad file must not kill the tick loop
            log.warn("[kanna/import] live-tail delta threw", {
              chatId,
              sourcePath: entry.sourcePath,
              error: error instanceof Error ? error.message : String(error),
            })
          }
          entry.lastSize = stat.size
          if (applied) {
            entry.lastGrowthAt = deps.now()
            entry.consecutiveFailures = 0
            continue
          }
          // Growth we could not import is NOT progress, so the idle deadline is
          // deliberately left where it was. It still cannot fire while the file
          // keeps growing (that branch is the `else` below), which is why the
          // failure count is what actually stops a permanently-failing source.
          entry.consecutiveFailures += 1
          if (entry.consecutiveFailures >= deps.maxConsecutiveFailures) {
            log.warn("[kanna/import] live-tail gave up after repeated delta failures", {
              chatId,
              sourcePath: entry.sourcePath,
              failures: entry.consecutiveFailures,
            })
            entries.delete(chatId)
            changed = true
          }
        } else if (deps.now() - entry.lastGrowthAt > deps.idleMs) {
          entries.delete(chatId)
          changed = true
        }
      }
      if (changed) emitChange()
    },

    isFollowing(chatId) {
      return entries.has(chatId)
    },

    followedChatIds() {
      return Array.from(entries.keys())
    },
  }
}

export interface SessionDeltaRunnerDeps {
  /** The followed chat's provider, or `null` when the chat row is gone. */
  providerOf: (chatId: string) => AgentProvider | null
  /** The source that reads this provider's files. Built ONCE by the caller. */
  sourceFor: (provider: AgentProvider) => SessionSource | null
  importOne: (session: ImportableSession) => Promise<void>
}

/**
 * The live-tail delta: re-parse the grown source with the reader that WROTE it,
 * and append what is new.
 *
 * Provider routing is the whole point. Hardcoding the claude source meant a
 * followed codex chat re-parsed a rollout with claude's reader, which finds no
 * `sessionId` and answers `rejected` — the delta was silently dropped on every
 * tick. `?? "claude"` on a missing chat row is the same bug pointing the other
 * way, so a chat that vanished between the tick and the lookup is reported and
 * dropped rather than guessed at.
 *
 * Every non-`parsed` outcome is LOGGED and reported as a failure. A silent drop
 * here is what let a chat stop updating mid-conversation with nothing anywhere
 * to say so.
 */
export function createSessionDeltaRunner(
  deps: SessionDeltaRunnerDeps,
): (chatId: string, sourcePath: string) => Promise<boolean> {
  return async (chatId, sourcePath) => {
    const provider = deps.providerOf(chatId)
    if (!provider) {
      log.warn("[kanna/import] live-tail delta for a chat that no longer exists", { chatId, sourcePath })
      return false
    }
    const source = deps.sourceFor(provider)
    if (!source) {
      log.warn("[kanna/import] no session source for provider", { chatId, provider, sourcePath })
      return false
    }
    const parsed = source.parse(sourcePath)
    if (parsed.kind === "tooLarge") {
      log.warn("[kanna/import] live-tail source over the size cap — raise KANNA_IMPORT_MAX_ROLLOUT_BYTES", {
        chatId,
        sourcePath,
        size: parsed.size,
        maxBytes: parsed.maxBytes,
      })
      return false
    }
    if (parsed.kind === "rejected") {
      log.warn("[kanna/import] live-tail source rejected", { chatId, sourcePath, reason: parsed.reason })
      return false
    }
    await deps.importOne(parsed.session)
    return true
  }
}
