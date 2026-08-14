/**
 * Per-chat cache over a watched on-disk source: the shape every sibling
 * read-model shares (workflow sidecars, loop tracking file).
 *
 * The lifecycle it owns is the part that is easy to get subtly wrong, and was:
 * dispose the previous watch before replacing it, treat a re-register of the
 * same key as a no-op so caller churn cannot thrash the watcher, and load state
 * eagerly so the first read after register never sees a hole. A read-model
 * never feeds the transcript or turn event pipeline — it only mirrors disk.
 *
 * IO is injected, so this module stays inside the side-effect seal.
 */

export interface WatchedRegistryDeps<TState> {
  /** Re-derive cached state for a key. Called at register and on every change. */
  load: (key: string) => TState
  /** Arm a change watch; returns its disposer. */
  watch: (key: string, onChange: () => void) => () => void
}

export interface WatchedEntry<TState> {
  key: string
  state: TState
}

export interface WatchedRegistry<TState> {
  /** Idempotent: re-registering the same key leaves the live watch alone. */
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
