export interface FollowedSessionRegistryDeps {
  statFile: (path: string) => { size: number; mtimeMs: number } | null
  runDelta: (chatId: string, sourcePath: string) => Promise<void>
  isTurnActive: (chatId: string) => boolean
  now: () => number
  onChange: (followedChatIds: string[]) => void
  activeWindowMs: number
  idleMs: number
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
  lastGrowthAt: number
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
          try {
            await deps.runDelta(chatId, entry.sourcePath)
          } catch {
            // a bad file must not kill the tick loop
          }
          entry.lastSize = stat.size
          entry.lastGrowthAt = deps.now()
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
