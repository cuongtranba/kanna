import type { Lifetime } from "./lifetime"
import type { createWsRouter } from "./ws-router"

const STALE_EMPTY_CHAT_PRUNE_INTERVAL_MS = 60 * 1000

export interface RouterHousekeeping {
  router: Pick<ReturnType<typeof createWsRouter>, "pruneStaleEmptyChats" | "broadcastSnapshots">
  followedSessions: { tick: () => Promise<void> }
  followedSessionPollMs: number
  lifetime: Pick<Lifetime, "defer">
}

export function startRouterHousekeeping({ router, followedSessions, followedSessionPollMs, lifetime }: RouterHousekeeping): void {
  const staleEmptyChatPrune = setInterval(() => {
    void router.pruneStaleEmptyChats().then(() => router.broadcastSnapshots())
  }, STALE_EMPTY_CHAT_PRUNE_INTERVAL_MS)
  lifetime.defer("quiesce", () => clearInterval(staleEmptyChatPrune))
  const followedSessionTick = setInterval(() => { void followedSessions.tick() }, followedSessionPollMs)
  lifetime.defer("quiesce", () => clearInterval(followedSessionTick))
}
