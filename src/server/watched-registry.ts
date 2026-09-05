
export interface WatchedRegistryDeps<TState> {
  load: (key: string) => TState
  watch: (key: string, onChange: () => void) => () => void
}

export interface WatchedEntry<TState> {
  key: string
  state: TState
}

export interface WatchedRegistry<TState> {
  register(chatId: string, key: string): void
  unregister(chatId: string): void
  entry(chatId: string): WatchedEntry<TState> | undefined
  subscribe(cb: (chatId: string) => void): () => void
}

interface Entry<TState> extends WatchedEntry<TState> {
  dispose: () => void
}

export function createWatchedRegistry<TState>(
  deps: WatchedRegistryDeps<TState>,
): WatchedRegistry<TState> {
  const entries = new Map<string, Entry<TState>>()
  const subs = new Set<(chatId: string) => void>()

  function notify(chatId: string): void {
    for (const cb of subs) cb(chatId)
  }

  return {
    register(chatId, key) {
      const existing = entries.get(chatId)
      if (existing?.key === key) return
      existing?.dispose()
      entries.set(chatId, {
        key,
        state: deps.load(key),
        dispose: deps.watch(key, () => {
          const entry = entries.get(chatId)
          if (!entry || entry.key !== key) return
          entry.state = deps.load(key)
          notify(chatId)
        }),
      })
      notify(chatId)
    },

    unregister(chatId) {
      const entry = entries.get(chatId)
      if (!entry) return
      entry.dispose()
      entries.delete(chatId)
    },

    entry(chatId) {
      return entries.get(chatId)
    },

    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
}
