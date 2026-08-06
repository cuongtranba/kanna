/**
 * Per-chat watch over an armed loop's tracking file, parsed into the
 * read-only view the Progress panel renders.
 *
 * A sibling read-model, like the workflow registry: it never feeds the
 * transcript or turn event pipeline, it only mirrors what is already on disk.
 * The tracking file is the loop's sole durability contract, so reading it is
 * what lets the panel show every step — including work finished before this
 * arm, and steps recorded by a previous server process.
 *
 * IO is injected, so this module stays inside the side-effect seal.
 */

import type { StructuredDoc } from "../shared/structured-doc/types"
import type { LoopTrackingSnapshot } from "../shared/loop-progress"

const DEFAULT_MAX_DONE_ENTRIES = 200

export interface LoopTrackingRegistryDeps {
  /** Full file contents, or null when missing / unreadable / caught mid-write. */
  read: (absPath: string) => string | null
  /** Arm a change watch; returns its disposer. */
  watch: (absPath: string, onChange: () => void) => () => void
  /** Format dispatch by extension, injected to keep this module pure. */
  resolveDoc: (absPath: string) => StructuredDoc | null
  /**
   * Newest `## Progress` entries retained. The snapshot is serialized on every
   * chat broadcast, so an append-only log needs a ceiling.
   */
  maxDoneEntries?: number
}

export interface LoopTrackingRegistry {
  /** Idempotent: re-registering the same file leaves the live watch alone. */
  register(chatId: string, trackingFileAbs: string): void
  unregister(chatId: string): void
  /** Cached parse — synchronous, so the pure chat read-model can call it. */
  snapshot(chatId: string): LoopTrackingSnapshot | null
  subscribe(cb: (chatId: string) => void): () => void
}

interface Entry {
  path: string
  dispose: () => void
  tracking: LoopTrackingSnapshot | null
}

function parse(
  content: string,
  doc: StructuredDoc,
  maxDoneEntries: number,
): LoopTrackingSnapshot {
  const doneEntries = doc.listItems(content, "Progress")
  return {
    doneEntries: doneEntries.slice(0, maxDoneEntries),
    nextChunkSection: doc.query(content, { sections: ["Next chunk"] }).content.trimEnd(),
  }
}

export function createLoopTrackingRegistry(deps: LoopTrackingRegistryDeps): LoopTrackingRegistry {
  const maxDoneEntries = deps.maxDoneEntries ?? DEFAULT_MAX_DONE_ENTRIES
  const entries = new Map<string, Entry>()
  const subs = new Set<(chatId: string) => void>()

  function refresh(chatId: string): void {
    const entry = entries.get(chatId)
    if (!entry) return
    const doc = deps.resolveDoc(entry.path)
    const content = doc ? deps.read(entry.path) : null
    entry.tracking = doc && content !== null ? parse(content, doc, maxDoneEntries) : null
    for (const cb of subs) cb(chatId)
  }

  return {
    register(chatId, trackingFileAbs) {
      const existing = entries.get(chatId)
      if (existing?.path === trackingFileAbs) return
      existing?.dispose()
      entries.set(chatId, {
        path: trackingFileAbs,
        dispose: deps.watch(trackingFileAbs, () => refresh(chatId)),
        tracking: null,
      })
      refresh(chatId)
    },

    unregister(chatId) {
      const entry = entries.get(chatId)
      if (!entry) return
      entry.dispose()
      entries.delete(chatId)
    },

    snapshot(chatId) {
      return entries.get(chatId)?.tracking ?? null
    },

    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
}
